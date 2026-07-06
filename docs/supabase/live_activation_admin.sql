-- Live 激活码管理端（独立项目 packages/code-admin）
-- 依赖：live_activation_codes.sql 已执行
--
-- 能力：
--   1. 管理员白名单 live_code_admins
--   2. code_display 明文展示码（仅 admin RLS 可读；兑换仍走 hash）
--   3. Realtime 订阅 status 变化
--   4. 统计 RPC

-- ─── 1. 展示码（新生成批次写入；旧行可为 null，仅见 prefix）───
alter table public.live_activation_codes
  add column if not exists code_display text;

comment on column public.live_activation_codes.code_display is
  '发码用展示串 AW-LIVE-XXXX-XXXX；仅 live_code_admins 可读';

-- ─── 2. 管理员白名单 ───
create table if not exists public.live_code_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  note       text,
  created_at timestamptz not null default now()
);

alter table public.live_code_admins enable row level security;

-- 普通用户不可读白名单表
drop policy if exists "live_code_admins_select_self" on public.live_code_admins;
create policy "live_code_admins_select_self"
  on public.live_code_admins for select
  to authenticated
  using (user_id = auth.uid());

-- ─── 3. 是否管理员 ───
create or replace function public.is_live_code_admin(p_uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.live_code_admins a
    where a.user_id = coalesce(p_uid, auth.uid())
  );
$$;

grant execute on function public.is_live_code_admin(uuid) to authenticated;

-- ─── 4. 管理员可读激活码表 + Realtime ───
drop policy if exists "live_activation_codes_admin_select" on public.live_activation_codes;
create policy "live_activation_codes_admin_select"
  on public.live_activation_codes for select
  to authenticated
  using (public.is_live_code_admin());

alter table public.live_activation_codes replica identity full;

-- 若已加入 publication 会报错，可忽略
do $$
begin
  alter publication supabase_realtime add table public.live_activation_codes;
exception
  when duplicate_object then null;
end $$;

-- ─── 5. 汇总统计 ───
create or replace function public.admin_live_code_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not public.is_live_code_admin() then
    raise exception 'forbidden';
  end if;

  select jsonb_build_object(
    'total', count(*)::int,
    'active', count(*) filter (where status = 'active')::int,
    'redeemed', count(*) filter (where status = 'redeemed')::int,
    'revoked', count(*) filter (where status = 'revoked')::int,
    'by_batch', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'batch_id', batch_id,
            'total', total,
            'active', active,
            'redeemed', redeemed
          )
          order by batch_id nulls last
        )
        from (
          select
            batch_id,
            count(*)::int as total,
            count(*) filter (where status = 'active')::int as active,
            count(*) filter (where status = 'redeemed')::int as redeemed
          from public.live_activation_codes
          group by batch_id
        ) b
      ),
      '[]'::jsonb
    )
  )
  into v_result
  from public.live_activation_codes;

  return v_result;
end;
$$;

grant execute on function public.admin_live_code_stats() to authenticated;

-- ─── 6. 列表（含兑换者邮箱）───
create or replace function public.admin_list_live_activation_codes(
  p_batch_id text default null,
  p_status text default null,
  p_limit int default 500,
  p_offset int default 0
)
returns table (
  id uuid,
  code_display text,
  code_prefix text,
  batch_id text,
  sku text,
  status text,
  redeemed_at timestamptz,
  redeemed_email text,
  redeemed_display_name text,
  created_at timestamptz,
  note text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_live_code_admin() then
    raise exception 'forbidden';
  end if;

  return query
  select
    c.id,
    c.code_display,
    c.code_prefix,
    c.batch_id,
    c.sku,
    c.status,
    c.redeemed_at,
    p.email as redeemed_email,
    p.display_name as redeemed_display_name,
    c.created_at,
    c.note
  from public.live_activation_codes c
  left join public.profiles p on p.id = c.redeemed_by
  where (p_batch_id is null or c.batch_id = p_batch_id)
    and (p_status is null or c.status = p_status)
  order by c.created_at desc
  limit greatest(1, least(coalesce(p_limit, 500), 2000))
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

grant execute on function public.admin_list_live_activation_codes(text, text, int, int) to authenticated;

-- ─── 7. 批量入库支持 code_display ───
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

-- ─── 8. 添加管理员（在 SQL Editor 用 postgres 执行一次）───
-- insert into public.live_code_admins (user_id, note)
-- select id, 'founder' from auth.users where email = 'you@example.com'
-- on conflict (user_id) do nothing;
