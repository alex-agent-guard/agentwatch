/**
 * CloudEventPayload → Supabase events 表行（snake_case）
 * 对接适配层 — 不修改 CloudEventPayload 结构
 */
import type { CloudEventPayload } from './CloudClient.js';

export type SupabaseRiskLevel = 'HIGH' | 'MEDIUM' | 'LOW';

/** 与 Supabase public.events 列对齐 — snake_case */
export interface SupabaseEventRow {
  install_id: string;
  session_id: string;
  agent_id: string;
  user_id: string;
  event_id: string;
  tool_name: string;
  service_name: string;
  timestamp_ms: number;
  duration_ms: number;
  arg_count: number;
  arg_key_hashes: string[];
  arg_value_types: string[];
  has_address: boolean;
  has_amount: boolean;
  amount_bucket?: string | null;
  l0_triggered_rules: Array<{ ruleId: string; severity: string }>;
  l1_combined_score: number;
  final_decision: 'ALLOW' | 'WARN' | 'BLOCK';
  chain_depth: number;
  previous_tool?: string | null;
  hmac: string;
  risk_level?: SupabaseRiskLevel | null;
}

/** install_id 约定与 config.agentId 一致 — 默认取 payload.agentId */
export function toSupabaseEventRow(
  payload: CloudEventPayload,
  installId?: string,
): SupabaseEventRow {
  const resolvedInstallId = installId ?? payload.agentId;

  return {
    install_id: resolvedInstallId,
    session_id: payload.sessionId,
    agent_id: payload.agentId,
    user_id: payload.userId,
    event_id: payload.eventId,
    tool_name: payload.toolCall.toolName,
    service_name: payload.toolCall.serviceName,
    timestamp_ms: payload.timestamp,
    duration_ms: payload.toolCall.durationMs,
    arg_count: payload.toolCall.argCount,
    arg_key_hashes: payload.toolCall.argKeyHashes,
    arg_value_types: payload.toolCall.argValueTypes,
    has_address: payload.toolCall.hasAddress,
    has_amount: payload.toolCall.hasAmount,
    amount_bucket: payload.toolCall.amountBucket ?? null,
    l0_triggered_rules: payload.detection.l0TriggeredRules,
    l1_combined_score: payload.detection.l1CombinedScore,
    final_decision: payload.detection.finalDecision,
    chain_depth: payload.context.chainDepth,
    previous_tool: payload.context.previousTool ?? null,
    hmac: payload.hmac,
    risk_level: deriveRiskLevel(
      payload.detection.finalDecision,
      payload.detection.l1CombinedScore,
    ),
  };
}

export function toSupabaseEventRows(
  payloads: CloudEventPayload[],
  installId?: string,
): SupabaseEventRow[] {
  return payloads.map((payload) => toSupabaseEventRow(payload, installId));
}

function deriveRiskLevel(
  decision: 'ALLOW' | 'WARN' | 'BLOCK',
  score: number,
): SupabaseRiskLevel {
  if (decision === 'BLOCK') {
    return 'HIGH';
  }
  if (decision === 'WARN' || score >= 0.7) {
    return 'MEDIUM';
  }
  return 'LOW';
}
