import { describe, expect, it } from 'vitest';

import { sampleCloudEvent } from './cloudTestFixtures.js';
import { toSupabaseEventRow, toSupabaseEventRows } from '../../../src/cloud/supabaseEventMapper.js';

describe('supabaseEventMapper', () => {
  it('maps CloudEventPayload to snake_case Supabase row', () => {
    const payload = sampleCloudEvent({
      eventId: 'evt-map-1',
      agentId: 'install-abc',
      detection: {
        l0TriggeredRules: [{ ruleId: 'CHAIN_ABUSE_001', severity: 'HIGH' }],
        l1CombinedScore: 0.91,
        finalDecision: 'BLOCK',
      },
      context: { chainDepth: 2, previousTool: 'read_balance' },
    });

    const row = toSupabaseEventRow(payload);

    expect(row.install_id).toBe('install-abc');
    expect(row.event_id).toBe('evt-map-1');
    expect(row.tool_name).toBe('transfer');
    expect(row.service_name).toBe('tools/call');
    expect(row.timestamp_ms).toBe(payload.timestamp);
    expect(row.duration_ms).toBe(12);
    expect(row.l0_triggered_rules).toEqual([
      { ruleId: 'CHAIN_ABUSE_001', severity: 'HIGH' },
    ]);
    expect(row.l1_combined_score).toBe(0.91);
    expect(row.final_decision).toBe('BLOCK');
    expect(row.chain_depth).toBe(2);
    expect(row.previous_tool).toBe('read_balance');
    expect(row.hmac).toHaveLength(64);
    expect(row.risk_level).toBe('HIGH');
  });

  it('allows explicit installId override', () => {
    const row = toSupabaseEventRow(sampleCloudEvent({ agentId: 'agent-x' }), 'install-y');
    expect(row.install_id).toBe('install-y');
    expect(row.agent_id).toBe('agent-x');
  });

  it('maps batch via toSupabaseEventRows', () => {
    const rows = toSupabaseEventRows([
      sampleCloudEvent({ eventId: 'a' }),
      sampleCloudEvent({ eventId: 'b' }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.event_id).toBe('a');
    expect(rows[1]?.event_id).toBe('b');
  });

  it('derives MEDIUM risk for WARN decision', () => {
    const row = toSupabaseEventRow(
      sampleCloudEvent({
        detection: {
          l0TriggeredRules: [],
          l1CombinedScore: 0.5,
          finalDecision: 'WARN',
        },
      }),
    );
    expect(row.risk_level).toBe('MEDIUM');
  });
});
