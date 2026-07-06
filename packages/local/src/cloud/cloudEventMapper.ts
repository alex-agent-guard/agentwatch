/**
 * BehaviorLogEntry → CloudEventPayload 映射
 * 前提：AsyncLogger 已完成 DataMasker 脱敏 + HMACChain 签名
 */
import { createHash } from 'node:crypto';

import type { BehaviorLogEntry } from '@packages/shared/types';

import type { TriggeredRule } from '@packages/shared/types';

import type { CloudEventPayload } from './CloudClient.js';

const MATCHED_STRING_MAX = 120;

const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

const INTERNAL_PARAM_KEYS = new Set([
  'triggerRuleIds',
  'blockReason',
  '_meta',
  'request',
  'risk_labels',
  'processed_at',
  '_agentwatch_client_name',
  '_agentwatch_client_version',
  '_agentwatch_chain_depth',
  '_agentwatch_previous_tool',
  '_agentwatch_detection_duration_ms',
]);

function extractAgentWatchClient(params: Record<string, unknown>): {
  clientName?: string;
  clientVersion?: string;
} {
  const name = params['_agentwatch_client_name'];
  const version = params['_agentwatch_client_version'];
  return {
    ...(typeof name === 'string' && name.trim().length > 0 ? { clientName: name.trim() } : {}),
    ...(typeof version === 'string' && version.trim().length > 0
      ? { clientVersion: version.trim() }
      : {}),
  };
}

export interface CloudEventMapperContext {
  /** Proxy 侧解析的 MCP 服务标识 — 来自 resolveMcpServiceName() */
  mcpServiceName?: string;
}

function chainContext(
  chainDepth: number,
  params: Record<string, unknown>,
): { chainDepth: number; previousTool?: string } {
  const previousTool = readPreviousTool(params);
  if (previousTool !== undefined) {
    return { chainDepth, previousTool };
  }
  return { chainDepth };
}

function extractAgentWatchContext(params: Record<string, unknown>, entry: BehaviorLogEntry): {
  chainDepth: number;
  previousTool?: string;
} {
  const fromInternal = params['_agentwatch_chain_depth'];
  if (typeof fromInternal === 'number' && Number.isFinite(fromInternal)) {
    return chainContext(Math.max(0, Math.trunc(fromInternal)), params);
  }

  const fromParams = params['chain_depth'] ?? params['chainDepth'];
  if (typeof fromParams === 'number' && Number.isFinite(fromParams)) {
    return chainContext(Math.max(0, Math.trunc(fromParams)), params);
  }

  const rawMeta = params['_meta'];
  if (rawMeta !== null && typeof rawMeta === 'object' && !Array.isArray(rawMeta)) {
    const meta = rawMeta as Record<string, unknown>;
    const fromMeta = meta['chain_depth'] ?? meta['chainDepth'];
    if (typeof fromMeta === 'number' && Number.isFinite(fromMeta)) {
      return chainContext(Math.max(0, Math.trunc(fromMeta)), params);
    }
  }

  if (entry.sequence_no !== undefined && Number.isFinite(entry.sequence_no)) {
    return chainContext(Math.max(0, Math.trunc(entry.sequence_no)), params);
  }

  return chainContext(0, params);
}

function readPreviousTool(params: Record<string, unknown>): string | undefined {
  const fromInternal = params['_agentwatch_previous_tool'];
  if (typeof fromInternal === 'string' && fromInternal.trim().length > 0) {
    return fromInternal.trim();
  }
  if (typeof params['previousTool'] === 'string' && params['previousTool'].trim().length > 0) {
    return params['previousTool'].trim();
  }
  if (typeof params['previous_tool'] === 'string' && params['previous_tool'].trim().length > 0) {
    return params['previous_tool'].trim();
  }
  return undefined;
}

export function toCloudEventPayload(
  entry: BehaviorLogEntry,
  context?: CloudEventMapperContext,
): CloudEventPayload {
  const params = entry.params ?? {};
  const paramKeys = Object.keys(params).filter((key) => !INTERNAL_PARAM_KEYS.has(key));

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
  const prevHmac = entry._meta?.prev_hmac ?? entry.prev_hmac;
  const agentwatchClient = extractAgentWatchClient(params);
  const agentwatchContext = extractAgentWatchContext(params, entry);
  const metadataCounters = extractMetadataCounters(entry.l0_rules ?? []);
  const blockReason = readBlockReason(params);
  const l0TriggeredRules = mapL0TriggeredRules(entry.l0_rules ?? []);
  const l1Scores = entry.l1_scores;
  const detectionDurationMs =
    typeof entry.dur_ms === 'number' && entry.dur_ms > 0 ? Math.trunc(entry.dur_ms) : undefined;
  const toolSource = extractToolSource(params, context?.mcpServiceName);

  return {
    eventId: entry.eventId,
    sessionId: entry.sid,
    timestamp: entry.ts,
    agentId: entry.agentId ?? 'default',
    userId: entry.uid ?? 'default',
    toolCall: {
      toolName: entry.tool,
      serviceName: context?.mcpServiceName?.trim() || 'tools/call',
      durationMs: entry.dur_ms,
      argCount: paramKeys.length,
      argKeyHashes,
      argValueTypes,
      hasAddress,
      hasAmount,
      ...(amountBucket !== undefined ? { amountBucket } : {}),
    },
    detection: {
      l0TriggeredRules,
      l1CombinedScore: entry.score,
      ...(l1Scores !== undefined && Object.keys(l1Scores).length > 0 ? { l1Scores } : {}),
      finalDecision:
        entry.dec === 'ESCALATE'
          ? 'WARN'
          : (entry.dec as 'ALLOW' | 'BLOCK' | 'WARN'),
      ...(blockReason !== undefined ? { blockReason } : {}),
      ...(detectionDurationMs !== undefined ? { detectionDurationMs } : {}),
    },
    context: {
      chainDepth: agentwatchContext.chainDepth,
      ...(agentwatchContext.previousTool !== undefined
        ? { previousTool: agentwatchContext.previousTool }
        : {}),
      ...(agentwatchClient.clientName ? { clientName: agentwatchClient.clientName } : {}),
      ...(agentwatchClient.clientVersion ? { clientVersion: agentwatchClient.clientVersion } : {}),
      ...(typeof entry.tid === 'string' && entry.tid.trim().length > 0 ? { tid: entry.tid } : {}),
      ...(entry.sequence_no !== undefined ? { sequenceNo: entry.sequence_no } : {}),
      ...(metadataCounters.consecutiveFailures !== undefined
        ? { consecutiveFailures: metadataCounters.consecutiveFailures }
        : {}),
      ...(metadataCounters.frequency1m !== undefined
        ? { frequency1m: metadataCounters.frequency1m }
        : {}),
      ...(toolSource !== undefined ? { toolSource } : {}),
    },
    hmac,
    ...(typeof prevHmac === 'string' && prevHmac.length > 0 ? { prevHmac } : {}),
  };
}

function readBlockReason(params: Record<string, unknown>): string | undefined {
  const raw = params['blockReason'];
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return undefined;
  }
  return raw.trim();
}

function extractToolSource(
  params: Record<string, unknown>,
  mcpServiceName?: string,
): string | undefined {
  const candidates = [
    params['tool_source'],
    params['source'],
    params['_meta'] !== null && typeof params['_meta'] === 'object' && !Array.isArray(params['_meta'])
      ? (params['_meta'] as Record<string, unknown>)['tool_source']
      : undefined,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  if (mcpServiceName !== undefined && mcpServiceName.trim().length > 0) {
    const trimmed = mcpServiceName.trim();
    if (trimmed !== 'tools/call' && trimmed !== 'unknown-mcp-server') {
      return trimmed;
    }
  }

  return undefined;
}

function mapL0TriggeredRules(rules: TriggeredRule[]): CloudEventPayload['detection']['l0TriggeredRules'] {
  return rules.map((rule) => {
    const matchedFields = serializeMatchedFields(rule.matchedValue);
    return {
      ruleId: rule.ruleId,
      severity: rule.severity,
      ...(matchedFields !== undefined ? { matchedFields } : {}),
    };
  });
}

function serializeMatchedFields(raw: unknown): Record<string, unknown> | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    out[key] = sanitizeMatchedValue(value);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeMatchedValue(value: unknown): unknown {
  if (typeof value === 'string') {
    if (value.length <= MATCHED_STRING_MAX) {
      return value;
    }
    return `${value.slice(0, MATCHED_STRING_MAX)}…(${String(value.length)})`;
  }
  return value;
}

function extractMetadataCounters(
  rules: TriggeredRule[],
): { consecutiveFailures?: number; frequency1m?: number } {
  let consecutiveFailures: number | undefined;
  let frequency1m: number | undefined;

  for (const rule of rules) {
    const fields = rule.matchedValue;
    if (fields === null || typeof fields !== 'object' || Array.isArray(fields)) {
      continue;
    }
    const record = fields as Record<string, unknown>;
    const failures = record['metadata.consecutive_failures'];
    if (typeof failures === 'number' && Number.isFinite(failures)) {
      consecutiveFailures = Math.trunc(failures);
    }
    const frequency = record['metadata.frequency_1m'];
    if (typeof frequency === 'number' && Number.isFinite(frequency)) {
      frequency1m = Math.trunc(frequency);
    }
  }

  const result: { consecutiveFailures?: number; frequency1m?: number } = {};
  if (consecutiveFailures !== undefined) {
    result.consecutiveFailures = consecutiveFailures;
  }
  if (frequency1m !== undefined) {
    result.frequency1m = frequency1m;
  }
  return result;
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
