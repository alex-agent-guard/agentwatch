/**
 * E2E 全链路集成测试 — 场景 A~D + 性能基准
 * 模拟环境：Vitest + 隔离 HOME（mkdtemp）+ mock fetch CloudClient
 * 验证命令见 docs/e2e_full_pipeline.md
 */
import { EventEmitter, PassThrough } from 'node:stream';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BaselineService } from '../../src/baseline/BaselineService.js';
import { ColdStartController } from '../../src/baseline/ColdStartController.js';
import { CloudClient, normalizeCloudEndpoint, type CloudEventPayload } from '../../src/cloud/CloudClient.js';
import { EventUploader } from '../../src/cloud/EventUploader.js';
import { RetryQueue } from '../../src/cloud/RetryQueue.js';
import { BaselineDeviationDetector } from '../../src/detection/scenarios/BaselineDeviationDetector.js';
import { DecisionRouter } from '../../src/detection/DecisionRouter.js';
import { AsyncLogger } from '../../src/logging/AsyncLogger.js';
import { MCPProxyCore } from '../../src/proxy/MCPProxyCore.js';
import { HMACChain } from '../../src/privacy/HMACChain.js';
import { HMACChainManager } from '../../src/privacy/HMACChainManager.js';
import { V0_BUILTIN_RULES } from '../../src/rule/builtin.js';
import { RuleEngine } from '../../src/rule/RuleEngine.js';
import { StatEngine } from '../../src/stat/StatEngine.js';
import { DatabaseManager } from '../../src/storage/DatabaseManager.js';

import type {
  BehaviorLogEntry,
  CloudConfig,
  DetectionResult,
  JSONRPCRequest,
  ProxyConfig,
} from '@packages/shared/types';

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: (...args: Parameters<typeof actual.spawn>) => spawnMock(...args),
  };
});

function createMockChild() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();

  const child = Object.assign(new EventEmitter(), {
    stdin,
    stdout,
    stderr,
    killed: false,
    kill: vi.fn(() => {
      child.killed = true;
      child.emit('exit', 0, null);
    }),
  });

  return child;
}

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

function readJsonl(path: string): BehaviorLogEntry[] {
  try {
    const raw = readFileSync(path, 'utf8').trim();
    if (raw.length === 0) {
      return [];
    }
    return raw.split('\n').map((line) => JSON.parse(line) as BehaviorLogEntry);
  } catch {
    return [];
  }
}

function countUploadQueueRows(): number {
  try {
    const db = DatabaseManager.getInstance().getDb();
    const row = db.prepare('SELECT COUNT(*) AS count FROM upload_queue').get() as {
      count: number;
    };
    return row.count;
  } catch {
    return 0;
  }
}

function buildBlockRequest(overrides?: Partial<JSONRPCRequest>): JSONRPCRequest {
  return {
    jsonrpc: '2.0',
    id: overrides?.id ?? 'evt-e2e-block',
    method: 'tools/call',
    params: overrides?.params ?? {
      name: 'transfer',
      arguments: { amount: 500_000, apiKey: 'secret-key-value' },
      _meta: { sessionId: 'sess-e2e', seq: 1, chain_depth: 5 },
    },
  };
}

function buildBlockResult(overrides?: Partial<DetectionResult>): DetectionResult {
  return {
    decision: 'BLOCK',
    score: overrides?.score ?? 0.95,
    triggeredRules: overrides?.triggeredRules ?? [
      { ruleId: 'PARAM_TAMPER_001', ruleName: 'PARAM_TAMPER_001', severity: 'HIGH', confidence: 0.95 },
    ],
    statAnomalies: overrides?.statAnomalies ?? [],
  };
}

interface E2ECloudStack {
  cloudConfig: CloudConfig;
  queue: RetryQueue;
  uploader: EventUploader;
  fetchImpl: ReturnType<typeof vi.fn>;
  posted: CloudEventPayload[][];
}

function createCloudStack(options?: {
  offlineFirst?: boolean;
}): E2ECloudStack {
  const posted: CloudEventPayload[][] = [];

  const fetchImpl = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
    if (options?.offlineFirst === true && fetchImpl.mock.calls.length === 1) {
      return {
        ok: false,
        status: 503,
        text: async () => 'offline',
      };
    }

    const body = JSON.parse(String(init?.body)) as { events: CloudEventPayload[] };
    posted.push(body.events);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        batchId: `batch-${String(posted.length)}`,
        accepted: body.events.length,
        rejected: 0,
        errors: [],
      }),
    };
  });

  if (options?.offlineFirst === true) {
    fetchImpl.mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => 'offline',
    });
  }

  const cloudConfig: CloudConfig = {
    enabled: true,
    endpoint: 'https://api.agentwatch.test/v1',
    apiKey: 'e2e-key',
    batch: { batchSize: 100, flushIntervalMs: 5000, maxRetries: 5 },
  };

  const queue = new RetryQueue({ maxRetries: 5 });
  const uploader = new EventUploader({
    cloudConfig,
    logger: { logAlert: async () => undefined },
    queue,
    client: new CloudClient(
      {
        endpoint: normalizeCloudEndpoint(cloudConfig.endpoint),
        apiKey: cloudConfig.apiKey!,
      },
      { fetchImpl, timeoutMs: 5000 },
    ),
  });

  return { cloudConfig, queue, uploader, fetchImpl, posted };
}

interface E2EProxyStack {
  config: ProxyConfig;
  ruleEngine: RuleEngine;
  statEngine: StatEngine;
  baselineService: BaselineService;
  decisionRouter: DecisionRouter;
  asyncLogger: AsyncLogger;
  baselineDetector: BaselineDeviationDetector;
  core: MCPProxyCore;
  clientIn: PassThrough;
  clientOut: PassThrough;
}

function createE2EProxyStack(
  agentWatchHome: string,
  cloud: E2ECloudStack,
): E2EProxyStack {
  const logRoot = join(agentWatchHome, 'logs');
  mkdirSync(logRoot, { recursive: true });

  const config: ProxyConfig = {
    server: { command: 'node', args: ['-e', 'process.stdin.pipe(process.stdout)'] },
    performance: { maxDetectionLatencyMs: 50 },
    connection: { autoRestart: true, maxRestarts: 2, timeoutMs: 5_000 },
    agentWatch: {
      performance: { maxDetectionLatencyMs: 50 },
      detection: {
        baselineDeviation: true,
        ruleEngine: { enabled: true, rulesPath: '/tmp/rules.jsonl', maxMatchTimeMs: 10 },
        statisticalEngine: {
          enabled: true,
          zScoreThreshold: 3,
          coldStartMinSamples: 30,
          combinedScoreThreshold: 0.7,
          maxZScoreThreshold: 4,
          markovAnomalyThreshold: 0.7,
          markovUnknownRatioThreshold: 0.5,
          markovSmoothingAlpha: 0.1,
          windowSizeMs: 300_000,
        },
        decisionRouter: {
          blockThreshold: 0.8,
          warnThreshold: 0.5,
          ruleWeight: 0.6,
          statWeight: 0.4,
        },
      },
      logging: {
        level: 'info',
        format: 'json',
        output: logRoot,
        mask: { enabled: true, level: 2, sensitiveFields: ['apiKey', 'secret'] },
        rotation: { maxSizeMB: 100, maxFiles: 7 },
      },
      cloud: cloud.cloudConfig,
      proxy: { injectSecurityMarkers: true },
    },
  };

  const ruleEngine = new RuleEngine({ maxMatchTimeMs: 10 });
  ruleEngine.loadRuleSet({
    id: 'builtin',
    name: 'builtin',
    description: 'e2e',
    rules: V0_BUILTIN_RULES,
    priority: 0,
    defaultAction: 'ALLOW',
  });

  const baselineService = new BaselineService({
    userId: 'e2e-user',
    agentId: 'e2e-agent',
  });

  const statEngine = new StatEngine(config);
  statEngine.loadBuiltinBaseline();
  statEngine.setBaselineService(baselineService);

  const decisionRouter = new DecisionRouter({
    blockThreshold: 0.8,
    warnThreshold: 0.5,
    ruleWeight: 0.6,
    statWeight: 0.4,
    decisionBudgetMs: 50,
  });

  const asyncLogger = new AsyncLogger(config.agentWatch.logging, false, undefined, {
    config: cloud.cloudConfig,
    uploader: cloud.uploader,
  });

  const baselineDetector = new BaselineDeviationDetector({
    enabled: true,
    baselineService,
  });

  const clientIn = new PassThrough();
  const clientOut = new PassThrough();

  const core = new MCPProxyCore(
    config,
    ruleEngine,
    statEngine,
    asyncLogger,
    decisionRouter,
    clientIn,
    clientOut,
    null,
    baselineDetector,
  );

  return {
    config,
    ruleEngine,
    statEngine,
    baselineService,
    decisionRouter,
    asyncLogger,
    baselineDetector,
    core,
    clientIn,
    clientOut,
  };
}

function seedDaytimeBaseline(baselineService: BaselineService): void {
  for (let hour = 9; hour <= 17; hour += 1) {
    for (let index = 0; index < 10; index += 1) {
      const timestamp = Date.UTC(2026, 6, 3, hour, index, 0);
      baselineService.recordObservation({
        event: {
          tool: { name: 'transfer' },
          argument: { name: 'amount', value: 100 },
          request: { timestamp, session_id: 'sess-seed', user_id: 'e2e-user' },
        },
        dimensions: { transfer_amount: 100, arg_count: 1, tool_frequency: 1 },
        isAnomaly: false,
        baseZScoreThreshold: 3,
      });
    }
  }
}

describe('E2E Scenario A — full pipeline data loop', () => {
  let previousHome: string | undefined;
  let agentWatchHome = '';

  beforeEach(() => {
    previousHome = process.env['HOME'];
    agentWatchHome = mkdtempSync(join(tmpdir(), 'agentwatch-e2e-a-'));
    process.env['HOME'] = agentWatchHome;
    HMACChainManager.initialize();
    spawnMock.mockReturnValue(createMockChild());
  });

  afterEach(() => {
    try {
      HMACChainManager.reset();
      DatabaseManager.getInstance().close();
    } catch {
      // isolated teardown
    }
    if (previousHome === undefined) {
      delete process.env['HOME'];
    } else {
      process.env['HOME'] = previousHome;
    }
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('MCP tools/call → Proxy intercept → L0/L1/baseline → BLOCK → log+HMAC → upload_queue → cloud flush', async () => {
    const cloud = createCloudStack();
    cloud.uploader.start();

    const stack = createE2EProxyStack(agentWatchHome, cloud);
    seedDaytimeBaseline(stack.baselineService);

    const detectSpy = vi.spyOn(stack.decisionRouter, 'detect');
    const session = await stack.core.start();

    const request = buildBlockRequest({ id: 'evt-pipeline-a' });
    const clientResponse = new Promise<string>((resolve) => {
      stack.clientOut.once('data', (chunk: Buffer) => resolve(chunk.toString()));
    });

    stack.clientIn.write(`${JSON.stringify(request)}\n`);
    const rawResponse = await clientResponse;
    const parsed = JSON.parse(rawResponse) as { error?: { code: number } };

    expect(parsed.error?.code).toBe(-32_000);

    expect(detectSpy).toHaveBeenCalled();
    const extraScenarios = detectSpy.mock.calls[0]?.[3] as
      | Array<{ scenario: string }>
      | undefined;
    if (extraScenarios !== undefined && extraScenarios.length > 0) {
      expect(extraScenarios.some((entry) => entry.scenario === 'baseline_deviation')).toBe(true);
    }

    await stack.asyncLogger.flush();

    const dateKey = utcDateKey();
    const blockPath = tierLogPath(stack.config.agentWatch.logging.output, dateKey, 'block');

    await vi.waitFor(
      () => {
        const rows = readJsonl(blockPath);
        expect(rows.length).toBeGreaterThanOrEqual(1);
      },
      { timeout: 5000, interval: 50 },
    );

    const rows = readJsonl(blockPath);
    const row = rows.find((entry) => entry.eventId === 'evt-pipeline-a') ?? rows[0]!;
    expect(row._meta?.hmac).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain('secret-key-value');

    cloud.queue.flushToDisk();
    expect(countUploadQueueRows()).toBeGreaterThanOrEqual(1);

    vi.useFakeTimers();
    await cloud.uploader.flush();
    expect(cloud.fetchImpl).toHaveBeenCalled();

    vi.advanceTimersByTime(5000);
    await cloud.uploader.flush();

    expect(cloud.posted.length).toBeGreaterThan(0);
    expect(cloud.posted[0]?.[0]?.detection.finalDecision).toBe('BLOCK');
    expect(cloud.queue.getPendingCount()).toBe(0);

    await session.stop();
    cloud.uploader.stop();
    await stack.asyncLogger.shutdown();
  });
});

describe('E2E Scenario B — offline retry recovery', () => {
  let previousHome: string | undefined;
  let agentWatchHome = '';

  beforeEach(() => {
    previousHome = process.env['HOME'];
    agentWatchHome = mkdtempSync(join(tmpdir(), 'agentwatch-e2e-b-'));
    process.env['HOME'] = agentWatchHome;
    HMACChainManager.initialize();
  });

  afterEach(() => {
    try {
      HMACChainManager.reset();
      DatabaseManager.getInstance().close();
    } catch {
      // isolated teardown
    }
    if (previousHome === undefined) {
      delete process.env['HOME'];
    } else {
      process.env['HOME'] = previousHome;
    }
    vi.useRealTimers();
  });

  it('persists events while cloud offline, clears queue after network recovery', async () => {
    const cloud = createCloudStack({ offlineFirst: true });
    const logger = new AsyncLogger(
      {
        level: 'info',
        format: 'json',
        output: join(agentWatchHome, 'logs'),
        mask: { enabled: true, level: 2, sensitiveFields: ['apiKey'] },
        rotation: { maxSizeMB: 100, maxFiles: 7 },
      },
      false,
      undefined,
      { config: cloud.cloudConfig, uploader: cloud.uploader },
    );

    await logger.logBlocked(buildBlockRequest({ id: 'evt-offline-1' }), buildBlockResult());
    await logger.flush();

    cloud.queue.flushToDisk();
    expect(countUploadQueueRows()).toBeGreaterThanOrEqual(1);

    vi.useFakeTimers();
    await cloud.uploader.flush();
    expect(cloud.fetchImpl).toHaveBeenCalledTimes(1);
    expect(cloud.queue.getPendingCount()).toBeGreaterThan(0);

    vi.advanceTimersByTime(10_000);
    await cloud.uploader.flush();
    expect(cloud.fetchImpl.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(cloud.queue.getPendingCount()).toBe(0);

    await logger.shutdown();
  });
});

describe('E2E Scenario C — cold start tier transitions + restart continuity', () => {
  let previousHome: string | undefined;

  beforeEach(() => {
    previousHome = process.env['HOME'];
    process.env['HOME'] = mkdtempSync(join(tmpdir(), 'agentwatch-e2e-c-'));
  });

  afterEach(() => {
    try {
      DatabaseManager.getInstance().close();
    } catch {
      // isolated teardown
    }
    if (previousHome === undefined) {
      delete process.env['HOME'];
    } else {
      process.env['HOME'] = previousHome;
    }
  });

  it('L1→L2→L3 tier thresholds and SQLite restart preserves totalCalls', () => {
    const controller = new ColdStartController();
    const service = new BaselineService({ userId: 'cold-user', agentId: 'cold-agent' });

    expect(controller.resolveTier(0)).toBe('L1');
    expect(controller.buildPolicy(5, 3).zScoreThreshold).toBeGreaterThanOrEqual(5);
    expect(controller.buildPolicy(5, 3).allowBaselineBlock).toBe(false);

    for (let index = 0; index < 10; index += 1) {
      service.recordObservation({
        event: {
          tool: { name: 'read_file' },
          argument: { name: 'path', value: `/file-${String(index)}` },
          request: { timestamp: Date.now(), session_id: 'sess-cold' },
        },
        dimensions: { arg_count: 1, tool_frequency: 1, chain_depth: 1 },
        isAnomaly: false,
        baseZScoreThreshold: 3,
      });
    }

    expect(service.getTotalCalls()).toBe(10);
    expect(controller.resolveTier(service.getTotalCalls())).toBe('L2');
    expect(controller.buildPolicy(10, 3).zScoreThreshold).toBeGreaterThanOrEqual(3.5);

    for (let index = 0; index < 90; index += 1) {
      service.recordObservation({
        event: {
          tool: { name: 'read_file' },
          argument: { name: 'path', value: `/more-${String(index)}` },
          request: { timestamp: Date.now(), session_id: 'sess-cold' },
        },
        dimensions: { arg_count: 1, tool_frequency: 1, chain_depth: 1 },
        isAnomaly: false,
        baseZScoreThreshold: 3,
      });
    }

    expect(service.getTotalCalls()).toBe(100);
    expect(controller.resolveTier(service.getTotalCalls())).toBe('L3');
    expect(controller.buildPolicy(100, 3).zScoreThreshold).toBe(3);
    expect(controller.buildPolicy(100, 3).allowBaselineBlock).toBe(true);

    service.persist();
    const reloaded = new BaselineService({ userId: 'cold-user', agentId: 'cold-agent' });
    expect(reloaded.hydrateFromStorage()).not.toBeNull();
    expect(reloaded.getTotalCalls()).toBe(100);
    expect(controller.resolveTier(reloaded.getTotalCalls())).toBe('L3');
  });
});

describe('E2E Scenario D — HMAC chain tamper detection', () => {
  let previousHome: string | undefined;

  beforeEach(() => {
    previousHome = process.env['HOME'];
    process.env['HOME'] = mkdtempSync(join(tmpdir(), 'agentwatch-e2e-d-'));
    HMACChainManager.initialize();
  });

  afterEach(() => {
    try {
      HMACChainManager.reset();
    } catch {
      // isolated teardown
    }
    if (previousHome === undefined) {
      delete process.env['HOME'];
    } else {
      process.env['HOME'] = previousHome;
    }
  });

  it('verifyChain passes for 100 entries and detects tamper at index 49', () => {
    const chain = new HMACChain();
    const entries: Array<{
      ts: number;
      sid: string;
      seq: number;
      tool: string;
      dec: string;
      hmac: string;
    }> = [];

    for (let seq = 1; seq <= 100; seq += 1) {
      const fields = {
        ts: Date.now() + seq,
        sid: 'sess-hmac-e2e',
        seq,
        tool: `tool_${String(seq)}`,
        dec: seq % 5 === 0 ? 'BLOCK' : 'ALLOW',
      };
      entries.push({ ...fields, hmac: chain.sign(fields) });
    }

    expect(chain.verifyChain(entries)).toEqual({ valid: true });

    const tampered = [...entries];
    tampered[49] = { ...entries[49]!, tool: 'tampered_tool' };
    expect(chain.verifyChain(tampered)).toEqual({ valid: false, tamperedIndex: 49 });
  });
});

describe('Performance benchmarks', () => {
  let previousHome: string | undefined;
  let agentWatchHome = '';

  beforeEach(() => {
    previousHome = process.env['HOME'];
    agentWatchHome = mkdtempSync(join(tmpdir(), 'agentwatch-e2e-perf-'));
    process.env['HOME'] = agentWatchHome;
    HMACChainManager.initialize();
    spawnMock.mockReturnValue(createMockChild());
  });

  afterEach(() => {
    try {
      HMACChainManager.reset();
      DatabaseManager.getInstance().close();
    } catch {
      // isolated teardown
    }
    if (previousHome === undefined) {
      delete process.env['HOME'];
    } else {
      process.env['HOME'] = previousHome;
    }
  });

  it(
    '1000 consecutive tool calls complete without SQLite lock errors',
    { timeout: 120_000 },
    async () => {
      const cloud = createCloudStack();
      const stack = createE2EProxyStack(agentWatchHome, cloud);
      const session = await stack.core.start();

      const heapBefore = process.memoryUsage().heapUsed;
      let lockErrors = 0;

      for (let index = 0; index < 1000; index += 1) {
        try {
          await session.handleToolCall({
            jsonrpc: '2.0',
            id: `evt-perf-${String(index)}`,
            method: 'tools/call',
            params: {
              name: 'read_file',
              arguments: { path: `/tmp/file-${String(index)}.txt` },
            },
          });
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : String(cause);
          if (message.toLowerCase().includes('database is locked')) {
            lockErrors += 1;
          }
        }
      }

      const heapAfter = process.memoryUsage().heapUsed;
      const heapGrowthMb = (heapAfter - heapBefore) / (1024 * 1024);

      expect(lockErrors).toBe(0);
      expect(heapGrowthMb).toBeLessThan(128);

      await session.stop();
    },
  );

  it(
    '100 BLOCK logs: mask + sign + persist + upload within 8s',
    { timeout: 30_000 },
    async () => {
      const cloud = createCloudStack();
      const logger = new AsyncLogger(
        {
          level: 'info',
          format: 'json',
          output: join(agentWatchHome, 'logs'),
          mask: { enabled: true, level: 2, sensitiveFields: ['apiKey'] },
          rotation: { maxSizeMB: 100, maxFiles: 7 },
        },
        false,
        undefined,
        { config: cloud.cloudConfig, uploader: cloud.uploader },
      );

      const startedAt = performance.now();

      for (let index = 0; index < 100; index += 1) {
        await logger.logBlocked(
          buildBlockRequest({
            id: `evt-batch-${String(index)}`,
            params: {
              name: 'transfer',
              arguments: { amount: 1000 + index, apiKey: `secret-${String(index)}` },
              _meta: { sessionId: 'sess-batch', seq: index + 1 },
            },
          }),
          buildBlockResult({ score: 0.9 }),
        );
      }

      await logger.flush();
      cloud.queue.flushToDisk();
      await cloud.uploader.flush();

      const elapsedMs = performance.now() - startedAt;

      expect(elapsedMs).toBeLessThan(8000);
      expect(cloud.queue.getPendingCount()).toBe(0);
      expect(cloud.posted.length).toBeGreaterThan(0);

      const blockPath = tierLogPath(join(agentWatchHome, 'logs'), utcDateKey(), 'block');
      const rows = readJsonl(blockPath);
      expect(rows.length).toBeGreaterThanOrEqual(100);
      for (const row of rows.slice(0, 5)) {
        expect(row._meta?.hmac).toMatch(/^[0-9a-f]{64}$/);
      }

      await logger.shutdown();
    },
  );
});
