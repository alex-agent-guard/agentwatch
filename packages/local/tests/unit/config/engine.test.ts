import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

const fsMocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

const osMocks = vi.hoisted(() => ({
  homedir: vi.fn(() => '/mock/home'),
}));

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: (...args: Parameters<typeof actual.existsSync>) => {
      const targetPath = String(args[0]);
      if (
        targetPath.includes('bootstrap-rules-') ||
        targetPath.includes('agentwatch-rules-') ||
        targetPath.includes('integration-rules-')
      ) {
        return actual.existsSync(...args);
      }
      return fsMocks.existsSync(...args);
    },
    mkdirSync: (...args: Parameters<typeof actual.mkdirSync>) => {
      fsMocks.mkdirSync(...args);
      const targetPath = String(args[0]);
      if (
        targetPath.includes('agentwatch-bootstrap-') ||
        targetPath.startsWith(tmpdir())
      ) {
        return actual.mkdirSync(...args);
      }
      return undefined;
    },
    readFileSync: (...args: Parameters<typeof actual.readFileSync>) => {
      const targetPath = String(args[0]);
      if (targetPath.endsWith('.jsonl')) {
        return actual.readFileSync(...args);
      }
      if (
        targetPath.includes('bootstrap-rules-') ||
        targetPath.includes('agentwatch-rules-') ||
        targetPath.includes('integration-rules-')
      ) {
        return actual.readFileSync(...args);
      }
      return fsMocks.readFileSync(...args);
    },
    writeFileSync: (...args: Parameters<typeof actual.writeFileSync>) => {
      const targetPath = String(args[0]);
      if (
        targetPath.includes('bootstrap-rules-') ||
        targetPath.includes('agentwatch-rules-') ||
        targetPath.includes('integration-rules-')
      ) {
        return actual.writeFileSync(...args);
      }
      return fsMocks.writeFileSync(...args);
    },
  };
});

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    homedir: () => osMocks.homedir(),
  };
});

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: spawnMock,
  };
});

import { ConfigManager } from '../../../src/config/config-manager.js';
import { loadRuleEngineRules } from '../../../src/bootstrap.js';
import { RuleEngine } from '../../../src/rule/RuleEngine.js';
import { DecisionRouter } from '../../../src/detection/DecisionRouter.js';
import { AsyncLogger } from '../../../src/logging/AsyncLogger.js';
import { MCPProxyCore } from '../../../src/proxy/MCPProxyCore.js';
import { V0_BUILTIN_RULES } from '../../../src/rule/builtin.js';
import { StatEngine } from '../../../src/stat/StatEngine.js';

import type { JSONRPCRequest, RuleSet } from '@packages/shared/types';

type StructuredConfigError = Error & {
  eventId?: string | null;
  riskType?: string;
  originalStack?: string;
};

const DEFAULT_CONFIG_PATH = '/mock/home/.agentwatch/config.yaml';

function assertStructuredConfigError(
  error: unknown,
  expected: { riskType: string; eventId?: string | null },
): asserts error is StructuredConfigError {
  expect(error).toBeInstanceOf(Error);
  const structured = error as StructuredConfigError;
  expect(structured.riskType).toBe(expected.riskType);
  if (expected.eventId !== undefined) {
    expect(structured.eventId).toBe(expected.eventId);
  }
  expect(structured.originalStack).toBeTruthy();
}

function buildMinimalYaml(overrides?: {
  maxMatchTimeMs?: number | string;
  windowSizeMs?: number | string;
  blockThreshold?: number | string;
  rulesPath?: string;
  cloudEnabled?: boolean;
  omitDetection?: boolean;
  logOutput?: string;
}): string {
  const maxMatchTimeMs = overrides?.maxMatchTimeMs ?? 10;
  const windowSizeMs = overrides?.windowSizeMs ?? 300000;
  const blockThreshold = overrides?.blockThreshold ?? 0.8;
  const rulesPath =
    overrides?.rulesPath ?? '/mock/home/.agentwatch/rules/builtin.json';
  const logOutput =
    overrides?.logOutput ?? '/mock/home/.agentwatch/log.jsonl';

  if (overrides?.omitDetection) {
    return [
      'server:',
      '  command: node',
      'performance:',
      '  maxDetectionLatencyMs: 50',
      'logging:',
      '  level: info',
      '  format: json',
      '  output: /mock/home/.agentwatch/log.jsonl',
    ].join('\n');
  }

  return [
    'server:',
    '  command: node',
    '  args:',
    '    - -e',
    '    - process.stdin.pipe(process.stdout)',
    'performance:',
    '  maxDetectionLatencyMs: 50',
    'agentWatch:',
    '  performance:',
    '    maxDetectionLatencyMs: 50',
    '  detection:',
    '    ruleEngine:',
    '      enabled: true',
    `      rulesPath: ${rulesPath}`,
    `      maxMatchTimeMs: ${String(maxMatchTimeMs)}`,
    '    statisticalEngine:',
    '      enabled: true',
    '      zScoreThreshold: 3',
    '      coldStartMinSamples: 30',
    '      combinedScoreThreshold: 0.7',
    '      maxZScoreThreshold: 4',
    '      markovAnomalyThreshold: 0.7',
    '      markovUnknownRatioThreshold: 0.5',
    '      markovSmoothingAlpha: 0.1',
    `      windowSizeMs: ${String(windowSizeMs)}`,
    '    decisionRouter:',
    `      blockThreshold: ${String(blockThreshold)}`,
    '      warnThreshold: 0.5',
    '      ruleWeight: 0.6',
    '      statWeight: 0.4',
    '  logging:',
    '    level: info',
    '    format: json',
    `    output: ${logOutput}`,
    '    mask:',
    '      enabled: true',
    '      level: 1',
    '      sensitiveFields:',
    '        - apiKey',
    '    rotation:',
    '      maxSizeMB: 100',
    '      maxFiles: 7',
    ...(overrides?.cloudEnabled === true
      ? [
          '  cloud:',
          '    enabled: true',
          '    endpoint: https://api.agentwatch.test/v1',
          '    apiKey: yaml-key',
          '    batch:',
          '      batchSize: 100',
          '      flushIntervalMs: 5000',
        ]
      : []),
  ].join('\n');
}

const BUILTIN_RULE_SET: RuleSet = {
  id: 'v0-builtin',
  name: 'V0 Built-in Rules',
  description: 'AgentWatch V0 MVP built-in L0 rule set',
  rules: V0_BUILTIN_RULES,
  priority: 0,
  defaultAction: 'ALLOW',
};

function utcDateKey(timestamp: number = Date.now()): string {
  const date = new Date(timestamp);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function tierLogPath(root: string, dateKey: string, tier: string): string {
  return join(root, dateKey, `${tier}.jsonl`);
}

function createMockChildProcess() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();

  const child = Object.assign(new EventEmitter(), {
    stdin,
    stdout,
    stderr,
    killed: false,
    kill: vi.fn((signal?: NodeJS.Signals | number) => {
      child.killed = true;
      child.emit('exit', 0, signal ?? null);
    }),
  });

  return child;
}

async function assembleGatewayFromConfigManager(configPath: string): Promise<{
  configManager: ConfigManager;
  proxy: MCPProxyCore;
  session: Awaited<ReturnType<MCPProxyCore['start']>>;
  asyncLogger: AsyncLogger;
  decisionRouter: DecisionRouter;
  clientIn: PassThrough;
  clientOut: PassThrough;
}> {
  const configManager = new ConfigManager({ configPath });
  const proxyConfig = configManager.getProxyConfig();
  const thresholds = configManager.getDetectionThresholds();

  const ruleEngineBase = new RuleEngine({
    maxMatchTimeMs: thresholds.ruleEngine.maxMatchTimeMs,
  });
  ruleEngineBase.loadRuleSet(BUILTIN_RULE_SET);

  const statEngine = new StatEngine(proxyConfig);
  statEngine.loadBuiltinBaseline();

  const decisionRouter = new DecisionRouter({
    ...(thresholds.decisionRouter.enabled !== undefined
      ? { enabled: thresholds.decisionRouter.enabled }
      : {}),
    blockThreshold: thresholds.decisionRouter.blockThreshold,
    warnThreshold: thresholds.decisionRouter.warnThreshold,
    ruleWeight: thresholds.decisionRouter.ruleWeight,
    statWeight: thresholds.decisionRouter.statWeight,
    decisionBudgetMs: 50,
  });

  const asyncLogger = new AsyncLogger(proxyConfig.agentWatch.logging, false);
  const clientIn = new PassThrough();
  const clientOut = new PassThrough();

  const proxy = new MCPProxyCore(
    proxyConfig,
    ruleEngineBase,
    statEngine,
    asyncLogger,
    decisionRouter,
    clientIn,
    clientOut,
  );

  const session = await proxy.start();

  return {
    configManager,
    proxy,
    session,
    asyncLogger,
    decisionRouter,
    clientIn,
    clientOut,
  };
}

describe('ConfigManager', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    fsMocks.existsSync.mockReturnValue(true);
    fsMocks.readFileSync.mockReturnValue(buildMinimalYaml());
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('loadYamlConfig', () => {
    it('fills defaults when yaml sections are empty', () => {
      fsMocks.readFileSync.mockReturnValue('server:\n  command: node\n');

      const manager = new ConfigManager({ configPath: '/tmp/empty.yaml' });
      const loaded = manager.loadYamlConfig('/tmp/empty.yaml');

      expect(loaded.rule.enabled).toBe(true);
      expect(loaded.rule.maxMatchTimeMs).toBe(10);
      expect(loaded.stat.windowSizeMs).toBe(300_000);
      expect(loaded.detection.decisionRouter.blockThreshold).toBe(0.8);
      expect(loaded.agentWatch.logging.level).toBe('info');
      expect(loaded.agentWatch.logging.mask.enabled).toBe(true);
      expect(loaded.agentWatch.logging.mask.level).toBe(1);
      expect(loaded.agentWatch.logging.mask.sensitiveFields).toEqual([
        'apiKey',
        'secret',
        'privateKey',
        'password',
        'mnemonic',
      ]);
      expect(loaded.proxy.server.command).toBe('node');
      expect(loaded.proxy.performance.maxDetectionLatencyMs).toBe(50);
    });

    it('auto-generates default template when config file is missing', () => {
      fsMocks.existsSync.mockReturnValue(false);

      const manager = new ConfigManager({ configPath: DEFAULT_CONFIG_PATH });
      const loaded = manager.loadYamlConfig(DEFAULT_CONFIG_PATH);

      expect(fsMocks.mkdirSync).toHaveBeenCalledWith('/mock/home/.agentwatch', {
        recursive: true,
      });
      expect(fsMocks.writeFileSync).toHaveBeenCalledWith(
        DEFAULT_CONFIG_PATH,
        expect.stringContaining('maxDetectionLatencyMs: 50'),
        'utf8',
      );
      expect(loaded.rule.maxMatchTimeMs).toBe(10);
      expect(loaded.stat.windowSizeMs).toBe(300_000);
    });
    it('falls back to mask defaults when logging.mask.level is invalid', () => {
      fsMocks.readFileSync.mockReturnValue(
        [
          'server:',
          '  command: node',
          'logging:',
          '  level: info',
          '  format: json',
          '  output: /tmp/log.jsonl',
          '  mask:',
          '    enabled: true',
          '    level: 9',
          '    sensitiveFields:',
          '      - apiKey',
        ].join('\n'),
      );

      const manager = new ConfigManager({ configPath: '/tmp/mask-invalid.yaml' });
      const logging = manager.getLoggingConfig();

      expect(logging.mask.level).toBe(1);
      expect(logging.mask.sensitiveFields).toEqual(['apiKey']);
    });

    it('uses mask defaults when logging.mask section is missing', () => {
      fsMocks.readFileSync.mockReturnValue(
        [
          'server:',
          '  command: node',
          'logging:',
          '  level: info',
          '  format: json',
          '  output: /tmp/log.jsonl',
        ].join('\n'),
      );

      const manager = new ConfigManager({ configPath: '/tmp/mask-missing.yaml' });
      const logging = manager.getLoggingConfig();

      expect(logging.mask.enabled).toBe(true);
      expect(logging.mask.level).toBe(1);
      expect(logging.mask.sensitiveFields).toEqual([
        'apiKey',
        'secret',
        'privateKey',
        'password',
        'mnemonic',
      ]);
    });
  });

  describe('readEnv', () => {
    it('reads dedicated OKX_* and AGENTWATCH_API_KEY secrets', () => {
      process.env.OKX_API_KEY = 'okx-key';
      process.env.OKX_SECRET_KEY = 'okx-secret';
      process.env.OKX_PASSPHRASE = 'okx-pass';
      process.env.AGENTWATCH_API_KEY = 'aw-key';

      const manager = new ConfigManager({ configPath: '/tmp/config.yaml' });
      const env = manager.readEnv();

      expect(env.OKX_API_KEY).toBe('okx-key');
      expect(env.OKX_SECRET_KEY).toBe('okx-secret');
      expect(env.OKX_PASSPHRASE).toBe('okx-pass');
      expect(env.AGENTWATCH_API_KEY).toBe('aw-key');
    });

    it('filters environment variables by prefix', () => {
      process.env.OKX_API_KEY = 'okx-key';
      process.env.OKX_SECRET_KEY = 'okx-secret';
      process.env.AGENTWATCH_API_KEY = 'aw-key';

      const manager = new ConfigManager({ configPath: '/tmp/config.yaml' });
      const env = manager.readEnv('OKX_');

      expect(env.OKX_API_KEY).toBe('okx-key');
      expect(env.OKX_SECRET_KEY).toBe('okx-secret');
      expect(env.AGENTWATCH_API_KEY).toBeUndefined();
    });
  });

  describe('environment overrides', () => {
    it('overrides yaml cloud apiKey and injects OKX secrets into server env', () => {
      process.env.AGENTWATCH_API_KEY = 'env-aw-key';
      process.env.OKX_API_KEY = 'env-okx-key';
      process.env.OKX_SECRET_KEY = 'env-okx-secret';
      process.env.OKX_PASSPHRASE = 'env-okx-pass';
      fsMocks.readFileSync.mockReturnValue(buildMinimalYaml({ cloudEnabled: true }));

      const manager = new ConfigManager({ configPath: '/tmp/config.yaml' });
      const proxy = manager.getProxyConfig();

      expect(manager.getCloudConfig().apiKey).toBe('env-aw-key');
      expect(proxy.server.env?.OKX_API_KEY).toBe('env-okx-key');
      expect(proxy.server.env?.OKX_SECRET_KEY).toBe('env-okx-secret');
      expect(proxy.server.env?.OKX_PASSPHRASE).toBe('env-okx-pass');
    });
  });

  describe('validation', () => {
    it('throws structured error for invalid numeric fields', () => {
      fsMocks.readFileSync.mockReturnValue(
        buildMinimalYaml({ maxMatchTimeMs: 'not-a-number' }),
      );

      expect(() => new ConfigManager({ configPath: '/tmp/bad.yaml' })).toThrowError(
        /Invalid config field detection\.ruleEngine\.maxMatchTimeMs/,
      );

      try {
        new ConfigManager({ configPath: '/tmp/bad.yaml' });
        expect.unreachable('expected maxMatchTimeMs validation to fail');
      } catch (error) {
        assertStructuredConfigError(error, {
          riskType: 'CONFIG_VALIDATION_FAILED',
          eventId: null,
        });
      }
    });

    it('disables cloud upload when enabled but cloud.endpoint is missing', () => {
      fsMocks.readFileSync.mockReturnValue(
        [
          'server:',
          '  command: node',
          'cloud:',
          '  enabled: true',
          'logging:',
          '  level: info',
          '  format: json',
          '  output: /tmp/log.jsonl',
        ].join('\n'),
      );

      const manager = new ConfigManager({ configPath: '/tmp/cloud.yaml' });
      const cloud = manager.getCloudConfig();

      expect(cloud.enabled).toBe(false);
    });

    it('getCloudConfig disables upload when cloud node is absent and apiKey missing', () => {
      fsMocks.readFileSync.mockReturnValue(buildMinimalYaml());
      const previousApiKey = process.env['AGENTWATCH_API_KEY'];
      delete process.env['AGENTWATCH_API_KEY'];

      try {
        const manager = new ConfigManager({ configPath: '/tmp/no-cloud.yaml' });
        expect(manager.getCloudConfig().enabled).toBe(false);
      } finally {
        if (previousApiKey === undefined) {
          delete process.env['AGENTWATCH_API_KEY'];
        } else {
          process.env['AGENTWATCH_API_KEY'] = previousApiKey;
        }
      }
    });

    it('throws structured error when rulesPath is empty', () => {
      fsMocks.readFileSync.mockReturnValue(buildMinimalYaml({ rulesPath: '' }));

      try {
        new ConfigManager({ configPath: '/tmp/rules.yaml' });
        expect.unreachable('expected rulesPath validation to fail');
      } catch (error) {
        assertStructuredConfigError(error, {
          riskType: 'CONFIG_VALIDATION_FAILED',
          eventId: null,
        });
      }
    });
  });

  describe('getDetectionThresholds', () => {
    it('extracts maxMatchTimeMs and windowSizeMs thresholds for detection engines', () => {
      fsMocks.readFileSync.mockReturnValue(
        buildMinimalYaml({ maxMatchTimeMs: 8, windowSizeMs: 120_000 }),
      );

      const manager = new ConfigManager({ configPath: '/tmp/thresholds.yaml' });
      const thresholds = manager.getDetectionThresholds();

      expect(thresholds.maxDetectionLatencyMs).toBe(50);
      expect(thresholds.ruleEngine.maxMatchTimeMs).toBe(8);
      expect(thresholds.statisticalEngine.windowSizeMs).toBe(120_000);
      expect(thresholds.decisionRouter.blockThreshold).toBe(0.8);
      expect(thresholds.decisionRouter.ruleWeight).toBe(0.6);
      expect(thresholds.ruleEngine.rulesPath).toContain('builtin.json');
    });
  });

  describe('IConfigManager', () => {
    it('supports dot-path get/set and reload from disk', () => {
      const manager = new ConfigManager({ configPath: '/tmp/config.yaml' });

      expect(manager.get<boolean>('detection.ruleEngine.enabled')).toBe(true);

      manager.set('detection.ruleEngine.enabled', false);
      expect(manager.get<boolean>('detection.ruleEngine.enabled')).toBe(false);
      expect(manager.getDetectionThresholds().ruleEngine.enabled).toBe(false);

      fsMocks.readFileSync.mockReturnValue(
        buildMinimalYaml({ maxMatchTimeMs: 12 }),
      );
      manager.reload();
      expect(manager.get<boolean>('detection.ruleEngine.enabled')).toBe(true);
      expect(manager.getDetectionThresholds().ruleEngine.maxMatchTimeMs).toBe(12);
    });

    it('returns ProxyConfig injectable by MCPProxyCore constructor shape', () => {
      const manager = new ConfigManager({ configPath: '/tmp/config.yaml' });
      const proxy = manager.getProxyConfig();

      expect(proxy.server.command).toBe('node');
      expect(proxy.agentWatch.detection.ruleEngine.maxMatchTimeMs).toBe(10);
      expect(proxy.performance.maxDetectionLatencyMs).toBe(50);
      expect(proxy.connection?.autoRestart).toBe(true);
    });
  });
});

describe('bootstrap assembly integration', () => {
  const originalEnv = { ...process.env };
  let logRoot: string;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    logRoot = mkdtempSync(join(tmpdir(), 'agentwatch-bootstrap-'));
    fsMocks.existsSync.mockReturnValue(true);
    fsMocks.readFileSync.mockReturnValue(buildMinimalYaml({ logOutput: logRoot }));
    spawnMock.mockReturnValue(createMockChildProcess());
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    spawnMock.mockReset();
    vi.restoreAllMocks();
  });

  it('loads yaml + env, instantiates all components, and starts MCPProxyCore', async () => {
    process.env.AGENTWATCH_API_KEY = 'env-aw-key';
    process.env.OKX_API_KEY = 'env-okx-key';
    process.env.OKX_SECRET_KEY = 'env-okx-secret';
    process.env.OKX_PASSPHRASE = 'env-okx-pass';
    fsMocks.readFileSync.mockReturnValue(
      buildMinimalYaml({ logOutput: logRoot, cloudEnabled: true }),
    );

    const runtime = await assembleGatewayFromConfigManager('/tmp/bootstrap.yaml');

    expect(runtime.session.sessionId).toBeTruthy();
    expect(runtime.configManager.getCloudConfig().apiKey).toBe('env-aw-key');
    expect(runtime.configManager.getProxyConfig().server.env?.OKX_API_KEY).toBe(
      'env-okx-key',
    );
    expect(runtime.configManager.getDetectionThresholds().ruleEngine.maxMatchTimeMs).toBe(
      10,
    );
    expect(spawnMock).toHaveBeenCalledOnce();

    await runtime.session.stop();
    await runtime.asyncLogger.shutdown();
  });

  it('injected MCPProxyCore runs tools/call through DecisionRouter.detect with combination boost', async () => {
    const runtime = await assembleGatewayFromConfigManager('/tmp/bootstrap-detect.yaml');
    const detectSpy = vi.spyOn(runtime.decisionRouter, 'detect');

    const request: JSONRPCRequest = {
      jsonrpc: '2.0',
      id: 'bootstrap-transfer-combo',
      method: 'tools/call',
      params: {
        name: 'transfer',
        arguments: [
          { name: 'amount', value: 500_000 },
          { name: 'chain_depth', value: 5 },
        ],
      },
    };

    const result = await runtime.session.handleToolCall(request);

    expect(result.decision).toBe('BLOCK');
    expect(detectSpy).toHaveBeenCalledOnce();

    const fusion = detectSpy.mock.results[0]?.value;
    expect(fusion.triggeredCombinations).toContain('high_value_transfer');
    expect(fusion.scenarioBreakdown.parameter_tampering?.score).toBeGreaterThanOrEqual(
      0.6,
    );
    expect(fusion.scenarioBreakdown.tool_chain_abuse?.score).toBeGreaterThanOrEqual(0.4);

    await runtime.asyncLogger.logBlocked(request, result);
    await runtime.asyncLogger.flush();

    const dateKey = utcDateKey();
    const blockLog = readFileSync(tierLogPath(logRoot, dateKey, 'block'), 'utf8');
    expect(blockLog).toContain('bootstrap-transfer-combo');
    expect(blockLog).toContain('PARAM_TAMPER_001');

    await runtime.session.stop();
    await runtime.asyncLogger.shutdown();
  });

  it('loadRuleEngineRules 从外部 JSON rulesPath 加载规则', () => {
    const rulesFile = join(tmpdir(), `bootstrap-rules-${String(Date.now())}.json`);
    writeFileSync(
      rulesFile,
      JSON.stringify({
        id: 'external-set',
        name: 'External',
        description: 'external rules',
        rules: [
          {
            id: 'EXT_TOOL_BLOCK',
            name: 'External Block',
            description: 'block external tool',
            category: 'test',
            severity: 'HIGH',
            action: 'BLOCK',
            enabled: true,
            immutable: false,
            conditions: [
              {
                id: 'c1',
                field: 'tool.name',
                matchType: 'EXACT',
                pattern: 'external_only_tool',
              },
            ],
            conditionLogic: 'AND',
            version: '1.0.0',
            author: 'test',
            tags: ['test'],
            createdAt: 1_700_000_000_000,
            updatedAt: 1_700_000_000_000,
            hitCount: 0,
            falsePositiveCount: 0,
          },
        ],
        priority: 1,
        defaultAction: 'ALLOW',
      }),
      'utf8',
    );

    const ruleEngine = new RuleEngine({ maxMatchTimeMs: 10 });
    const count = loadRuleEngineRules(ruleEngine, rulesFile);
    expect(count).toBe(1);
    expect(ruleEngine.getStats().enabledRules).toBe(1);

    const results = ruleEngine.match({
      tool: { name: 'external_only_tool' },
      argument: { name: 'x', value: 1 },
      request: { timestamp: Date.now() },
    });
    expect(results.some((match) => match.ruleId === 'EXT_TOOL_BLOCK')).toBe(true);
  });

  it('loadRuleEngineRules 从外部 YAML rulesPath 加载规则', () => {
    const rulesFile = join(tmpdir(), `bootstrap-rules-${String(Date.now())}.yaml`);
    writeFileSync(
      rulesFile,
      [
        'id: external-yaml-set',
        'name: External YAML',
        'description: external yaml rules',
        'priority: 1',
        'defaultAction: ALLOW',
        'rules:',
        '  - id: EXT_YAML_BLOCK',
        '    name: External YAML Block',
        '    description: block yaml tool',
        '    category: test',
        '    severity: HIGH',
        '    action: BLOCK',
        '    enabled: true',
        '    immutable: false',
        '    conditionLogic: AND',
        '    version: "1.0.0"',
        '    author: test',
        '    tags: [test]',
        '    createdAt: 1700000000000',
        '    updatedAt: 1700000000000',
        '    hitCount: 0',
        '    falsePositiveCount: 0',
        '    conditions:',
        '      - id: c1',
        '        field: tool.name',
        '        matchType: EXACT',
        '        pattern: yaml_only_tool',
      ].join('\n'),
      'utf8',
    );

    const ruleEngine = new RuleEngine({ maxMatchTimeMs: 10 });
    const loaded = ruleEngine.loadRuleSetFromFile(rulesFile);
    expect(loaded.rules).toHaveLength(1);
    const count = loadRuleEngineRules(ruleEngine, rulesFile);
    expect(count).toBe(1);

    const results = ruleEngine.match({
      tool: { name: 'yaml_only_tool' },
      argument: { name: 'x', value: 1 },
      request: { timestamp: Date.now() },
    });
    expect(results.some((match) => match.ruleId === 'EXT_YAML_BLOCK')).toBe(true);
  });
});
