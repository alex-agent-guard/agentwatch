-- AgentWatch V0 — 审计取证扩展列 + ingest RPC 更新
-- 在 events 表已存在且 add_client_name.sql 已执行后运行

alter table public.events
  add column if not exists client_version text,
  add column if not exists tid text,
  add column if not exists sequence_no integer,
  add column if not exists l1_scores jsonb not null default '{}'::jsonb,
  add column if not exists block_reason text,
  add column if not exists prev_hmac text,
  add column if not exists consecutive_failures integer,
  add column if not exists frequency_1m integer,
  add column if not exists detection_duration_ms integer,
  add column if not exists tool_source text;

comment on column public.events.detection_duration_ms is 'L0+L1 检测链路耗时 (ms)';
comment on column public.events.tool_source is 'MCP server namespace / 工具来源';
comment on column public.events.l1_scores is 'L1 分项得分 — 来自本地 statAnomalies / l1_scores';
comment on column public.events.l0_triggered_rules is 'L0 命中；可含 matchedFields 对象';

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
      tool_name, service_name, client_name, client_version,
      tid, sequence_no, timestamp_ms, duration_ms,
      arg_count, arg_key_hashes, arg_value_types,
      has_address, has_amount, amount_bucket,
      l0_triggered_rules, l1_combined_score, l1_scores,
      final_decision, block_reason, detection_duration_ms,
      chain_depth, previous_tool,
      consecutive_failures, frequency_1m,
      tool_source,
      hmac, prev_hmac
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
      nullif(v_row->>'client_version', ''),
      nullif(v_row->>'tid', ''),
      nullif(v_row->>'sequence_no', '')::int,
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
      coalesce(v_row->'l1_scores', '{}'::jsonb),
      v_row->>'final_decision',
      nullif(v_row->>'block_reason', ''),
      nullif(v_row->>'detection_duration_ms', '')::int,
      coalesce((v_row->>'chain_depth')::int, 0),
      nullif(v_row->>'previous_tool', ''),
      nullif(v_row->>'consecutive_failures', '')::int,
      nullif(v_row->>'frequency_1m', '')::int,
      nullif(v_row->>'tool_source', ''),
      v_row->>'hmac',
      nullif(v_row->>'prev_hmac', '')
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

create index if not exists idx_events_session_ts
  on public.events (install_id, session_id, timestamp_ms asc);
