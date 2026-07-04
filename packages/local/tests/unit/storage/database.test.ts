import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  assertAgentWatchDbPermissions,
  DatabaseManager,
} from '../../../src/storage/DatabaseManager.js';

const EXPECTED_TABLES = [
  'baselines',
  'upload_queue',
  'hmac_chain',
  'perm_probe_tracker',
];

describe('DatabaseManager', () => {
  let previousHome: string | undefined;

  beforeEach(() => {
    previousHome = process.env['HOME'];
    process.env['HOME'] = mkdtempSync(join(tmpdir(), 'agentwatch-db-test-'));
  });

  afterEach(() => {
    DatabaseManager.getInstance().close();
    if (previousHome === undefined) {
      delete process.env['HOME'];
    } else {
      process.env['HOME'] = previousHome;
    }
  });

  it('returns a singleton instance', () => {
    const first = DatabaseManager.getInstance();
    const second = DatabaseManager.getInstance();
    expect(first).toBe(second);
  });

  it('initializes all persistence tables on first open', () => {
    const manager = DatabaseManager.getInstance();
    const rows = manager
      .getDb()
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      )
      .all() as Array<{ name: string }>;

    expect(rows.map((row) => row.name).sort()).toEqual([...EXPECTED_TABLES].sort());
  });

  it('creates upload_queue retry index', () => {
    const manager = DatabaseManager.getInstance();
    const index = manager
      .getDb()
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_next_retry'`)
      .get() as { name: string } | undefined;

    expect(index?.name).toBe('idx_next_retry');
  });

  it('allows close and re-open after singleton reset', () => {
    const first = DatabaseManager.getInstance();
    first.close();

    const second = DatabaseManager.getInstance();
    expect(second).not.toBe(first);
    expect(second.getDb().prepare('SELECT 1 AS ok').get()).toEqual({ ok: 1 });
  });

  it('sets agentwatch.db file permissions to 0o600 on init', () => {
    const manager = DatabaseManager.getInstance();
    const dbPath = manager.getDbPath();
    expect(assertAgentWatchDbPermissions(dbPath)).toBe(true);
  });
});
