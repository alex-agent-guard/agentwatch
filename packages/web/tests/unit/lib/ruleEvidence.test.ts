import { describe, expect, it } from 'vitest';
import { buildCorrelatedFactRows } from '@/lib/ruleEvidence';
import type { AgentWatchEvent } from '@/types/events';

const chainEvent: AgentWatchEvent = {
  install_id: 'i',
  session_id: 's',
  agent_id: 'a',
  user_id: 'u',
  event_id: 'evt-003',
  tool_name: 'transfer',
  service_name: '@okx_ai/okx-trade-mcp',
  timestamp_ms: 1,
  duration_ms: 1,
  arg_count: 4,
  arg_key_hashes: [],
  arg_value_types: ['float'],
  has_address: true,
  has_amount: true,
  amount_bucket: 'gte_1m',
  l0_triggered_rules: [
    {
      ruleId: 'CHAIN_ABUSE_001',
      severity: 'HIGH',
      matchedFields: { 'tool.name': 'transfer', 'context.chain_depth': 4 },
    },
  ],
  l1_combined_score: 0.91,
  final_decision: 'BLOCK',
  chain_depth: 4,
  previous_tool: 'swap',
  hmac: 'hmac',
  risk_level: 'HIGH',
};

describe('ruleEvidence', () => {
  it('prefers matchedFields from triggered rule', () => {
    const rows = buildCorrelatedFactRows(chainEvent, 'CHAIN_ABUSE_001');
    expect(rows.some((r) => r.label === 'context.chain_depth' && r.value === '4')).toBe(true);
    expect(rows.some((r) => r.label === 'tool.name' && r.value === 'transfer')).toBe(true);
  });

  it('shows consecutive_failures when present on event', () => {
    const rows = buildCorrelatedFactRows(
      { ...chainEvent, consecutive_failures: 4, l0_triggered_rules: [{ ruleId: 'PERM_PROBE_001', severity: 'HIGH' }] },
      'PERM_PROBE_001',
    );
    expect(rows.some((r) => r.label === 'consecutive_failures' && r.value === '4')).toBe(true);
  });
});
