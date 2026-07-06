-- 更新 ingest RPC，写入 client_name（在 add_client_name.sql 之后执行）
-- Supabase SQL Editor 一次性运行

create or replace function public.ingest_events_with_secret(
  p_install_id text,
  p_upload_secret text,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
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
