import { describe, expect, it } from 'vitest';
import {
  chainContextText,
  formatAmountBucket,
  formatArgSignals,
  summarizeWhatHappened,
} from '@/lib/eventDetail';
import type { AgentWatchEvent } from '@/types/events';

const baseEvent: AgentWatchEvent = {
  install_id: 'i',
  session_id: 'sess-003',
  agent_id: 'agent_demo',
  user_id: 'u',
  event_id: 'evt-005',
  tool_name: 'delegate_action',
  service_name: 'tools/call',
  timestamp_ms: Date.now(),
  duration_ms: 31,
  arg_count: 2,
  arg_key_hashes: ['deadbeef'],
  arg_value_types: ['string(16)', 'object'],
  has_address: false,
  has_amount: false,
  l0_triggered_rules: [{ ruleId: 'PERM_PROBE_001', severity: 'MEDIUM' }],
  l1_combined_score: 0.55,
  final_decision: 'WARN',
  chain_depth: 3,
  previous_tool: 'query_balance',
  hmac: 'hmac-demo-005',
  risk_level: 'MEDIUM',
};

describe('eventDetail', () => {
  it('summarizes what happened in plain Chinese', () => {
    const text = summarizeWhatHappened(baseEvent);
    expect(text).toContain('delegate_action');
    expect(text).toContain('警告');
  });

  it('describes chain context when previous_tool exists', () => {
    expect(chainContextText(baseEvent)).toContain('query_balance');
    expect(chainContextText(baseEvent)).toContain('3');
  });

  it('formats amount bucket labels', () => {
    expect(formatAmountBucket('gte_1m')).toBe('100 万及以上');
    expect(formatAmountBucket(null)).toBeNull();
  });

  it('lists arg signals without raw values', () => {
    const signals = formatArgSignals({
      ...baseEvent,
      has_amount: true,
      amount_bucket: 'lt_10k',
    });
    expect(signals.some((s) => s.includes('类型'))).toBe(true);
    expect(signals.some((s) => s.includes('1 万以下'))).toBe(true);
  });
});
