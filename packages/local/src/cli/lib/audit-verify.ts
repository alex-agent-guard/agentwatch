import { existsSync } from 'node:fs';

import { HMACChain, type HmacChainSignedEntry } from '../../privacy/HMACChain.js';

import { getAgentWatchLogPath } from './paths.js';
import { readLogEntries, type CliLogEntry } from './log-reader.js';

/** audit verify --json 输出 */
export interface AuditVerifyJsonResult {
  valid: boolean;
  count: number;
  tamperedIndex: number | null;
}

/** verifyAuditLogFile 内部结果 */
export interface AuditVerifyResult extends AuditVerifyJsonResult {
  firstTs?: number;
  lastTs?: number;
  error?: string;
}

export interface AuditVerifyOptions {
  /** HMAC 密钥路径 — 默认 ~/.agentwatch/.hmac_key */
  keyPath?: string;
}

function normalizeSignedEntry(entry: CliLogEntry): HmacChainSignedEntry | null {
  const hmac =
    (typeof entry._meta?.hmac === 'string' ? entry._meta.hmac : undefined) ??
    (typeof entry.hmac === 'string' ? entry.hmac : undefined);

  if (hmac === undefined || hmac.length === 0) {
    return null;
  }

  const ts = typeof entry.ts === 'number' ? entry.ts : 0;
  const sid = typeof entry.sid === 'string' ? entry.sid : '';
  const seq =
    typeof entry.sequence_no === 'number'
      ? entry.sequence_no
      : typeof (entry as { seq?: number }).seq === 'number'
        ? (entry as { seq: number }).seq
        : 0;
  const tool = typeof entry.tool === 'string' ? entry.tool : '';
  const dec = typeof entry.dec === 'string' ? entry.dec : 'ALLOW';

  return { ts, sid, seq, tool, dec, hmac };
}

/** 读取 JSONL 并验证 HMAC 链 — 不修改 HMACChain 核心算法 */
export function verifyAuditLogFile(
  filePath: string,
  options?: AuditVerifyOptions,
): AuditVerifyResult {
  if (!existsSync(filePath)) {
    return {
      valid: false,
      count: 0,
      tamperedIndex: null,
      error: `Log file not found: ${filePath}`,
    };
  }

  const entries = readLogEntries(filePath);
  const signed: HmacChainSignedEntry[] = [];

  for (const entry of entries) {
    const normalized = normalizeSignedEntry(entry);
    if (normalized !== null) {
      signed.push(normalized);
    }
  }

  if (signed.length === 0) {
    return {
      valid: false,
      count: 0,
      tamperedIndex: null,
      error: 'No signed entries found',
    };
  }

  const chainOptions =
    options?.keyPath !== undefined ? { keyPath: options.keyPath } : undefined;
  const chain = new HMACChain(chainOptions);
  const verifyResult = chain.verifyChain(signed);

  const firstTs = signed[0]?.ts;
  const lastTs = signed[signed.length - 1]?.ts;

  if (!verifyResult.valid) {
    return {
      valid: false,
      count: signed.length,
      tamperedIndex: verifyResult.tamperedIndex ?? null,
      ...(firstTs !== undefined ? { firstTs } : {}),
      ...(lastTs !== undefined ? { lastTs } : {}),
    };
  }

  return {
    valid: true,
    count: signed.length,
    tamperedIndex: null,
    ...(firstTs !== undefined ? { firstTs } : {}),
    ...(lastTs !== undefined ? { lastTs } : {}),
  };
}

function formatIsoTimestamp(ts: number | undefined): string {
  if (ts === undefined || !Number.isFinite(ts)) {
    return 'unknown';
  }
  return new Date(ts).toISOString();
}

/** 人类可读 stdout 文本 */
export function formatAuditVerifyHuman(result: AuditVerifyResult): string {
  if (result.error !== undefined) {
    return `❌ ${result.error}`;
  }

  const firstLine = `First: ${formatIsoTimestamp(result.firstTs)}`;
  const lastLine = `Last:  ${formatIsoTimestamp(result.lastTs)}`;

  if (result.valid) {
    return [
      `✅ Chain verified: ${String(result.count)} entries intact`,
      firstLine,
      lastLine,
    ].join('\n');
  }

  const brokenIndex =
    result.tamperedIndex !== null ? String(result.tamperedIndex + 1) : '?';

  return [
    `❌ Chain broken at entry #${brokenIndex}`,
    firstLine,
    lastLine,
  ].join('\n');
}

/** --json 模式 stdout */
export function formatAuditVerifyJson(result: AuditVerifyResult): string {
  const payload: AuditVerifyJsonResult = {
    valid: result.valid && result.error === undefined,
    count: result.count,
    tamperedIndex: result.tamperedIndex,
  };
  return JSON.stringify(payload);
}

/** CLI exit code — 0 通过，1 篡改/验证失败，2 参数错误 */
export function auditVerifyExitCode(
  result: AuditVerifyResult,
  options?: { parameterError?: boolean },
): number {
  if (options?.parameterError === true) {
    return 2;
  }
  if (result.error !== undefined || !result.valid) {
    return 1;
  }
  return 0;
}

/** 校验 --file 参数 — 无效时返回错误消息 */
export function resolveAuditLogPath(fileArg: string | undefined): string | { error: string } {
  if (fileArg === undefined) {
    return getAgentWatchLogPath();
  }

  const trimmed = fileArg.trim();
  if (trimmed.length === 0) {
    return { error: 'Invalid --file: path must not be empty' };
  }

  return trimmed;
}
