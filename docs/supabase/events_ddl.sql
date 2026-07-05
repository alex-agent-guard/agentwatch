-- AgentWatch V0 — Supabase events 表 + RLS（Phase B）
-- 与 packages/web/src/types/events.ts AgentWatchEvent 对齐
-- 在 Supabase SQL Editor 执行

create extension if not exists "pgcrypto";

create table if not exists public.events (
  id                  uuid primary key default gen_random_uuid(),
  install_id          text not null,
  session_id          text not null,
  agent_id            text not null,
  user_id             text not null,
  event_id            text not null,
  tool_name           text not null,
  service_name        text not null default 'tools/call',
  timestamp_ms        bigint not null,
  duration_ms         integer not null default 0,
  arg_count           integer not null default 0,
  arg_key_hashes      jsonb not null default '[]',
  arg_value_types     jsonb not null default '[]',
  has_address         boolean not null default false,
  has_amount          boolean not null default false,
  amount_bucket       text,
  l0_triggered_rules  jsonb not null default '[]',
  l1_combined_score   double precision not null default 0,
  final_decision      text not null check (final_decision in ('ALLOW','WARN','BLOCK')),
  chain_depth         integer not null default 0,
  previous_tool       text,
  hmac                text not null,
  risk_level          text check (risk_level in ('HIGH','MEDIUM','LOW')),
  -- 若 Supabase 中 risk_level 为 GENERATED ALWAYS 列，INSERT 时勿传该字段（CLI 适配层已省略）
  created_at          timestamptz not null default now(),

  unique (install_id, event_id)
);

create index if not exists idx_events_install_ts
  on public.events (install_id, timestamp_ms desc);

create index if not exists idx_events_decision
  on public.events (install_id, final_decision);

alter table public.events enable row level security;

drop policy if exists "events_select_by_install" on public.events;
drop policy if exists "events_insert_by_install" on public.events;

create policy "events_select_by_install"
  on public.events for select
  to anon
  using (
    install_id = coalesce(
      current_setting('request.headers', true)::json->>'x-install-id',
      ''
    )
  );

create policy "events_insert_by_install"
  on public.events for insert
  to anon
  with check (
    install_id = coalesce(
      current_setting('request.headers', true)::json->>'x-install-id',
      ''
    )
  );
