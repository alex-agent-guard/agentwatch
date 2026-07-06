-- AgentWatch Login v1 — profiles, user_agents, upload credentials, RLS, RPC
-- 执行前：若 events 表未建，先运行 docs/supabase/events_ddl.sql
-- 参考：docs/login_system_target.md

create extension if not exists "pgcrypto";

-- ─── 1. profiles ───
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text,
  display_name  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do update
    set email = excluded.email,
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─── 2. user_agents ───
create table if not exists public.user_agents (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  install_id   text not null,
  label        text not null default 'My Agent',
  linked_at    timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint user_agents_install_id_nonempty check (char_length(trim(install_id)) > 0),
  unique (user_id, install_id)
);

create index if not exists idx_user_agents_user
  on public.user_agents (user_id, linked_at desc);

create index if not exists idx_user_agents_install
  on public.user_agents (install_id);

-- ─── 3. install_upload_credentials ───
create table if not exists public.install_upload_credentials (
  install_id     text primary key,
  secret_hash    text not null,
  secret_prefix  text not null,
  enabled        boolean not null default true,
  created_at     timestamptz not null default now(),
  rotated_at     timestamptz,
  last_used_at   timestamptz,
  constraint install_upload_credentials_hash_nonempty check (char_length(secret_hash) > 0)
);

create index if not exists idx_install_upload_credentials_enabled
  on public.install_upload_credentials (install_id)
  where enabled = true;

-- ─── 4. events RLS — 移除 anon + x-install-id ───
drop policy if exists "events_select_by_install" on public.events;
drop policy if exists "events_insert_by_install" on public.events;

alter table public.events enable row level security;

create policy "events_select_own_agents"
  on public.events for select
  to authenticated
  using (
    install_id in (
      select ua.install_id
      from public.user_agents ua
      where ua.user_id = auth.uid()
    )
  );

alter table public.profiles enable row level security;
alter table public.user_agents enable row level security;
alter table public.install_upload_credentials enable row level security;

create policy "profiles_select_own"
  on public.profiles for select to authenticated
  using (id = auth.uid());

create policy "profiles_update_own"
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "profiles_insert_own"
  on public.profiles for insert to authenticated
  with check (id = auth.uid());

create policy "user_agents_select_own"
  on public.user_agents for select to authenticated
  using (user_id = auth.uid());

create policy "user_agents_insert_own"
  on public.user_agents for insert to authenticated
  with check (user_id = auth.uid());

create policy "user_agents_update_own"
  on public.user_agents for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "user_agents_delete_own"
  on public.user_agents for delete to authenticated
  using (user_id = auth.uid());

-- ─── 5. RPC: bind_install_id ───
create or replace function public.bind_install_id(
  p_install_id text,
  p_label text default 'My Agent'
)
returns public.user_agents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.user_agents;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if p_install_id is null or char_length(trim(p_install_id)) = 0 then
    raise exception 'invalid_install_id';
  end if;

  insert into public.user_agents (user_id, install_id, label)
  values (v_uid, trim(p_install_id), coalesce(nullif(trim(p_label), ''), 'My Agent'))
  on conflict (user_id, install_id) do update
    set label = excluded.label,
        updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.bind_install_id(text, text) from public;
grant execute on function public.bind_install_id(text, text) to authenticated;

-- ─── 6. RPC: register_upload_secret ───
create or replace function public.register_upload_secret(
  p_install_id text,
  p_upload_secret text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_bound boolean;
  v_hash text;
  v_prefix text;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if p_install_id is null or p_upload_secret is null then
    raise exception 'invalid_arguments';
  end if;
  if char_length(p_upload_secret) < 24 then
    raise exception 'upload_secret_too_short';
  end if;

  select exists(
    select 1 from public.user_agents ua
    where ua.user_id = v_uid and ua.install_id = trim(p_install_id)
  ) into v_bound;

  if not v_bound then
    raise exception 'install_not_bound_to_user';
  end if;

  v_hash := encode(digest(p_upload_secret, 'sha256'), 'hex');
  v_prefix := left(p_upload_secret, 8);

  insert into public.install_upload_credentials (install_id, secret_hash, secret_prefix, enabled)
  values (trim(p_install_id), v_hash, v_prefix, true)
  on conflict (install_id) do update
    set secret_hash = excluded.secret_hash,
        secret_prefix = excluded.secret_prefix,
        enabled = true,
        rotated_at = now();

  return jsonb_build_object(
    'install_id', trim(p_install_id),
    'secret_prefix', v_prefix,
    'registered', true
  );
end;
$$;

revoke all on function public.register_upload_secret(text, text) from public;
grant execute on function public.register_upload_secret(text, text) to authenticated;

-- ─── 7. RPC: ingest_events_with_secret (service_role / Edge Function only) ───
create or replace function public.ingest_events_with_secret(
  p_install_id text,
  p_upload_secret text,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_cred public.install_upload_credentials;
  v_hash text;
  v_inserted int := 0;
  v_row jsonb;
begin
  if p_install_id is null or p_upload_secret is null or p_rows is null then
    raise exception 'invalid_arguments';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows_must_be_array';
  end if;

  select * into v_cred
  from public.install_upload_credentials c
  where c.install_id = trim(p_install_id) and c.enabled = true;

  if not found then
    raise exception 'upload_credentials_not_found';
  end if;

  v_hash := encode(digest(p_upload_secret, 'sha256'), 'hex');
  if v_hash <> v_cred.secret_hash then
    raise exception 'invalid_upload_secret';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    insert into public.events (
      install_id, session_id, agent_id, user_id, event_id,
      tool_name, service_name, client_name, timestamp_ms, duration_ms,
      arg_count, arg_key_hashes, arg_value_types,
      has_address, has_amount, amount_bucket,
      l0_triggered_rules, l1_combined_score, final_decision,
      chain_depth, previous_tool, hmac
    )
    values (
      trim(p_install_id),
      v_row->>'session_id',
      coalesce(v_row->>'agent_id', trim(p_install_id)),
      coalesce(v_row->>'user_id', 'default'),
      v_row->>'event_id',
      v_row->>'tool_name',
      coalesce(v_row->>'service_name', 'tools/call'),
      nullif(v_row->>'client_name', ''),
      (v_row->>'timestamp_ms')::bigint,
      coalesce((v_row->>'duration_ms')::int, 0),
      coalesce((v_row->>'arg_count')::int, 0),
      coalesce(v_row->'arg_key_hashes', '[]'::jsonb),
      coalesce(v_row->'arg_value_types', '[]'::jsonb),
      coalesce((v_row->>'has_address')::boolean, false),
      coalesce((v_row->>'has_amount')::boolean, false),
      nullif(v_row->>'amount_bucket', ''),
      coalesce(v_row->'l0_triggered_rules', '[]'::jsonb),
      coalesce((v_row->>'l1_combined_score')::double precision, 0),
      v_row->>'final_decision',
      coalesce((v_row->>'chain_depth')::int, 0),
      nullif(v_row->>'previous_tool', ''),
      v_row->>'hmac'
    )
    on conflict (install_id, event_id) do nothing;

    v_inserted := v_inserted + 1;
  end loop;

  update public.install_upload_credentials
  set last_used_at = now()
  where install_id = trim(p_install_id);

  return jsonb_build_object('accepted', v_inserted);
end;
$$;

revoke all on function public.ingest_events_with_secret(text, text, jsonb) from public;
grant execute on function public.ingest_events_with_secret(text, text, jsonb) to service_role;
