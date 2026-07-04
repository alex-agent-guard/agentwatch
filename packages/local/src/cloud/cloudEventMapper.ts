/**
 * BehaviorLogEntry → CloudEventPayload 映射
 * 前提：AsyncLogger 已完成 DataMasker 脱敏 + HMACChain 签名
 */
import { createHash } from 'node:crypto';

import type { BehaviorLogEntry } from '@packages/shared/types';

import type { CloudEventPayload } from './CloudClient.js';

const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

export function toCloudEventPayload(entry: BehaviorLogEntry): CloudEventPayload {
  const params = entry.params ?? {};
  const paramKeys = Object.keys(params).filter(
    (key) => !['triggerRuleIds', 'blockReason', '_meta'].includes(key),
  );

  const argKeyHashes = paramKeys.map((key) =>
    createHash('sha256').update(key).digest('hex').slice(0, 8),
  );

  const argValueTypes = paramKeys.map((key) => describeValueType(params[key]));

  let hasAddress = false;
  let hasAmount = false;
  let amountBucket: string | undefined;

  for (const value of paramKeys.map((key) => params[key])) {
    if (typeof value === 'string' && ADDRESS_PATTERN.test(value)) {
      hasAddress = true;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      hasAmount = true;
      amountBucket = bucketAmount(value);
    }
  }

  const hmac = entry._meta?.hmac ?? entry.hmac ?? '';

  return {
    eventId: entry.eventId,
    sessionId: entry.sid,
    timestamp: entry.ts,
    agentId: entry.agentId ?? 'default',
    userId: entry.uid ?? 'default',
    toolCall: {
      toolName: entry.tool,
      serviceName: 'tools/call',
      durationMs: entry.dur_ms,
      argCount: paramKeys.length,
      argKeyHashes,
      argValueTypes,
      hasAddress,
      hasAmount,
      ...(amountBucket !== undefined ? { amountBucket } : {}),
    },
    detection: {
      l0TriggeredRules: (entry.l0_rules ?? []).map((rule) => ({
        ruleId: rule.ruleId,
        severity: rule.severity,
      })),
      l1CombinedScore: entry.score,
      finalDecision:
        entry.dec === 'ESCALATE'
          ? 'WARN'
          : (entry.dec as 'ALLOW' | 'BLOCK' | 'WARN'),
    },
    context: {
      chainDepth: typeof params['chain_depth'] === 'number' ? params['chain_depth'] : 0,
      ...(typeof params['previousTool'] === 'string'
        ? { previousTool: params['previousTool'] }
        : {}),
    },
    hmac,
  };
}

function describeValueType(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'int' : 'float';
  }
  if (typeof value === 'string') {
    return `string(${value.length})`;
  }
  if (typeof value === 'boolean') {
    return 'bool';
  }
  if (Array.isArray(value)) {
    return `array(${value.length})`;
  }
  if (typeof value === 'object') {
    return 'object';
  }
  return typeof value;
}

function bucketAmount(value: number): string {
  if (value < 100) {
    return 'lt_100';
  }
  if (value < 10_000) {
    return 'lt_10k';
  }
  if (value < 1_000_000) {
    return 'lt_1m';
  }
  return 'gte_1m';
}
