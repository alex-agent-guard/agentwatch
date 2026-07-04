import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initCommand } from '../../../src/cli/commands/init.js';
import { logsCommand } from '../../../src/cli/commands/logs.js';
import { statusCommand } from '../../../src/cli/commands/status.js';
import {
  backupMcpConfigFile,
  injectOkxProxyConfig,
} from '../../../src/cli/lib/mcp-config.js';
import {
  countRecentRiskEvents,
  parseSinceArgument,
  readLogEntries,
  readLogIncrement,
} from '../../../src/cli/lib/log-reader.js';
import { DatabaseManager } from '../../../src/storage/DatabaseManager.js';

describe('CLI init', () => {
  let previousHome: string | undefined;
  let homeDir = '';

  beforeEach(() => {
    previousHome = process.env['HOME'];
    homeDir = mkdtempSync(join(tmpdir(), 'agentwatch-cli-init-'));
    process.env['HOME'] = homeDir;
  });

  afterEach(() => {
    if (previousHome === undefined) {
      delete process.env['HOME'];
    } else {
      process.env['HOME'] = previousHome;
    }
  });

  it('backs up MCP config and injects okx proxy entry', () => {
    const onchainDir = join(homeDir, '.onchainos');
    mkdirSync(onchainDir, { recursive: true });
    const mcpPath = join(onchainDir, 'mcp.json');
    writeFileSync(
      mcpPath,
      JSON.stringify({
        mcpServers: {
          okx: {
            command: 'npx',
            args: ['-y', '@okxguild/mcp-server-okx'],
          },
        },
      }),
      'utf8',
    );

    const logSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    initCommand();

    const backupFiles = readdirSync(onchainDir);
    expect(backupFiles.some((name) => name.startsWith('mcp.json.backup.'))).toBe(true);

    const updated = JSON.parse(readFileSync(mcpPath, 'utf8')) as {
      mcpServers: { okx: { args: string[] } };
    };
    expect(updated.mcpServers.okx.args).toContain('@agentwatch-web3/cli');
    expect(existsSync(join(homeDir, '.agentwatch', 'config.yaml'))).toBe(true);
    logSpy.mockRestore();
  });

  it('prints manual guide when no MCP config exists', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    initCommand();

    expect(warnSpy).toHaveBeenCalled();
    expect(infoSpy.mock.calls.some((call) => String(call[0]).includes('手动'))).toBe(true);

    warnSpy.mockRestore();
    infoSpy.mockRestore();
  });
});

describe('CLI mcp-config helpers', () => {
  it('injectOkxProxyConfig aligns with architecture §3.8', () => {
    const configPath = '/Users/alice/.agentwatch/config.yaml';
    const patched = injectOkxProxyConfig({ mcpServers: {} }, configPath);
    expect(patched.mcpServers?.['okx']?.args).toEqual([
      '-y',
      '@agentwatch-web3/cli',
      '--config',
      configPath,
      '--',
      'npx',
      '-y',
      '@okx_ai/okx-trade-mcp',
    ]);
  });

  it('backupMcpConfigFile uses timestamp suffix', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentwatch-backup-'));
    const file = join(dir, 'mcp.json');
    writeFileSync(file, '{}', 'utf8');
    const backupPath = backupMcpConfigFile(file, 123);
    expect(backupPath).toContain('mcp.json.backup.123');
    expect(existsSync(backupPath!)).toBe(true);
  });
});

describe('CLI status', () => {
  let previousHome: string | undefined;
  let homeDir = '';

  beforeEach(() => {
    previousHome = process.env['HOME'];
    homeDir = mkdtempSync(join(tmpdir(), 'agentwatch-cli-status-'));
    process.env['HOME'] = homeDir;
    mkdirSync(join(homeDir, '.agentwatch'), { recursive: true });
    writeFileSync(
      join(homeDir, '.agentwatch', 'config.yaml'),
      [
        'agentId: "agent_test"',
        'userId: "usr_test"',
        'cloud:',
        '  enabled: false',
      ].join('\n'),
      'utf8',
    );
  });

  afterEach(() => {
    try {
      DatabaseManager.getInstance().close();
    } catch {
      // ignore
    }
    if (previousHome === undefined) {
      delete process.env['HOME'];
    } else {
      process.env['HOME'] = previousHome;
    }
  });

  it('runs full status self-check without throwing', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    await statusCommand();
    expect(infoSpy).toHaveBeenCalled();
    infoSpy.mockRestore();
  });

  it('reads baseline tier from SQLite', async () => {
    DatabaseManager.getInstance()
      .getDb()
      .prepare(
        'INSERT INTO baselines (user_id, agent_id, data, updated_at) VALUES (?, ?, ?, ?)',
      )
      .run('usr_test', 'agent_test', JSON.stringify({ totalCalls: 55 }), Date.now());

    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    await statusCommand();
    expect(infoSpy.mock.calls.some((call) => String(call[0]).includes('L2'))).toBe(true);
    infoSpy.mockRestore();
  });
});

describe('CLI logs', () => {
  let logPath = '';

  beforeEach(() => {
    logPath = join(mkdtempSync(join(tmpdir(), 'agentwatch-cli-logs-')), 'log.jsonl');
    writeFileSync(
      logPath,
      [
        JSON.stringify({ ts: 1000, dec: 'ALLOW', tool: 'a', _meta: { hmac: 'a'.repeat(64) } }),
        JSON.stringify({ ts: 2000, dec: 'WARN', tool: 'b', _meta: { hmac: 'b'.repeat(64) } }),
        JSON.stringify({ ts: 3000, dec: 'BLOCK', tool: 'c', _meta: { hmac: 'c'.repeat(64) } }),
      ].join('\n') + '\n',
      'utf8',
    );
  });

  it('filters by level and tail', () => {
    const warnEntries = readLogEntries(logPath, { level: 'warn', tail: 10 });
    expect(warnEntries).toHaveLength(1);
    expect(warnEntries[0]?.dec).toBe('WARN');

    const tailed = readLogEntries(logPath, { tail: 1 });
    expect(tailed).toHaveLength(1);
    expect(tailed[0]?.dec).toBe('BLOCK');
  });

  it('parses since timestamp and duration', () => {
    const now = 10_000;
    expect(parseSinceArgument('5000', now)).toBe(5000);
    expect(parseSinceArgument('1h', now)).toBe(now - 3_600_000);
  });

  it('counts recent BLOCK/WARN events', () => {
    const counts = countRecentRiskEvents(logPath, 10_000, 5000);
    expect(counts.block).toBe(1);
    expect(counts.warn).toBe(1);
  });

  it('follow mode reads increment from offset', () => {
    const first = readLogIncrement(logPath, 0, {});
    expect(first.lines.length).toBeGreaterThan(0);

    writeFileSync(
      logPath,
      `${readFileSync(logPath, 'utf8')}${JSON.stringify({ ts: 4000, dec: 'BLOCK', _meta: { hmac: 'd'.repeat(64) } })}\n`,
      'utf8',
    );

    const second = readLogIncrement(logPath, first.nextOffset, {});
    expect(second.lines.length).toBe(1);
  });

  it('logsCommand prints friendly message when file missing', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const previousHome = process.env['HOME'];
    process.env['HOME'] = mkdtempSync(join(tmpdir(), 'agentwatch-cli-logs-missing-'));

    logsCommand({ tail: '10' });

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
    process.env['HOME'] = previousHome;
  });
});
