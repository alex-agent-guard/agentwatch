import type { CloudEventPayload } from '../../../src/cloud/CloudClient.js';

export function sampleCloudEvent(overrides?: Partial<CloudEventPayload>): CloudEventPayload {
  return {
    eventId: overrides?.eventId ?? `evt-${String(Date.now())}`,
    sessionId: overrides?.sessionId ?? 'sess-1',
    timestamp: overrides?.timestamp ?? Date.now(),
    agentId: overrides?.agentId ?? 'agent-1',
    userId: overrides?.userId ?? 'user-1',
    toolCall: overrides?.toolCall ?? {
      toolName: 'transfer',
      serviceName: 'tools/call',
      durationMs: 12,
      argCount: 1,
      argKeyHashes: ['abcd1234'],
      argValueTypes: ['int'],
      hasAddress: false,
      hasAmount: true,
      amountBucket: 'lt_10k',
    },
    detection: overrides?.detection ?? {
      l0TriggeredRules: [],
      l1CombinedScore: 0.9,
      finalDecision: 'BLOCK',
    },
    context: overrides?.context ?? { chainDepth: 1 },
    hmac: overrides?.hmac ?? 'a'.repeat(64),
    ...(overrides?.prevHmac !== undefined ? { prevHmac: overrides.prevHmac } : {}),
  };
}
