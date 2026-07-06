-- 为 events 表增加 MCP 客户端标识（initialize.clientInfo.name）
-- 在 Supabase SQL Editor 执行（已有库迁移）

alter table public.events
  add column if not exists client_name text;

comment on column public.events.client_name is 'MCP initialize.clientInfo.name — Proxy 采集上报';
