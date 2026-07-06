-- AgentWatch Live 一次性激活码 + 用户 entitlement
-- 依赖：login_system_ddl.sql 已执行（auth.users 可用）
-- 机制：码只存 SHA-256 哈希；一码一用户；兑换 RPC 原子更新

create extension if not exists "pgcrypto";

-- ─── 1. 激活码池（服务端/脚本写入，客户端不可读 plaintext）───
create table if not exists public.live_activation_codes (
  id              uuid primary key default gen_random_uuid(),
  code_hash       text not null unique,
  code_prefix     text not null,
  code_display    text,
  batch_id        text,
  sku             text not null default 'live_perpetual',
  status          text not null default 'active'
                  check (status in ('active', 'redeemed', 'revoked')),
  redeemed_by     uuid references auth.users(id) on delete set null,
  redeemed_at     timestamptz,
  expires_at      timestamptz,
  okx_order_ref   text,
  note            text,
  created_at      timestamptz not null default now(),
  constraint live_activation_codes_redeemed_consistency check (
    (status = 'redeemed' and redeemed_by is not null and redeemed_at is not null)
    or (status <> 'redeemed')
  )
);

create index if not exists idx_live_activation_codes_status
  on public.live_activation_codes (status)
  where status = 'active';

create index if not exists idx_live_activation_codes_batch
  on public.live_activation_codes (batch_id);

comment on table public.live_activation_codes is 'OKX 等渠道售出的一次性 Live 激活码（仅存 hash）';
comment on column public.live_activation_codes.code_prefix is '支持用前缀查单，如 AW-LIVE-A3F7';

-- ─── 2. 用户 Live 权益（一用户一条，永久 unless expires_at）───
create table if not exists public.live_entitlements (
  user_id             uuid primary key references auth.users(id) on delete cascade,
  source              text not null
                      check (source in ('okx_code', 'okx_pay', 'admin', 'stripe')),
  activation_code_id  uuid unique references public.live_activation_codes(id) on delete set null,
  granted_at          timestamptz not null default now(),
  expires_at          timestamptz
);

create index if not exists idx_live_entitlements_granted
  on public.live_entitlements (granted_at desc);

comment on table public.live_entitlements is 'Dashboard Live 使用权；Demo /preview 不查此表';

-- ─── 3. RLS：用户仅可读自己的 entitlement；激活码表不对 client 开放 ───
alter table public.live_entitlements enable row level security;
alter table public.live_activation_codes enable row level security;

drop policy if exists "live_entitlements_select_own" on public.live_entitlements;
create policy "live_entitlements_select_own"
  on public.live_entitlements for select
  to authenticated
  using (user_id = auth.uid());

-- live_activation_codes：无 authenticated 策略 → 仅 service role / security definer RPC

-- ─── 4. 规范化激活码（与前端 activationCode.ts 一致）───
create or replace function public.normalize_live_activation_code(p_raw text)
returns text
language plpgsql
immutable
as $$
declare
  v_compact text;
begin
  if p_raw is null or trim(p_raw) = '' then
    return null;
  end if;
  v_compact := upper(regexp_replace(trim(p_raw), '[\s\-]+', '', 'g'));
  if v_compact !~ '^AWLIVE[A-Z0-9]{8}$' then
    return null;
  end if;
  return v_compact;
end;
$$;

-- ─── 5. 是否已有 Live 权益 ───
create or replace function public.has_live_entitlement()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.live_entitlements e
    where e.user_id = auth.uid()
      and (e.expires_at is null or e.expires_at > now())
  );
$$;

grant execute on function public.has_live_entitlement() to authenticated;

-- ─── 6. 兑换 RPC（原子：锁码 → 校验 → 写 entitlement）───
create or replace function public.redeem_live_activation_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_norm text;
  v_hash text;
  v_row public.live_activation_codes%rowtype;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  if public.has_live_entitlement() then
    return jsonb_build_object(
      'ok', true,
      'already_entitled', true,
      'message', 'account_already_has_live'
    );
  end if;

  v_norm := public.normalize_live_activation_code(p_code);
  if v_norm is null then
    raise exception 'invalid_code_format';
  end if;

  v_hash := encode(digest(v_norm, 'sha256'), 'hex');

  select * into v_row
  from public.live_activation_codes
  where code_hash = v_hash
  for update;

  if not found then
    raise exception 'code_not_found';
  end if;

  if v_row.status = 'revoked' then
    raise exception 'code_revoked';
  end if;

  if v_row.status = 'redeemed' then
    raise exception 'code_already_redeemed';
  end if;

  if v_row.expires_at is not null and v_row.expires_at <= now() then
    raise exception 'code_expired';
  end if;

  update public.live_activation_codes
  set
    status = 'redeemed',
    redeemed_by = v_uid,
    redeemed_at = now()
  where id = v_row.id;

  insert into public.live_entitlements (user_id, source, activation_code_id)
  values (v_uid, 'okx_code', v_row.id);

  return jsonb_build_object(
    'ok', true,
    'sku', v_row.sku,
    'granted_at', now()
  );
end;
$$;

grant execute on function public.redeem_live_activation_code(text) to authenticated;

-- ─── 7. 管理：批量入库（仅 service role 调用，或通过 SQL Editor）───
create or replace function public.insert_live_activation_code_hashes(
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_row jsonb;
  v_inserted int := 0;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows_must_be_array';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    insert into public.live_activation_codes (
      code_hash, code_prefix, code_display, batch_id, sku, expires_at, okx_order_ref, note
    )
    values (
      v_row->>'code_hash',
      v_row->>'code_prefix',
      nullif(v_row->>'code_display', ''),
      nullif(v_row->>'batch_id', ''),
      coalesce(nullif(v_row->>'sku', ''), 'live_perpetual'),
      nullif(v_row->>'expires_at', '')::timestamptz,
      nullif(v_row->>'okx_order_ref', ''),
      nullif(v_row->>'note', '')
    )
    on conflict (code_hash) do nothing;
    v_inserted := v_inserted + 1;
  end loop;

  return jsonb_build_object('accepted', v_inserted);
end;
$$;

-- 不对 authenticated 开放 insert_live_activation_code_hashes
