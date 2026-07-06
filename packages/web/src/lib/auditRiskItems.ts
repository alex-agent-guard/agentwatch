import { shouldShowL1Anomaly } from '@/lib/riskCopy';
import { buildCorrelatedFactRows, buildL1FactRows } from '@/lib/ruleEvidence';
import type { AgentWatchEvent, TriggeredRuleRow } from '@/types/events';
import { formatTimestamp } from '@/types/events';

export type ObjectiveFactGroup = 'context' | 'call' | 'chain' | 'audit' | 'detection';

export interface ObjectiveFactRow {
  id: string;
  label: string;
  value: string;
  group: ObjectiveFactGroup;
  mono?: boolean;
}

/** 引擎实际上报的检测命中 — 不含文案库、不含组合推断 */
export interface AuditHitItem {
  id: string;
  engine: 'L0' | 'L1';
  ruleId?: string;
  severity?: string;
  matchedFields?: Record<string, unknown>;
}

export function buildAuditHitItems(event: AgentWatchEvent): AuditHitItem[] {
  const items: AuditHitItem[] = event.l0_triggered_rules.map((row) => ({
    id: row.ruleId,
    engine: 'L0',
    ruleId: row.ruleId,
    severity: row.severity,
    ...(row.matchedFields ? { matchedFields: row.matchedFields } : {}),
  }));

  const ruleIds = event.l0_triggered_rules.map((r) => r.ruleId);
  if (shouldShowL1Anomaly(ruleIds, event.l1_combined_score, event.final_decision)) {
    items.push({ id: 'L1', engine: 'L1' });
  }

  return items;
}

function formatJsonValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function pushRow(
  rows: ObjectiveFactRow[],
  id: string,
  label: string,
  value: unknown,
  group: ObjectiveFactGroup,
  mono = true,
): void {
  const text = formatJsonValue(value);
  if (text === '—') return;
  rows.push({ id, label, value: text, group, mono });
}

/** 事件级客观字段 — 全部来自 Supabase 行 */
export function buildObjectiveFactRows(event: AgentWatchEvent): ObjectiveFactRow[] {
  const rows: ObjectiveFactRow[] = [];

  pushRow(rows, 'tool_name', 'tool_name', event.tool_name, 'context');
  pushRow(rows, 'service_name', 'service_name', event.service_name, 'context');
  pushRow(rows, 'final_decision', 'final_decision', event.final_decision, 'context');
  pushRow(
    rows,
    'l1_combined_score',
    'l1_combined_score',
    Math.round(event.l1_combined_score * 1000) / 1000,
    'context',
  );
  pushRow(rows, 'timestamp_ms', 'timestamp_ms', formatTimestamp(event.timestamp_ms), 'context', false);
  pushRow(rows, 'client_name', 'client_name', event.client_name?.trim() || null, 'context');
  pushRow(rows, 'client_version', 'client_version', event.client_version?.trim() || null, 'context');
  pushRow(rows, 'tid', 'tid', event.tid?.trim() || null, 'context');
  pushRow(rows, 'sequence_no', 'sequence_no', event.sequence_no ?? null, 'context');
  pushRow(rows, 'duration_ms', 'duration_ms', event.duration_ms > 0 ? event.duration_ms : null, 'context');
  pushRow(rows, 'risk_level', 'risk_level', event.risk_level ?? null, 'context');
  pushRow(rows, 'block_reason', 'block_reason', event.block_reason?.trim() || null, 'detection');
  pushRow(
    rows,
    'detection_duration_ms',
    'detection_duration_ms',
    event.detection_duration_ms ?? null,
    'detection',
  );
  pushRow(rows, 'tool_source', 'tool_source', event.tool_source?.trim() || null, 'context');

  if (event.l1_scores && Object.keys(event.l1_scores).length > 0) {
    for (const [key, val] of Object.entries(event.l1_scores)) {
      pushRow(rows, `l1_${key}`, `l1_scores.${key}`, val, 'detection');
    }
  }

  pushRow(rows, 'chain_depth', 'chain_depth', event.chain_depth, 'chain');
  pushRow(rows, 'previous_tool', 'previous_tool', event.previous_tool ?? null, 'chain');
  pushRow(rows, 'consecutive_failures', 'consecutive_failures', event.consecutive_failures ?? null, 'detection');
  pushRow(rows, 'frequency_1m', 'frequency_1m', event.frequency_1m ?? null, 'detection');

  pushRow(rows, 'arg_count', 'arg_count', event.arg_count > 0 ? event.arg_count : null, 'call');
  if (event.arg_key_hashes.length > 0) {
    pushRow(rows, 'arg_key_hashes', 'arg_key_hashes', event.arg_key_hashes.join(', '), 'call');
  }
  if (event.arg_value_types.length > 0) {
    pushRow(rows, 'arg_value_types', 'arg_value_types', event.arg_value_types.join(', '), 'call');
  }
  if (event.has_address) {
    pushRow(rows, 'has_address', 'has_address', true, 'call');
  }
  if (event.has_amount) {
    pushRow(rows, 'has_amount', 'has_amount', true, 'call');
    pushRow(rows, 'amount_bucket', 'amount_bucket', event.amount_bucket ?? null, 'call');
  }

  if (event.l0_triggered_rules.length > 0) {
    pushRow(rows, 'l0_triggered_rules', 'l0_triggered_rules', event.l0_triggered_rules, 'detection');
  }

  pushRow(rows, 'event_id', 'event_id', event.event_id, 'audit');
  pushRow(rows, 'session_id', 'session_id', event.session_id, 'audit');
  pushRow(rows, 'agent_id', 'agent_id', event.agent_id, 'audit');
  pushRow(rows, 'install_id', 'install_id', event.install_id, 'audit');
  pushRow(rows, 'user_id', 'user_id', event.user_id, 'audit');
  pushRow(rows, 'hmac', 'hmac', event.hmac, 'audit');
  pushRow(rows, 'prev_hmac', 'prev_hmac', event.prev_hmac?.trim() || null, 'audit');

  return rows;
}

export function buildMatchedFieldRows(
  matchedFields: Record<string, unknown> | undefined,
): ObjectiveFactRow[] {
  if (!matchedFields) return [];
  return Object.entries(matchedFields).map(([label, value]) => ({
    id: `mf_${label}`,
    label,
    value: formatJsonValue(value),
    group: label.startsWith('context.') || label.includes('chain')
      ? 'chain'
      : label.startsWith('argument.') || label.startsWith('tool.')
        ? 'call'
        : 'detection',
    mono: true,
  }));
}

export function buildObjectiveFacts(event: AgentWatchEvent): string[] {
  return buildObjectiveFactRows(event).map((row) => `${row.label}=${row.value}`);
}

export function formatHitDetailCopyText(event: AgentWatchEvent, hit: AuditHitItem): string {
  const lines: string[] = ['AgentWatch audit record', ''];

  if (hit.engine === 'L0' && hit.ruleId) {
    lines.push(`l0_hit.ruleId=${hit.ruleId}`);
    if (hit.severity) lines.push(`l0_hit.severity=${hit.severity}`);
    if (hit.matchedFields) {
      lines.push(`l0_hit.matchedFields=${JSON.stringify(hit.matchedFields)}`);
    }
    lines.push('');
    const correlated = buildCorrelatedFactRows(event, hit.ruleId);
    if (correlated.length > 0) {
      lines.push('[correlated fields]');
      for (const row of correlated) {
        lines.push(`${row.label}=${row.value}`);
      }
      lines.push('');
    }
  }

  if (hit.engine === 'L1') {
    lines.push('[L1]');
    for (const row of buildL1FactRows(event)) {
      lines.push(`${row.label}=${row.value}`);
    }
    lines.push('');
  }

  lines.push('[event]');
  for (const row of buildObjectiveFactRows(event)) {
    lines.push(`${row.label}=${row.value}`);
  }

  lines.push('', 'verify: agentwatch-web3 audit verify');
  return lines.join('\n');
}

export async function copyHitDetailText(event: AgentWatchEvent, hit: AuditHitItem): Promise<void> {
  await navigator.clipboard.writeText(formatHitDetailCopyText(event, hit));
}

/** @deprecated 使用 buildAuditHitItems */
export type AuditRiskItem = AuditHitItem;
export const buildAuditRiskItems = buildAuditHitItems;
export const copyRiskDetailText = copyHitDetailText;
export const formatRiskDetailCopyText = formatHitDetailCopyText;

export function findTriggeredRule(event: AgentWatchEvent, ruleId: string): TriggeredRuleRow | undefined {
  return event.l0_triggered_rules.find((r) => r.ruleId === ruleId);
}
