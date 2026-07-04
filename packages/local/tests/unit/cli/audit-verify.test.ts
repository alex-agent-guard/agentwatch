import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  auditVerifyExitCode,
  formatAuditVerifyHuman,
  formatAuditVerifyJson,
  resolveAuditLogPath,
  verifyAuditLogFile,
} from '../../../src/cli/lib/audit-verify.js';
import { HMACChain, type HmacChainSignedEntry } from '../../../src/privacy/HMACChain.js';

function buildSignedJsonl(
  chain: HMACChain,
  count: number,
  keyPath: string,
): { filePath: string; entries: HmacChainSignedEntry[] } {
  const dir = join(keyPath, '..');
  mkdirSync(dir, { recursive: true });

  const signed: HmacChainSignedEntry[] = [];
  for (let seq = 1; seq <= count; seq += 1) {
    const fields = {
      ts: 1_722_000_000_000 + seq * 60_000,
      sid: 'sid_test',
      seq,
      tool: `tool_${String(seq)}`,
      dec: 'ALLOW',
    };
    signed.push({ ...fields, hmac: chain.sign(fields) });
  }

  const lines = signed.map((entry) =>
    JSON.stringify({
      eventId: `evt_${String(entry.seq)}`,
      ts: entry.ts,
      sid: entry.sid,
      sequence_no: entry.seq,
      tool: entry.tool,
      dec: entry.dec,
      _meta: { hmac: entry.hmac, v: '1' },
    }),
  );

  const filePath = join(dir, 'log.jsonl');
  writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
  return { filePath, entries: signed };
}

describe('audit-verify', () => {
  let previousHome: string | undefined;
  let homeDir = '';

  beforeEach(() => {
    previousHome = process.env['HOME'];
    homeDir = mkdtempSync(join(tmpdir(), 'agentwatch-audit-verify-'));
    process.env['HOME'] = homeDir;
  });

  afterEach(() => {
    if (previousHome === undefined) {
      delete process.env['HOME'];
    } else {
      process.env['HOME'] = previousHome;
    }
  });

  it('verifyAuditLogFile passes for valid chain with _meta.hmac', () => {
    const keyPath = join(homeDir, '.agentwatch', '.hmac_key');
    const chain = new HMACChain({ keyPath });
    const { filePath } = buildSignedJsonl(chain, 3, keyPath);

    const result = verifyAuditLogFile(filePath, { keyPath });
    expect(result.valid).toBe(true);
    expect(result.count).toBe(3);
    expect(result.tamperedIndex).toBeNull();
    expect(result.firstTs).toBe(1_722_000_060_000);
    expect(result.lastTs).toBe(1_722_000_180_000);
  });

  it('detects tampered chain and returns tamperedIndex', () => {
    const keyPath = join(homeDir, '.agentwatch', '.hmac_key');
    const chain = new HMACChain({ keyPath });
    const { filePath, entries } = buildSignedJsonl(chain, 5, keyPath);

    writeFileSync(
      filePath,
      [
        JSON.stringify({
          eventId: 'evt_1',
          ts: entries[0]!.ts,
          sid: entries[0]!.sid,
          sequence_no: 1,
          tool: entries[0]!.tool,
          dec: entries[0]!.dec,
          _meta: { hmac: entries[0]!.hmac },
        }),
        JSON.stringify({
          eventId: 'evt_2',
          ts: entries[1]!.ts,
          sid: entries[1]!.sid,
          sequence_no: 2,
          tool: entries[1]!.tool,
          dec: entries[1]!.dec,
          _meta: { hmac: entries[1]!.hmac },
        }),
        JSON.stringify({
          eventId: 'evt_3',
          ts: entries[2]!.ts,
          sid: entries[2]!.sid,
          sequence_no: 3,
          tool: entries[2]!.tool,
          dec: 'BLOCK',
          _meta: { hmac: entries[2]!.hmac },
        }),
      ].join('\n'),
      'utf8',
    );

    const result = verifyAuditLogFile(filePath, { keyPath });
    expect(result.valid).toBe(false);
    expect(result.tamperedIndex).toBe(2);
    expect(result.count).toBe(3);
  });

  it('returns error when log file is missing', () => {
    const result = verifyAuditLogFile(join(homeDir, 'missing.jsonl'));
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Log file not found');
    expect(auditVerifyExitCode(result)).toBe(1);
  });

  it('returns error when no signed entries exist', () => {
    const filePath = join(homeDir, 'empty-signed.jsonl');
    writeFileSync(
      filePath,
      `${JSON.stringify({ eventId: 'e1', ts: Date.now(), dec: 'ALLOW' })}\n`,
      'utf8',
    );

    const result = verifyAuditLogFile(filePath);
    expect(result.error).toBe('No signed entries found');
    expect(auditVerifyExitCode(result)).toBe(1);
  });

  it('formatAuditVerifyHuman prints intact message with timestamps', () => {
    const text = formatAuditVerifyHuman({
      valid: true,
      count: 127,
      tamperedIndex: null,
      firstTs: Date.parse('2026-07-04T10:00:00.000Z'),
      lastTs: Date.parse('2026-07-04T11:30:00.000Z'),
    });

    expect(text).toContain('✅ Chain verified: 127 entries intact');
    expect(text).toContain('First: 2026-07-04T10:00:00.000Z');
    expect(text).toContain('Last:  2026-07-04T11:30:00.000Z');
  });

  it('formatAuditVerifyJson matches Kimi schema', () => {
    const json = formatAuditVerifyJson({
      valid: true,
      count: 127,
      tamperedIndex: null,
    });
    expect(JSON.parse(json)).toEqual({
      valid: true,
      count: 127,
      tamperedIndex: null,
    });
  });

  it('formatAuditVerifyHuman prints broken entry index as 1-based', () => {
    const text = formatAuditVerifyHuman({
      valid: false,
      count: 127,
      tamperedIndex: 48,
      firstTs: 1,
      lastTs: 2,
    });
    expect(text).toContain('❌ Chain broken at entry #49');
  });

  it('resolveAuditLogPath rejects empty --file with parameter error', () => {
    const resolved = resolveAuditLogPath('   ');
    expect(resolved).toEqual({ error: 'Invalid --file: path must not be empty' });
    expect(auditVerifyExitCode({ valid: false, count: 0, tamperedIndex: null }, { parameterError: true })).toBe(2);
  });
});
