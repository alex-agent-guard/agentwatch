import { describe, expect, it } from 'vitest';
import {
  buildAuditHitItems,
  buildObjectiveFactRows,
  formatHitDetailCopyText,
} from '@/lib/auditRiskItems';
import type { AgentWatchEvent } from '@/types/events';

const baseEvent: AgentWatchEvent = {
  install_id: 'i',
  session_id: 'sess-003',
  agent_id: 'agent_demo',
  user_id: 'u',
  event_id: 'evt-005',
  tool_name: 'delegate_action',
  service_name: 'tools/call',
  timestamp_ms: 1_700_000_000_000,
  duration_ms: 31,
  arg_count: 2,
  arg_key_hashes: ['deadbeef'],
  arg_value_types: ['string(16)', 'object'],
  has_address: false,
  has_amount: false,
  l0_triggered_rules: [
    {
      ruleId: 'PERM_PROBE_001',
      severity: 'HIGH',
      matchedFields: { 'metadata.consecutive_failures': 4 },
    },
  ],
  l1_combined_score: 0.55,
  l1_scores: { metadata_consecutive_failures: 4.2 },
  consecutive_failures: 4,
  final_decision: 'WARN',
  chain_depth: 3,
  previous_tool: 'query_balance',
  hmac: 'hmac-demo-005',
  risk_level: 'MEDIUM',
};

describe('auditRiskItems', () => {
  it('lists L0 hits with matchedFields', () => {
    const items = buildAuditHitItems(baseEvent);
    expect(items).toHaveLength(1);
    expect(items[0]?.matchedFields).toEqual({ 'metadata.consecutive_failures': 4 });
  });

  it('uses schema field names in objective rows', () => {
    const rows = buildObjectiveFactRows(baseEvent);
    expect(rows.some((r) => r.label === 'consecutive_failures' && r.value === '4')).toBe(true);
    expect(rows.some((r) => r.label === 'l1_scores.metadata_consecutive_failures')).toBe(true);
  });

  it('copy text includes matchedFields', () => {
    const hit = buildAuditHitItems(baseEvent)[0]!;
    const text = formatHitDetailCopyText(baseEvent, hit);
    expect(text).toContain('metadata.consecutive_failures');
    expect(text).not.toContain('风险说明');
  });
});
