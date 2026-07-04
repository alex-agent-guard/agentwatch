import { existsSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DataMasker, MaskLevel } from '../../../src/privacy/DataMasker.js';
import {
  assertHmacKeyPermissions,
  HMACChain,
  type HmacChainSignedEntry,
} from '../../../src/privacy/HMACChain.js';
import { HmacChainSigner } from '../../../src/privacy/HmacChainSigner.js';

import type { BehaviorLogEntry } from '@packages/shared/types';

const GENESIS_HMAC = '0'.repeat(64);

describe('DataMasker', () => {
  const sampleParams = { amount: 1000, note: 'hello' };

  it('mask() applies four levels to the same params with expected outputs', () => {
    const full = new DataMasker({ defaultLevel: MaskLevel.FULL }).mask('transfer', sampleParams);
    expect(full.maskedValues).toEqual(sampleParams);

    const hash = new DataMasker({ defaultLevel: MaskLevel.HASH }).mask('transfer', sampleParams);
    expect(hash.maskedValues['amount']).toMatch(/^\[HASH:[0-9a-f]{8}\]$/);
    expect(hash.maskedValues['note']).toMatch(/^\[HASH:[0-9a-f]{8}\]$/);

    const type = new DataMasker({ defaultLevel: MaskLevel.TYPE }).mask('transfer', sampleParams);
    expect(type.maskedValues['amount']).toBe('<int>');
    expect(type.maskedValues['note']).toBe('<string(5)>');

    const drop = new DataMasker({ defaultLevel: MaskLevel.DROP }).mask('transfer', sampleParams);
    expect(drop.maskedValues['amount']).toBe('[REDACTED]');
    expect(drop.maskedValues['note']).toBe('[REDACTED]');
  });

  it('fromGlobalConfig() reads logging.mask and falls back to defaults on invalid input', () => {
    const masker = DataMasker.fromGlobalConfig({
      mask: { enabled: true, level: 2, sensitiveFields: ['apiKey'] },
    });
    const result = masker.mask('auth', { apiKey: 'secret-token', note: 'visible' });
    expect(result.maskedValues['apiKey']).toBe('[REDACTED]');
    expect(result.maskedValues['note']).toBe('<string(7)>');

    const fallback = DataMasker.fromGlobalConfig(null);
    const fallbackResult = fallback.mask('demo', { amount: 42 });
    expect(fallbackResult.maskedValues['amount']).toMatch(/^\[HASH:[0-9a-f]{8}\]$/);
  });

  it('mask() applies four levels to all params', () => {
    const masker = new DataMasker({ defaultLevel: MaskLevel.HASH });
    const result = masker.mask('transfer', {
      amount: 1000,
      note: 'hello',
    });

    expect(result.originalKeys).toEqual(['amount', 'note']);
    expect(result.maskedValues['amount']).toMatch(/^\[HASH:[0-9a-f]{8}\]$/);
    expect(result.maskedValues['note']).toMatch(/^\[HASH:[0-9a-f]{8}\]$/);
    expect(result.hashes['amount']).toHaveLength(64);
    expect(result.typeSignatures['note']).toBe('string(5)');
  });

  it('mask() TYPE level replaces values with type signatures', () => {
    const masker = new DataMasker({ defaultLevel: MaskLevel.TYPE });
    const result = masker.mask('read_file', { path: '/tmp/demo.txt' });
    expect(result.maskedValues['path']).toBe('<string(13)>');
  });

  it('mask() DROP level redacts sensitive rule matches', () => {
    const masker = new DataMasker({
      sensitiveFields: ['apiKey'],
      defaultLevel: MaskLevel.FULL,
    });
    const result = masker.mask('auth', { apiKey: 'secret-token', ok: true });
    expect(result.maskedValues['apiKey']).toBe('[REDACTED]');
    expect(result.maskedValues['ok']).toBe(true);
  });

  it('getTypeSignature detects address and datetime patterns', () => {
    const masker = new DataMasker({ defaultLevel: MaskLevel.TYPE });
    const result = masker.mask('demo', {
      wallet: `0x${'a'.repeat(40)}`,
      created: '2026-07-04T12:00:00Z',
    });
    expect(result.typeSignatures['wallet']).toBe('address');
    expect(result.typeSignatures['created']).toBe('datetime');
  });
});

function createIsolatedHome(): string {
  return mkdtempSync(join(tmpdir(), 'agentwatch-hmac-test-'));
}

function createMemoryHmacDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE hmac_chain (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      log_hash TEXT NOT NULL,
      prev_hash TEXT NOT NULL,
      hmac TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  return db;
}

function sampleLogFields(overrides?: Partial<HmacChainSignedEntry>) {
  return {
    ts: 1_704_000_000_000,
    sid: 'sess-1',
    seq: 1,
    tool: 'transfer',
    dec: 'ALLOW' as const,
    ...overrides,
  };
}

function sampleEntry(overrides?: Partial<BehaviorLogEntry>): BehaviorLogEntry {
  return {
    eventId: 'evt-1',
    ts: 1_704_000_000_000,
    sid: 'sess-1',
    tid: 'tid-1',
    tool: 'transfer',
    dec: 'ALLOW',
    score: 0.1,
    dur_ms: 12,
    sequence_no: 1,
    ...overrides,
  };
}

describe('HMACChain', () => {
  let previousHome: string | undefined;
  let isolatedHome: string;

  beforeEach(() => {
    previousHome = process.env['HOME'];
    isolatedHome = createIsolatedHome();
    process.env['HOME'] = isolatedHome;
  });

  afterEach(() => {
    if (previousHome === undefined) {
      delete process.env['HOME'];
    } else {
      process.env['HOME'] = previousHome;
    }
  });

  it('sign + verifyChain passes for a full valid chain', () => {
    const chain = new HMACChain();
    const firstFields = sampleLogFields({ seq: 1 });
    const secondFields = sampleLogFields({ seq: 2, tool: 'read_file' });
    const entries: HmacChainSignedEntry[] = [
      { ...firstFields, hmac: chain.sign(firstFields) },
      { ...secondFields, hmac: chain.sign(secondFields) },
    ];

    expect(chain.verifyChain(entries)).toEqual({ valid: true });
  });

  it('verifyChain returns tamperedIndex when a field is modified', () => {
    const chain = new HMACChain();
    const firstFields = sampleLogFields({ seq: 1 });
    const secondFields = sampleLogFields({ seq: 2 });
    const entries: HmacChainSignedEntry[] = [
      { ...firstFields, hmac: chain.sign(firstFields) },
      { ...secondFields, hmac: chain.sign(secondFields) },
    ];

    const tampered: HmacChainSignedEntry[] = [
      entries[0]!,
      { ...entries[1]!, dec: 'BLOCK' },
    ];

    const result = chain.verifyChain(tampered);
    expect(result.valid).toBe(false);
    expect(result.tamperedIndex).toBe(1);
  });

  it('verifyChain passes for 10 consecutive signed entries', () => {
    const chain = new HMACChain();
    const entries: HmacChainSignedEntry[] = [];

    for (let seq = 1; seq <= 10; seq += 1) {
      const fields = sampleLogFields({ seq, tool: `tool_${String(seq)}` });
      entries.push({ ...fields, hmac: chain.sign(fields) });
    }

    expect(chain.verifyChain(entries)).toEqual({ valid: true });
  });

  it('continues chain after simulated process restart with persisted key', () => {
    const firstProcess = new HMACChain();
    const entries: HmacChainSignedEntry[] = [];

    for (let seq = 1; seq <= 5; seq += 1) {
      const fields = sampleLogFields({ seq });
      entries.push({ ...fields, hmac: firstProcess.sign(fields) });
    }

    const keyPath = firstProcess.getKeyPath();
    const restoredHead = firstProcess.getLastHmac();

    const secondProcess = new HMACChain({
      keyPath,
      initialLastHmac: restoredHead,
    });

    for (let seq = 6; seq <= 10; seq += 1) {
      const fields = sampleLogFields({ seq });
      entries.push({ ...fields, hmac: secondProcess.sign(fields) });
    }

    const verifier = new HMACChain({ keyPath });
    expect(verifier.verifyChain(entries)).toEqual({ valid: true });
  });

  it('auto-creates ~/.agentwatch/.hmac_key with mode 0o600', () => {
    const chain = new HMACChain();
    const keyPath = chain.getKeyPath();

    expect(existsSync(keyPath)).toBe(true);
    expect(assertHmacKeyPermissions(keyPath)).toBe(true);
    expect((statSync(keyPath).mode & 0o777)).toBe(0o600);
  });

  it('reuses existing key file on subsequent instances', () => {
    const first = new HMACChain();
    const firstKeyPath = first.getKeyPath();
    const firstHmac = first.sign(sampleLogFields());

    const second = new HMACChain({ initialLastHmac: first.getLastHmac() });
    const secondHmac = second.sign(sampleLogFields({ seq: 2 }));

    expect(second.getKeyPath()).toBe(firstKeyPath);
    expect(firstHmac).not.toBe(secondHmac);
  });

  it('routes file errors to onError without throwing', () => {
    const errors: string[] = [];
    const chain = new HMACChain({
      keyPath: join(isolatedHome, '.agentwatch', 'readonly', '.hmac_key'),
      onError: (message) => {
        errors.push(message);
      },
    });

    const hmac = chain.sign(sampleLogFields());
    expect(hmac).toMatch(/^[0-9a-f]{64}$/);
    expect(errors.length).toBeGreaterThanOrEqual(0);
  });
});

describe('HmacChainSigner', () => {
  let previousHome: string | undefined;

  beforeEach(() => {
    previousHome = process.env['HOME'];
    process.env['HOME'] = createIsolatedHome();
  });

  afterEach(() => {
    if (previousHome === undefined) {
      delete process.env['HOME'];
    } else {
      process.env['HOME'] = previousHome;
    }
  });

  it('signEntry chains prev_hmac from genesis across consecutive entries', () => {
    const signer = HmacChainSigner.loadFromDatabase(createMemoryHmacDb());
    const first = signer.signEntry(sampleEntry({ sequence_no: 1 }));
    const second = signer.signEntry(sampleEntry({ eventId: 'evt-2', sequence_no: 2 }));

    expect(first.prev_hmac).toBe(GENESIS_HMAC);
    expect(first.hmac).toMatch(/^[0-9a-f]{64}$/);
    expect(second.prev_hmac).toBe(first.hmac);
    expect(second.hmac).not.toBe(first.hmac);
  });

  it('verifyChain detects tampered BehaviorLogEntry rows', () => {
    const signer = HmacChainSigner.loadFromDatabase(createMemoryHmacDb());
    const entries = [
      signer.signEntry(sampleEntry({ sequence_no: 1 })),
      signer.signEntry(sampleEntry({ eventId: 'evt-2', sequence_no: 2 })),
    ];

    expect(signer.verifyChain(entries)).toEqual({ valid: true });

    const tampered = [...entries];
    tampered[1] = { ...entries[1]!, dec: 'BLOCK' };
    const result = signer.verifyChain(tampered);
    expect(result.valid).toBe(false);
    expect(result.tamperedIndex).toBe(1);
  });

  it('persistLink stores rows in hmac_chain table', () => {
    const db = createMemoryHmacDb();
    const signer = HmacChainSigner.loadFromDatabase(db);
    const signed = signer.signEntry(sampleEntry());
    signer.persistLink(db, signed);

    const row = db
      .prepare('SELECT log_hash, prev_hash, hmac FROM hmac_chain LIMIT 1')
      .get() as { log_hash: string; prev_hash: string; hmac: string };

    expect(row.hmac).toBe(signed.hmac);
    expect(row.prev_hash).toBe(GENESIS_HMAC);
    expect(row.log_hash).toMatch(/^[0-9a-f]{64}$/);
    db.close();
  });

  it('loadFromDatabase restores last chain head from SQLite', () => {
    const db = createMemoryHmacDb();
    const signer = HmacChainSigner.loadFromDatabase(db);
    const signed = signer.signEntry(sampleEntry());
    signer.persistLink(db, signed);

    const restored = HmacChainSigner.loadFromDatabase(db);
    const next = restored.signEntry(sampleEntry({ eventId: 'evt-2', sequence_no: 2 }));

    expect(next.prev_hmac).toBe(signed.hmac);
    db.close();
  });
});
