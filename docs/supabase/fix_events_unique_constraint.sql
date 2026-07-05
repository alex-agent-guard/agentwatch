-- events 表若缺少 (install_id, event_id) 唯一约束，ingest RPC 的 ON CONFLICT 会失败
-- 症状：Edge Function 400 "no unique or exclusion constraint matching the ON CONFLICT specification"
-- 在 fix_pgcrypto_digest.sql 之后执行

create unique index if not exists events_install_event_unique
  on public.events (install_id, event_id);
