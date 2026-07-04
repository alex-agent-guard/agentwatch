import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfigManager } from '../../../src/config/config-manager.js';
import type { ProxyCommandOptions } from '../../../src/cli/proxy-runtime.js';

describe('ConfigManager.getProxyConfig AGENTWATCH_OVERRIDE_SERVER', () => {
  let previousHome: string | undefined;
  let previousOverride: string | undefined;

  beforeEach(() => {
    previousHome = process.env['HOME'];
    previousOverride = process.env['AGENTWATCH_OVERRIDE_SERVER'];
    process.env['HOME'] = mkdtempSync(join(tmpdir(), 'agentwatch-proxy-override-'));
    process.env['AGENTWATCH_API_KEY'] = 'proxy-override-test-key';
  });

  afterEach(() => {
    if (previousHome === undefined) {
      delete process.env['HOME'];
    } else {
      process.env['HOME'] = previousHome;
    }
    if (previousOverride === undefined) {
      delete process.env['AGENTWATCH_OVERRIDE_SERVER'];
    } else {
      process.env['AGENTWATCH_OVERRIDE_SERVER'] = previousOverride;
    }
  });

  it('returns default server when override env is unset', () => {
    delete process.env['AGENTWATCH_OVERRIDE_SERVER'];
    const config = new ConfigManager().getProxyConfig();
    expect(config.server.command).toBe('node');
    expect(config.server.args).toEqual([]);
  });

  it('merges AGENTWATCH_OVERRIDE_SERVER into server.command/args', () => {
    process.env['AGENTWATCH_OVERRIDE_SERVER'] = JSON.stringify({
      command: 'npx',
      args: ['-y', '@okxguild/mcp-server-okx'],
    });

    const config = new ConfigManager().getProxyConfig();
    expect(config.server.command).toBe('npx');
    expect(config.server.args).toEqual(['-y', '@okxguild/mcp-server-okx']);
  });
});

describe('ProxyCommandOptions', () => {
  it('accepts optional config path', () => {
    const options: ProxyCommandOptions = { config: '/tmp/config.yaml' };
    expect(options.config).toBe('/tmp/config.yaml');
  });
});
