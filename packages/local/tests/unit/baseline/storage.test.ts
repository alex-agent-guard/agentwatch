import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BaselineStorage } from '../../../src/baseline/BaselineStorage.js';
import { DatabaseManager } from '../../../src/storage/DatabaseManager.js';

describe('BaselineStorage', () => {
  let previousHome: string | undefined;
  let storage: BaselineStorage;

  beforeEach(() => {
    previousHome = process.env['HOME'];
    process.env['HOME'] = mkdtempSync(join(tmpdir(), 'agentwatch-baseline-test-'));
    storage = new BaselineStorage();
  });

  afterEach(() => {
    BaselineStorage.setLogger(null);
    DatabaseManager.getInstance().close();
    if (previousHome === undefined) {
      delete process.env['HOME'];
    } else {
      process.env['HOME'] = previousHome;
    }
    vi.useRealTimers();
  });

  it('persists and loads baseline data for a user/agent pair', () => {
    const payload = {
      version: 'v0',
      dimensions: { amount: { mean: 100, std: 10 } },
    };

    storage.save('user-a', 'agent-a', payload);
    expect(storage.load('user-a', 'agent-a')).toEqual(payload);
    expect(storage.load('user-a', 'missing-agent')).toBeNull();
  });

  it('isolates baselines across user_id and agent_id combinations', () => {
    storage.save('user-1', 'agent-x', { tag: 'u1-x' });
    storage.save('user-1', 'agent-y', { tag: 'u1-y' });
    storage.save('user-2', 'agent-x', { tag: 'u2-x' });

    expect(storage.load('user-1', 'agent-x')).toEqual({ tag: 'u1-x' });
    expect(storage.load('user-1', 'agent-y')).toEqual({ tag: 'u1-y' });
    expect(storage.load('user-2', 'agent-x')).toEqual({ tag: 'u2-x' });
    expect(storage.load('user-2', 'agent-y')).toBeNull();
  });

  it('overwrites existing baseline and refreshes updated_at on repeated save', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-04T00:00:00.000Z'));

    storage.save('user-upsert', 'agent-upsert', { count: 1 });
    const db = DatabaseManager.getInstance().getDb();
    const firstRow = db
      .prepare(
        'SELECT data, updated_at FROM baselines WHERE user_id = ? AND agent_id = ?',
      )
      .get('user-upsert', 'agent-upsert') as { data: string; updated_at: number };

    vi.setSystemTime(new Date('2026-07-04T01:00:00.000Z'));
    storage.save('user-upsert', 'agent-upsert', { count: 2 });

    const secondRow = db
      .prepare(
        'SELECT data, updated_at FROM baselines WHERE user_id = ? AND agent_id = ?',
      )
      .get('user-upsert', 'agent-upsert') as { data: string; updated_at: number };

    expect(JSON.parse(firstRow.data)).toEqual({ count: 1 });
    expect(JSON.parse(secondRow.data)).toEqual({ count: 2 });
    expect(secondRow.updated_at).toBeGreaterThan(firstRow.updated_at);
    expect(storage.load('user-upsert', 'agent-upsert')).toEqual({ count: 2 });
  });

  it('returns null and logs alert when stored JSON is corrupt', async () => {
    const logAlert = vi.fn().mockResolvedValue(undefined);
    const faultyStorage = new BaselineStorage({ logger: { logAlert } });

    const db = DatabaseManager.getInstance().getDb();
    db.prepare(
      `INSERT INTO baselines (user_id, agent_id, data, updated_at) VALUES (?, ?, ?, ?)`,
    ).run('user-bad', 'agent-bad', '{not-json', Date.now());

    expect(faultyStorage.load('user-bad', 'agent-bad')).toBeNull();
    expect(logAlert).toHaveBeenCalledOnce();
    expect(logAlert.mock.calls[0]?.[0]?.scenario).toBe('baseline_storage_fault');
  });
});
