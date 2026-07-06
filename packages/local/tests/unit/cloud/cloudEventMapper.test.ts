import { describe, expect, it } from 'vitest';

import type { BehaviorLogEntry } from '@packages/shared/types';

import { toCloudEventPayload } from '../../../src/cloud/cloudEventMapper.js';

function sampleEntry(overrides?: Partial<BehaviorLogEntry>): BehaviorLogEntry {
  return {
    eventId: 'evt-map-1',
    ts: Date.now(),
    sid: 'sess-1',
    tid: 'tid-1',
    tool: 'transfer',
    dec: 'WARN',
    score: 0.55,
    dur_ms: 20,
    params: overrides?.params ?? {},
    l0_rules: [],
    _meta: { v: '1.0', hmac: 'abc' },
    ...overrides,
  };
}

describe('cloudEventMapper context fields', () => {
  it('uses _agentwatch_chain_depth and previous tool from proxy meta', () => {
    const payload = toCloudEventPayload(
      sampleEntry({
        sequence_no: 9,
        params: {
          amount: 1000,
          _agentwatch_chain_depth: 4,
          _agentwatch_previous_tool: 'query_balance',
        },
      }),
    );

    expect(payload.context.chainDepth).toBe(4);
    expect(payload.context.previousTool).toBe('query_balance');
    expect(payload.toolCall.argCount).toBe(1);
  });

  it('falls back to sequence_no when chain depth meta is absent', () => {
    const payload = toCloudEventPayload(
      sampleEntry({
        sequence_no: 3,
        params: { amount: 1000 },
      }),
    );

    expect(payload.context.chainDepth).toBe(3);
  });

  it('maps forensic fields from l0_rules, l1_scores, and meta', () => {
    const payload = toCloudEventPayload(
      sampleEntry({
        tid: 'trace-99',
        sequence_no: 7,
        score: 0.91,
        params: { blockReason: 'L0:FREQ_001' },
        l0_rules: [
          {
            ruleId: 'FREQ_001',
            ruleName: 'Extreme Call Frequency Detection',
            severity: 'CRITICAL',
            matchedValue: { 'metadata.frequency_1m': 120 },
          },
        ],
        l1_scores: { zscore: 4.2, markov_sequence: 0.71 },
        _meta: { v: '1.0', hmac: 'abc', prev_hmac: 'prev-abc' },
      }),
    );

    expect(payload.context.tid).toBe('trace-99');
    expect(payload.context.sequenceNo).toBe(7);
    expect(payload.context.frequency1m).toBe(120);
    expect(payload.detection.l0TriggeredRules[0]?.matchedFields).toEqual({
      'metadata.frequency_1m': 120,
    });
    expect(payload.detection.l1Scores).toEqual({ zscore: 4.2, markov_sequence: 0.71 });
    expect(payload.detection.blockReason).toBe('L0:FREQ_001');
    expect(payload.prevHmac).toBe('prev-abc');
  });
});
