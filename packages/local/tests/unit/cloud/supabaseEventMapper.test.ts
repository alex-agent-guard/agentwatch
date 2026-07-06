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

  it('maps forensic columns from extended payload', () => {
    const row = toSupabaseEventRow(
      sampleCloudEvent({
        detection: {
          l0TriggeredRules: [
            {
              ruleId: 'PERM_PROBE_001',
              severity: 'HIGH',
              matchedFields: { 'metadata.consecutive_failures': 4 },
            },
          ],
          l1CombinedScore: 0.55,
          l1Scores: { metadata_consecutive_failures: 4.2 },
          finalDecision: 'WARN',
          blockReason: 'L0:PERM_PROBE_001',
        },
        context: {
          chainDepth: 3,
          clientVersion: '1.0.42',
          tid: 'tid-1',
          sequenceNo: 5,
          consecutiveFailures: 4,
        },
        prevHmac: 'prev-hmac-hex',
      }),
    );

    expect(row.client_version).toBe('1.0.42');
    expect(row.tid).toBe('tid-1');
    expect(row.sequence_no).toBe(5);
    expect(row.l1_scores).toEqual({ metadata_consecutive_failures: 4.2 });
    expect(row.block_reason).toBe('L0:PERM_PROBE_001');
    expect(row.consecutive_failures).toBe(4);
    expect(row.prev_hmac).toBe('prev-hmac-hex');
    expect(row.l0_triggered_rules[0]?.matchedFields).toEqual({
      'metadata.consecutive_failures': 4,
    });
  });

  it('maps detection_duration_ms and tool_source', () => {
    const row = toSupabaseEventRow(
      sampleCloudEvent({
        detection: {
          l0TriggeredRules: [],
          l1CombinedScore: 0.4,
          finalDecision: 'WARN',
          detectionDurationMs: 7,
        },
        context: { chainDepth: 1, toolSource: 'filesystem-mcp' },
      }),
    );

    expect(row.detection_duration_ms).toBe(7);
    expect(row.tool_source).toBe('filesystem-mcp');
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

  it('maps context.clientName to client_name column', () => {
    const row = toSupabaseEventRow(
      sampleCloudEvent({
        context: { chainDepth: 1, clientName: 'claude-code' },
        toolCall: {
          toolName: 'swap',
          serviceName: '@okx_ai/okx-trade-mcp',
          durationMs: 12,
          argCount: 1,
          argKeyHashes: ['abcd1234'],
          argValueTypes: ['int'],
          hasAddress: false,
          hasAmount: false,
        },
      }),
    );
    expect(row.client_name).toBe('claude-code');
    expect(row.service_name).toBe('@okx_ai/okx-trade-mcp');
  });
});
