/**
 * AgentWatch V0 性能基准 — Vitest bench API
 * 运行：npm run bench --prefix packages/local
 * 报告：tests/bench/results.md（压测结束后自动写入）
 */
import { EventEmitter, PassThrough } from 'node:stream';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, bench, describe, vi } from 'vitest';

import { BaselineService } from '../../src/baseline/BaselineService.js';
import { DecisionRouter } from '../../src/detection/DecisionRouter.js';
import { MCPProxyCore } from '../../src/proxy/MCPProxyCore.js';
import { DataMasker } from '../../src/privacy/DataMasker.js';
import { HMACChainManager } from '../../src/privacy/HMACChainManager.js';
import { HmacChainSigner } from '../../src/privacy/HmacChainSigner.js';
import { RuleEngine } from '../../src/rule/RuleEngine.js';
import { StatEngine } from '../../src/stat/StatEngine.js';
import { DatabaseManager } from '../../src/storage/DatabaseManager.js';
import { BenchMetricsCollector } from './bench-metrics.js';

import type { DetectionEvent, ILogger, ProxyConfig, Rule } from '@packages/shared/types';

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: (...args: Parameters<typeof actual.spawn>) => spawnMock(...args),
  };
});

const metrics = new BenchMetricsCollector();

metrics.registerTarget({
  id: 'l0_rule_match',
  name: 'L0 规则匹配（1000 规则 × 10000 事件）',
  targetMs: 10,
  metric: 'p99',
  lane: 'core',
  description: 'RuleEngine.match() — 1000 条合成规则，循环匹配事件',
});
metrics.registerTarget({
  id: 'l1_stat_detect',
  name: 'L1 统计检测（Z-score + Markov + 频次）',
  targetMs: 50,
  metric: 'p99',
  lane: 'core',
  description: 'StatEngine.processEvent() — Z-score 方差、Markov 链、行为频次',
});
metrics.registerTarget({
  id: 'proxy_passthrough_sync',
  name: 'Proxy 转发 — 核心同步路径',
  targetMs: 0.1,
  metric: 'mean',
  lane: 'core',
  description: 'JSON 序列化 + clientIn.write — 不含 stdio 管道往返',
});
metrics.registerTarget({
  id: 'proxy_passthrough_io',
  name: 'Proxy 转发 — stdio 管道 I/O',
  targetMs: 10,
  metric: 'mean',
  lane: 'io',
  description: '下游 stdin 收到数据的管道往返延迟',
});
metrics.registerTarget({
  id: 'baseline_update_memory',
  name: 'Baseline update — 纯内存路径',
  targetMs: 0.1,
  metric: 'mean',
  lane: 'core',
  description: 'recordObservation — Welford/频次/时段内存更新',
});
metrics.registerTarget({
  id: 'baseline_sqlite_io',
  name: 'Baseline persist — SQLite I/O',
  targetMs: 10,
  metric: 'mean',
  lane: 'io',
  description: 'BaselineStorage.save() — better-sqlite3 同步落盘',
});
metrics.registerTarget({
  id: 'full_e2e_chain',
  name: '完整端到端链路（L0+L1+决策+脱敏+HMAC）',
  targetMs: 50,
  metric: 'p99',
  lane: 'core',
  description: 'processEvent + match + detect + DataMasker + HmacChainSigner',
});

function safeRun(id: string, fn: () => void): void {
  try {
    metrics.measure(id, fn);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error(`[bench:${id}] ${message}`);
  }
}

function createNoopLogger(): ILogger {
  return {
    logAllowed: async () => undefined,
    logWarn: async () => undefined,
    logBlocked: async () => undefined,
    logAlert: async () => undefined,
    flush: async () => undefined,
    shutdown: async () => undefined,
    flushSyncOnFatal: () => undefined,
  };
}

function buildSyntheticRules(count: number): Rule[] {
  const rules: Rule[] = [];
  const now = Date.now();
  for (let index = 0; index < count; index += 1) {
    rules.push({
      id: `BENCH_RULE_${String(index).padStart(4, '0')}`,
      name: `bench-rule-${String(index)}`,
      description: 'latency benchmark synthetic rule',
      category: 'benchmark',
      severity: 'LOW',
      action: 'LOG',
      enabled: true,
      immutable: false,
      conditions: [
        {
          id: `bench-c-${String(index)}`,
          field: 'tool.name',
          matchType: 'CONTAINS',
          pattern: `tool_${String(index % 50)}`,
        },
      ],
      conditionLogic: 'AND',
      version: '1.0',
      author: 'bench',
      tags: ['bench'],
      createdAt: now,
      updatedAt: now,
      hitCount: 0,
      falsePositiveCount: 0,
    });
  }
  return rules;
}

function buildBenchEvent(index: number): DetectionEvent {
  return {
    tool: { name: `tool_${String(index % 50)}` },
    argument: { name: 'amount', value: 100 + index },
    request: {
      timestamp: Date.now(),
      session_id: 'bench-session',
      user_id: 'bench-user',
    },
    context: { chain_depth: (index % 5) + 1 },
    metadata: { frequency_1m: index % 20, frequency_5m: index % 40 },
  };
}

function buildProxyConfig(logRoot: string): ProxyConfig {
  return {
    server: { command: 'node', args: ['-e', 'process.stdin.pipe(process.stdout)'] },
    performance: { maxDetectionLatencyMs: 50 },
    connection: { autoRestart: true, maxRestarts: 2, timeoutMs: 5_000 },
    agentWatch: {
      performance: { maxDetectionLatencyMs: 50 },
      detection: {
        ruleEngine: { enabled: true, rulesPath: '/tmp/bench-rules.jsonl', maxMatchTimeMs: 50 },
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
        mask: { enabled: true, level: 2, sensitiveFields: ['apiKey'] },
        rotation: { maxSizeMB: 100, maxFiles: 7 },
      },
      proxy: { injectSecurityMarkers: true },
    },
  };
}

describe('AgentWatch latency benchmarks', () => {
  let previousHome: string | undefined;
  let ruleEngine: RuleEngine | undefined;
  let statEngine: StatEngine | undefined;
  let decisionRouter: DecisionRouter | undefined;
  let baselineService: BaselineService | undefined;
  let masker: DataMasker | undefined;
  let signer: HmacChainSigner | undefined;
  let l0EventIndex = 0;
  let l1EventIndex = 0;
  let e2eEventIndex = 0;
  let baselineIndex = 0;
  let benchInitialized = false;

  let passthroughClientIn: PassThrough;
  let passthroughServerStdin: PassThrough;
  let passthroughCore: MCPProxyCore;
  let passthroughReady: Promise<void> | null = null;
  let passthroughRequestId = 0;

  function initBenchOnce(): void {
    if (benchInitialized) {
      return;
    }
    benchInitialized = true;

    previousHome = process.env['HOME'];
    process.env['HOME'] = mkdtempSync(join(tmpdir(), 'agentwatch-bench-'));
    HMACChainManager.initialize();
    signer = HmacChainSigner.loadFromDatabase(DatabaseManager.getInstance().getDb());

    ruleEngine = new RuleEngine({ maxMatchTimeMs: 50 });
    ruleEngine.loadRuleSet({
      id: 'bench-1000',
      name: 'bench-1000',
      description: '1000 synthetic rules',
      rules: buildSyntheticRules(1000),
      priority: 0,
      defaultAction: 'ALLOW',
    });

    const config = buildProxyConfig(join(process.env['HOME']!, 'logs'));
    statEngine = new StatEngine(config);
    statEngine.loadBuiltinBaseline();

    baselineService = new BaselineService({ userId: 'bench-user', agentId: 'bench-agent' });
    statEngine.setBaselineService(baselineService);

    decisionRouter = new DecisionRouter({
      blockThreshold: 0.8,
      warnThreshold: 0.5,
      ruleWeight: 0.6,
      statWeight: 0.4,
      decisionBudgetMs: 50,
    });

    masker = DataMasker.fromGlobalConfig(config.agentWatch.logging);

    for (let index = 0; index < 40; index += 1) {
      try {
        statEngine.processEvent(buildBenchEvent(index));
      } catch {
        // 冷启动预热可能超出严格预算，不中断基准流程
      }
    }

    passthroughClientIn = new PassThrough();
    const passthroughClientOut = new PassThrough();
    passthroughServerStdin = new PassThrough();
    const passthroughServerStdout = new PassThrough();
    const passthroughServerStderr = new PassThrough();

    const child = Object.assign(new EventEmitter(), {
      stdin: passthroughServerStdin,
      stdout: passthroughServerStdout,
      stderr: passthroughServerStderr,
      killed: false,
      kill: vi.fn(() => {
        child.killed = true;
        child.emit('exit', 0, null);
      }),
    });
    spawnMock.mockReturnValue(child);

    passthroughCore = new MCPProxyCore(
      buildProxyConfig(join(process.env['HOME']!, 'logs-proxy')),
      ruleEngine,
      statEngine,
      createNoopLogger(),
      decisionRouter,
      passthroughClientIn,
      passthroughClientOut,
    );
    passthroughReady = passthroughCore.start().then(() => undefined);
  }

  beforeAll(() => {
    initBenchOnce();
  });

  afterAll(async () => {
    try {
      if (passthroughReady !== null) {
        await passthroughCore.stop();
      }
    } catch {
      // teardown
    }

    const reportPath = metrics.writeResultsMarkdown();
    console.info(`[bench] results written to ${reportPath}`);

    try {
      HMACChainManager.reset();
      DatabaseManager.getInstance().close();
    } catch {
      // teardown
    }
    if (previousHome === undefined) {
      delete process.env['HOME'];
    } else {
      process.env['HOME'] = previousHome;
    }
  });

  bench(
    'L0 rule match — 1000 rules',
    () => {
      initBenchOnce();
      const event = buildBenchEvent(l0EventIndex);
      l0EventIndex = (l0EventIndex + 1) % 10_000;
      safeRun('l0_rule_match', () => {
        ruleEngine!.match(event);
      });
    },
    { iterations: 10_000, time: 0 },
  );

  bench(
    'L1 statistical detect',
    () => {
      initBenchOnce();
      const event = buildBenchEvent(l1EventIndex);
      l1EventIndex = (l1EventIndex + 1) % 2_000;
      safeRun('l1_stat_detect', () => {
        statEngine!.processEvent(event);
      });
    },
    { iterations: 2_000, time: 0 },
  );

  bench(
    'Proxy passthrough tools/list',
    async () => {
      initBenchOnce();
      if (passthroughReady !== null) {
        await passthroughReady;
      }
      passthroughRequestId += 1;
      const line = `${JSON.stringify({
        jsonrpc: '2.0',
        id: passthroughRequestId,
        method: 'tools/list',
        params: {},
      })}\n`;

      const ioPromise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('proxy passthrough timeout')), 50);
        passthroughServerStdin.once('data', () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      try {
        const syncStart = performance.now();
        passthroughClientIn.write(line);
        metrics.record('proxy_passthrough_sync', performance.now() - syncStart);

        const ioStart = performance.now();
        await ioPromise;
        metrics.record('proxy_passthrough_io', performance.now() - ioStart);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        console.error(`[bench:proxy_passthrough] ${message}`);
      }
    },
    { iterations: 500, time: 0 },
  );

  bench(
    'BaselineService update + persist',
    () => {
      initBenchOnce();
      const index = baselineIndex;
      baselineIndex += 1;
      try {
        metrics.measure('baseline_update_memory', () => {
          baselineService!.recordObservation({
            event: buildBenchEvent(index),
            dimensions: {
              chain_depth: 2,
              arg_count: 3,
              tool_frequency: 1,
              latency: 10,
              error_rate: 0,
              user_repeat: 1,
            },
            isAnomaly: false,
            baseZScoreThreshold: 3,
          });
        });
        metrics.measure('baseline_sqlite_io', () => {
          baselineService!.persist();
        });
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        console.error(`[bench:baseline_update] ${message}`);
      }
    },
    { iterations: 500, time: 0 },
  );

  bench(
    'Full E2E detection chain',
    () => {
      initBenchOnce();
      const event = buildBenchEvent(e2eEventIndex);
      e2eEventIndex = (e2eEventIndex + 1) % 1_000;
      safeRun('full_e2e_chain', () => {
        const l1Result = statEngine!.processEvent(event);
        const ruleMatches = ruleEngine!.match(event);
        decisionRouter!.detect(ruleMatches, l1Result, `evt-bench-${String(e2eEventIndex)}`);

        const masked = masker!.maskParams(
          { amount: 1000, apiKey: 'secret-bench-key' },
          'BLOCK',
          event.tool.name,
        );

        signer!.signEntry({
          ts: Date.now(),
          sid: 'bench-session',
          eventId: `evt-bench-${String(e2eEventIndex)}`,
          tool: event.tool.name,
          dec: 'BLOCK',
          score: 0.9,
          dur_ms: 12,
          sequence_no: e2eEventIndex,
          params: masked,
        });
      });

      if (e2eEventIndex === 0) {
        try {
          const reportPath = metrics.writeResultsMarkdown();
          console.info(`[bench] results written to ${reportPath}`);
        } catch (cause) {
          console.error('[bench] failed to write results.md', cause);
        }
      }
    },
    { iterations: 1_000, time: 0 },
  );
});
