/**
 * CloudEventPayload → Supabase events 表行（snake_case）
 * 对接适配层 — 不修改 CloudEventPayload 结构
 */
import type { CloudEventPayload } from './CloudClient.js';

export type SupabaseRiskLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export interface SupabaseTriggeredRuleRow {
  ruleId: string;
  severity: string;
  matchedFields?: Record<string, unknown>;
}

/** 与 Supabase public.events 列对齐 — snake_case */
export interface SupabaseEventRow {
  install_id: string;
  session_id: string;
  agent_id: string;
  user_id: string;
  event_id: string;
  tool_name: string;
  service_name: string;
  client_name?: string | null;
  client_version?: string | null;
  tid?: string | null;
  sequence_no?: number | null;
  timestamp_ms: number;
  duration_ms: number;
  arg_count: number;
  arg_key_hashes: string[];
  arg_value_types: string[];
  has_address: boolean;
  has_amount: boolean;
  amount_bucket?: string | null;
  l0_triggered_rules: SupabaseTriggeredRuleRow[];
  l1_combined_score: number;
  l1_scores?: Record<string, number>;
  final_decision: 'ALLOW' | 'WARN' | 'BLOCK';
  block_reason?: string | null;
  detection_duration_ms?: number | null;
  chain_depth: number;
  previous_tool?: string | null;
  consecutive_failures?: number | null;
  frequency_1m?: number | null;
  tool_source?: string | null;
  hmac: string;
  prev_hmac?: string | null;
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
    client_name: payload.context.clientName ?? null,
    client_version: payload.context.clientVersion ?? null,
    tid: payload.context.tid ?? null,
    sequence_no: payload.context.sequenceNo ?? null,
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
    ...(payload.detection.l1Scores !== undefined ? { l1_scores: payload.detection.l1Scores } : {}),
    final_decision: payload.detection.finalDecision,
    block_reason: payload.detection.blockReason ?? null,
    detection_duration_ms: payload.detection.detectionDurationMs ?? null,
    chain_depth: payload.context.chainDepth,
    previous_tool: payload.context.previousTool ?? null,
    consecutive_failures: payload.context.consecutiveFailures ?? null,
    frequency_1m: payload.context.frequency1m ?? null,
    tool_source: payload.context.toolSource ?? null,
    hmac: payload.hmac,
    prev_hmac: payload.prevHmac ?? null,
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
