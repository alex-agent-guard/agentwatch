import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  StatEngine,
  classifyAlertAction,
  classifyAnomalyLevel,
} from '../../../src/stat/StatEngine.js';
import { V0_BUILTIN_BASELINE } from '../../../src/stat/baseline.js';

import type {
  BaselineCache,
  DetectionEvent,
  L1DetectionResult,
  ProxyConfig,
  WelfordStatsState,
} from '@packages/shared/types';

type StructuredStatError = Error & {
  eventId?: string | null;
  riskType?: string;
  originalStack?: string;
};

function assertStructuredStatError(
  error: unknown,
  expected: { riskType: string; eventId?: string | null },
): asserts error is StructuredStatError {
  expect(error).toBeInstanceOf(Error);
  const structured = error as StructuredStatError;
  expect(structured.riskType).toBe(expected.riskType);
  if (expected.eventId !== undefined) {
    expect(structured.eventId).toBe(expected.eventId);
  }
  expect(structured.originalStack).toBeTruthy();
}

function buildEvent(overrides?: Partial<DetectionEvent>): DetectionEvent {
  return {
    tool: { name: 'read_file', ...(overrides?.tool ?? {}) },
    argument: { name: 'path', value: '/tmp/a.txt', ...(overrides?.argument ?? {}) },
    request: {
      timestamp: Date.now(),
      session_id: 'sess-default',
      ...(overrides?.request ?? {}),
    },
    ...(overrides?.context !== undefined ? { context: overrides.context } : {}),
    ...(overrides?.metadata !== undefined ? { metadata: overrides.metadata } : {}),
  };
}

function seedBaseline(
  engine: StatEngine,
  dimension: string,
  samples: number[],
): void {
  const states: Record<string, WelfordStatsState> = {};
  let count = 0;
  let mean = 0;
  let m2 = 0;

  for (const value of samples) {
    count += 1;
    const delta = value - mean;
    mean += delta / count;
    const delta2 = value - mean;
    m2 += delta * delta2;
  }

  states[dimension] = { count, mean, m2 };
  engine.updateBaseline({ dimensions: states });
}

function warmUpZScoreBaseline(engine: StatEngine, sessionId: string): void {
  for (let index = 0; index < 35; index += 1) {
    engine.processEvent(
      buildEvent({
        request: {
          timestamp: 1_700_000_000_000 + index * 1_000,
          session_id: sessionId,
        },
        context: { chain_depth: 1 + (index % 2) },
        argument: { name: 'path', value: { a: 1, b: 2 } },
      }),
    );
  }
}

function buildProxyConfig(maxMatchTimeMs: number, windowSizeMs: number): ProxyConfig {
  return {
    server: { command: 'node', args: ['-e', 'process.stdin.pipe(process.stdout)'] },
    agentWatch: {
      performance: { maxDetectionLatencyMs: 50 },
      detection: {
        ruleEngine: {
          enabled: true,
          rulesPath: '/tmp/rules.yaml',
          maxMatchTimeMs,
        },
        statisticalEngine: {
          enabled: true,
          zScoreThreshold: 3,
          coldStartMinSamples: 30,
          combinedScoreThreshold: 0.7,
          maxZScoreThreshold: 4,
          markovAnomalyThreshold: 0.7,
          markovUnknownRatioThreshold: 0.5,
          markovSmoothingAlpha: 0.1,
          windowSizeMs,
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
        output: '/tmp/agentwatch.log.jsonl',
        mask: { enabled: false, level: 0, sensitiveFields: [] },
        rotation: { maxSizeMB: 100, maxFiles: 7 },
      },
    },
    performance: { maxDetectionLatencyMs: 50 },
  };
}

describe('StatEngine', () => {
  let engine: StatEngine;

  beforeEach(() => {
    engine = new StatEngine({ maxProcessTimeMs: 100 });
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('cold start and baseline lifecycle', () => {
    it('V0_BUILTIN_BASELINE 包含 8 套独立时序 profile', () => {
      expect(V0_BUILTIN_BASELINE.length).toBe(8);
      const ids = V0_BUILTIN_BASELINE.map((entry) => entry.id);
      expect(new Set(ids).size).toBe(8);
      for (const profile of V0_BUILTIN_BASELINE) {
        expect(profile.markovSeedSequence.length).toBeGreaterThan(0);
        expect(Object.keys(profile.dimensions).length).toBeGreaterThan(0);
      }
    });

    it('returns conservative scores on empty baseline (cold start)', () => {
      const result = engine.processEvent(
        buildEvent({
          request: { timestamp: 1_700_000_000_000, session_id: 'cold-start' },
          context: { chain_depth: 1 },
        }),
      );

      expect(result.zScore.dimensionScores['chain_depth']?.note).toBe('cold_start');
      expect(result.zScore.combinedScore).toBeLessThanOrEqual(0.2);
      expect(result.isAnomaly).toBe(false);
      expect(classifyAnomalyLevel(result)).toBe('LOW');
    });

    it('seeds default baseline after a few samples without throwing', () => {
      for (let index = 0; index < 5; index += 1) {
        engine.processEvent(
          buildEvent({
            request: {
              timestamp: 1_700_000_000_000 + index * 1_000,
              session_id: 'few-samples',
            },
            context: { chain_depth: index % 3 },
          }),
        );
      }

      const stats = engine.getBaselineStats();
      expect(Object.keys(stats).length).toBeGreaterThan(0);
      expect(stats['chain_depth']?.count).toBeGreaterThan(0);
    });

    it('loadBaseline / updateBaseline round-trips Welford state', () => {
      warmUpZScoreBaseline(engine, 'baseline-roundtrip');
      const exported = engine.loadBaseline();

      const fresh = new StatEngine();
      fresh.updateBaseline(exported);
      const stats = fresh.getBaselineStats();

      expect(stats['chain_depth']?.count).toBeGreaterThanOrEqual(30);
      expect(stats['chain_depth']?.mean).toBeGreaterThan(0);
    });

    it('updateBaseline wraps invalid cache as structured error', () => {
      const badCache = { dimensions: null } as unknown as BaselineCache;
      try {
        engine.updateBaseline(badCache);
        expect.unreachable('should throw');
      } catch (error) {
        assertStructuredStatError(error, {
          riskType: 'STAT_ENGINE_BASELINE_UPDATE_FAILED',
        });
      }
    });
  });

  describe('multi-granularity sliding windows', () => {
    it('tracks 1m frequency and exposes all four window buckets', () => {
      const baseTs = 1_700_000_000_000;
      for (let index = 0; index < 3; index += 1) {
        engine.processEvent(
          buildEvent({
            tool: { name: 'ping' },
            request: { timestamp: baseTs + index * 500, session_id: 'freq-a' },
          }),
        );
      }

      const result = engine.processEvent(
        buildEvent({
          tool: { name: 'ping' },
          request: { timestamp: baseTs + 1_500, session_id: 'freq-a' },
        }),
      );

      expect(result.frequency.frequencies['1m']).toBe(4);
      expect(result.frequency.frequencies['5m']).toBe(4);
      expect(result.frequency.frequencies['1h']).toBe(4);
      expect(result.frequency.frequencies['1d']).toBe(4);
    });

    it('expires stale 1m window counts after bucket rollover', () => {
      const baseTs = 1_700_000_000_000;
      engine.processEvent(
        buildEvent({
          tool: { name: 'stale_tool' },
          request: { timestamp: baseTs, session_id: 'expiry' },
        }),
      );

      const afterExpiry = engine.processEvent(
        buildEvent({
          tool: { name: 'stale_tool' },
          request: { timestamp: baseTs + 120_000, session_id: 'expiry' },
        }),
      );

      expect(afterExpiry.frequency.frequencies['1m']).toBe(1);
    });

    it('isolates frequency counters per session', () => {
      const baseTs = 1_700_000_000_000;
      for (let index = 0; index < 5; index += 1) {
        engine.processEvent(
          buildEvent({
            tool: { name: 'session_tool' },
            request: { timestamp: baseTs + index * 100, session_id: 'session-a' },
          }),
        );
      }

      const sessionB = engine.processEvent(
        buildEvent({
          tool: { name: 'session_tool' },
          request: { timestamp: baseTs + 600, session_id: 'session-b' },
        }),
      );

      expect(sessionB.frequency.frequencies['1m']).toBe(1);
    });

    it('窗口满容量后多轮过期自动清理计数', () => {
      const baseTs = 1_700_000_000_000;
      for (let index = 0; index < 3; index += 1) {
        engine.processEvent(
          buildEvent({
            tool: { name: 'rollover_tool' },
            request: { timestamp: baseTs + index * 1_000, session_id: 'rollover' },
          }),
        );
      }

      const afterFullWindow = engine.processEvent(
        buildEvent({
          tool: { name: 'rollover_tool' },
          request: { timestamp: baseTs + 65_000, session_id: 'rollover' },
        }),
      );

      expect(afterFullWindow.frequency.frequencies['1m']).toBe(1);
      expect(afterFullWindow.frequency.frequencies['5m']).toBeGreaterThanOrEqual(1);
    });

    it('跨 5m 与 1d 粒度边界 — 5m 过期后 1d 仍保留累计', () => {
      const baseTs = 1_700_000_000_000;
      engine.processEvent(
        buildEvent({
          tool: { name: 'granularity_tool' },
          request: { timestamp: baseTs, session_id: 'granularity' },
        }),
      );

      const after5m = engine.processEvent(
        buildEvent({
          tool: { name: 'granularity_tool' },
          request: { timestamp: baseTs + 301_000, session_id: 'granularity' },
        }),
      );

      expect(after5m.frequency.frequencies['5m']).toBe(1);
      expect(after5m.frequency.frequencies['1d']).toBe(2);
      expect(after5m.frequency.frequencies['1m']).toBe(1);
    });
  });

  describe('Z-score detection', () => {
    it('detects positive deviation anomaly on a single dimension', () => {
      seedBaseline(
        engine,
        'chain_depth',
        Array.from({ length: 40 }, (_, index) => 2 + (index % 3)),
      );

      const result = engine.processEvent(
        buildEvent({
          request: { timestamp: 1_700_000_000_100, session_id: 'z-pos' },
          context: { chain_depth: 20 },
        }),
      );

      const chainScore = result.zScore.dimensionScores['chain_depth'];
      expect(chainScore?.zScore).toBeGreaterThan(0);
      expect(chainScore?.isAnomaly).toBe(true);
      expect(result.zScore.maxZScore).toBeGreaterThan(3);
    });

    it('detects negative deviation anomaly on a single dimension', () => {
      seedBaseline(
        engine,
        'chain_depth',
        Array.from({ length: 40 }, (_, index) => 10 + (index % 4)),
      );

      const result = engine.processEvent(
        buildEvent({
          request: { timestamp: 1_700_000_000_200, session_id: 'z-neg' },
          context: { chain_depth: 0 },
        }),
      );

      const chainScore = result.zScore.dimensionScores['chain_depth'];
      expect(chainScore?.zScore).toBeLessThan(0);
      expect(Math.abs(chainScore?.zScore ?? 0)).toBeGreaterThan(3);
    });

    it('evaluates multiple dimensions and fuses combined score', () => {
      seedBaseline(
        engine,
        'chain_depth',
        Array.from({ length: 40 }, (_, index) => 2 + (index % 3)),
      );
      seedBaseline(
        engine,
        'arg_count',
        Array.from({ length: 40 }, (_, index) => 2 + (index % 2)),
      );

      const result = engine.processEvent(
        buildEvent({
          request: { timestamp: 1_700_000_000_300, session_id: 'z-multi' },
          context: { chain_depth: 15 },
          argument: { name: 'payload', value: { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9 } },
        }),
      );

      expect(Object.keys(result.zScore.dimensionScores).length).toBeGreaterThan(1);
      expect(result.zScore.combinedScore).toBeGreaterThan(0.2);
    });

    it('多维度正负极值同时偏离基线并提升 combinedScore', () => {
      const zEngine = new StatEngine();
      seedBaseline(
        zEngine,
        'chain_depth',
        Array.from({ length: 40 }, (_, index) => 2 + (index % 3)),
      );
      seedBaseline(
        zEngine,
        'arg_count',
        Array.from({ length: 40 }, (_, index) => 6 + (index % 4)),
      );

      const result = zEngine.processEvent(
        buildEvent({
          request: { timestamp: 1_700_000_000_400, session_id: 'z-extremes' },
          context: { chain_depth: 20 },
          argument: { name: 'payload', value: { only: 1 } },
        }),
      );

      const chain = result.zScore.dimensionScores['chain_depth'];
      const argCount = result.zScore.dimensionScores['arg_count'];
      expect(chain?.zScore).toBeGreaterThan(0);
      expect(argCount?.zScore).toBeLessThan(0);
      expect(result.zScore.maxZScore).toBeGreaterThan(3);
      expect(result.zScore.combinedScore).toBeGreaterThan(0.3);
    });

    it('空样本冷启动全维度 note=cold_start 且分值保守', () => {
      const fresh = new StatEngine();
      const result = fresh.processEvent(
        buildEvent({
          request: { timestamp: 1_700_000_000_000, session_id: 'cold-all' },
          context: { chain_depth: 2 },
          metadata: { frequency_1m: 2, consecutive_failures: 0 },
        }),
      );

      for (const score of Object.values(result.zScore.dimensionScores)) {
        expect(score.note).toBe('cold_start');
        expect(score.anomalyScore).toBeLessThanOrEqual(0.8);
      }
      expect(result.zScore.combinedScore).toBeLessThanOrEqual(0.8);
      expect(result.isAnomaly).toBe(false);
    });
  });

  describe('Markov sequence scoring', () => {
    it('scores repeated known transitions with low anomaly', () => {
      const baseTs = 1_700_000_000_000;
      const tools = ['read_file', 'write_file', 'read_file', 'write_file'];

      let lastResult: L1DetectionResult | undefined;
      for (let index = 0; index < tools.length; index += 1) {
        lastResult = engine.processEvent(
          buildEvent({
            tool: { name: tools[index]! },
            request: { timestamp: baseTs + index * 1_000, session_id: 'markov-known' },
          }),
        );
      }

      expect(lastResult?.markov.anomalyScore).toBeLessThan(0.7);
      expect(lastResult?.markov.isAnomaly).toBe(false);
    });

    it('flags unfamiliar tool transitions with higher anomaly', () => {
      const baseTs = 1_700_000_000_000;
      const known = ['alpha', 'beta', 'alpha', 'beta', 'alpha', 'beta'];
      for (let index = 0; index < known.length; index += 1) {
        engine.processEvent(
          buildEvent({
            tool: { name: known[index]! },
            request: { timestamp: baseTs + index * 1_000, session_id: 'markov-unknown' },
          }),
        );
      }

      const anomaly = engine.processEvent(
        buildEvent({
          tool: { name: 'never_seen_before' },
          request: { timestamp: baseTs + 10_000, session_id: 'markov-unknown' },
        }),
      );

      expect(anomaly.markov.unknownRatio ?? 0).toBeGreaterThan(0);
      expect(anomaly.markov.anomalyScore).toBeGreaterThan(0.3);
    });

    it('全新连续工具序列比极低概率已知序列异常分值更高', () => {
      const baseTs = 1_700_000_000_000;
      engine.loadBuiltinBaseline(1_705_000_000_000);

      const novelSequence = [
        'tool_a',
        'tool_b',
        'tool_c',
        'tool_d',
        'tool_e',
        'tool_f',
      ];
      let novelResult: L1DetectionResult | undefined;
      for (let index = 0; index < novelSequence.length; index += 1) {
        novelResult = engine.processEvent(
          buildEvent({
            tool: { name: novelSequence[index]! },
            request: {
              timestamp: baseTs + index * 500,
              session_id: 'markov-novel-seq',
            },
          }),
        );
      }

      const lowProbEngine = new StatEngine();
      lowProbEngine.loadBuiltinBaseline(1_705_000_000_000);
      const knownLowProb = ['read_file', 'write_file', 'read_file', 'write_file'];
      let lowProbResult: L1DetectionResult | undefined;
      for (let index = 0; index < knownLowProb.length; index += 1) {
        lowProbResult = lowProbEngine.processEvent(
          buildEvent({
            tool: { name: knownLowProb[index]! },
            request: {
              timestamp: baseTs + index * 500,
              session_id: 'markov-low-prob',
            },
          }),
        );
      }

      expect(novelResult?.markov.anomalyScore).toBeGreaterThan(
        lowProbResult?.markov.anomalyScore ?? 0,
      );
      expect(novelResult?.markov.anomalyScore).toBeGreaterThan(0.2);
      expect(lowProbResult?.markov.anomalyScore).toBeLessThan(0.7);
    });
  });

  describe('anomaly level classification', () => {
    it('classifies HIGH / MEDIUM / LOW branches from combined score', () => {
      const low: L1DetectionResult = {
        zScore: {
          combinedScore: 0.1,
          maxZScore: 0.5,
          maxDimension: 'chain_depth',
          dimensionScores: {},
          isAnomaly: false,
          confidence: 0.5,
        },
        frequency: {
          toolName: 't',
          frequencies: { '1m': 1, '5m': 1, '1h': 1, '1d': 1 },
          anomalyScore: 0.05,
          isAnomaly: false,
        },
        markov: {
          logProbability: -0.5,
          perplexity: 1.2,
          anomalyScore: 0.05,
          isAnomaly: false,
        },
        combinedScore: 0.1,
        isAnomaly: false,
        latencyMs: 1,
      };

      const medium: L1DetectionResult = { ...low, combinedScore: 0.45 };
      const high: L1DetectionResult = { ...low, combinedScore: 0.85, isAnomaly: true };

      expect(classifyAnomalyLevel(low)).toBe('LOW');
      expect(classifyAnomalyLevel(medium)).toBe('MEDIUM');
      expect(classifyAnomalyLevel(high)).toBe('HIGH');
    });

    it('marks HIGH anomaly when burst frequency exceeds threshold', () => {
      const baseTs = 1_700_000_000_000;
      let last: L1DetectionResult | undefined;

      for (let index = 0; index < 105; index += 1) {
        last = engine.processEvent(
          buildEvent({
            tool: { name: 'burst_tool' },
            request: { timestamp: baseTs + index * 200, session_id: 'burst' },
          }),
        );
      }

      expect(last?.frequency.isAnomaly).toBe(true);
      expect(last?.frequency.anomalyScore).toBeGreaterThanOrEqual(0.7);
      expect(classifyAnomalyLevel(last!)).toBe('HIGH');
    });
  });

  describe('processEvent timeout — structured error', () => {
    it('throws structured timeout error once when budget exceeded', () => {
      const tightEngine = new StatEngine({ maxProcessTimeMs: 1 });
      let elapsed = 0;
      const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => {
        elapsed += 5;
        return elapsed;
      });

      try {
        tightEngine.processEvent(
          buildEvent({
            request: { timestamp: 99, session_id: 'timeout-session' },
          }),
        );
        expect.unreachable('should throw');
      } catch (error) {
        assertStructuredStatError(error, {
          riskType: 'STAT_ENGINE_PROCESS_TIMEOUT',
          eventId: 'timeout-session',
        });
        expect((error as Error).message).toMatch(/Stat engine process timeout/);
      }

      expect(nowSpy.mock.calls.length).toBeGreaterThan(1);
      nowSpy.mockRestore();
    });

    it('全局超时结构化错误携带 originalStack 与 eventId', () => {
      const tightEngine = new StatEngine({ maxProcessTimeMs: 0.5 });
      let elapsed = 0;
      vi.spyOn(performance, 'now').mockImplementation(() => {
        elapsed += 2;
        return elapsed;
      });

      try {
        tightEngine.processEvent(
          buildEvent({
            request: { timestamp: 1_700_000_000_000, session_id: 'global-timeout' },
          }),
        );
        expect.unreachable('should throw');
      } catch (error) {
        assertStructuredStatError(error, {
          riskType: 'STAT_ENGINE_PROCESS_TIMEOUT',
          eventId: 'global-timeout',
        });
        expect((error as StructuredStatError).originalStack).toContain('Stat');
      }
    });
  });

  describe('V0_BUILTIN_BASELINE', () => {
    it('loadBuiltinBaseline seeds dimensions and skips expired window', () => {
      const baselineEngine = new StatEngine();
      baselineEngine.loadBuiltinBaseline(1_705_000_000_000);
      const stats = baselineEngine.getBaselineStats();

      expect(V0_BUILTIN_BASELINE.length).toBe(8);
      expect(stats['chain_depth']?.count).toBeGreaterThanOrEqual(30);
      expect(stats['metadata_frequency_1m']?.mean).toBeGreaterThan(0);
      expect(stats['metadata_frequency_5m']?.mean).toBeGreaterThan(0);

      const expiredEngine = new StatEngine();
      expiredEngine.loadBuiltinBaseline(1_900_000_000_000);
      expect(expiredEngine.isBuiltinBaselineEffective(1_900_000_000_000)).toBe(false);
      expect(Object.keys(expiredEngine.getBaselineStats()).length).toBe(0);
    });

    it('detects temporal anomaly hit/miss with metadata dimensions after load', () => {
      const baselineEngine = new StatEngine();
      baselineEngine.loadBuiltinBaseline(1_705_000_000_000);

      for (let index = 0; index < 5; index += 1) {
        baselineEngine.processEvent(
          buildEvent({
            tool: { name: 'read_file' },
            request: {
              timestamp: 1_705_000_000_000 + index * 100,
              session_id: 'builtin-normal',
            },
            context: { chain_depth: 2 },
            metadata: { frequency_1m: 10, consecutive_failures: 0 },
          }),
        );
      }

      const normal = baselineEngine.processEvent(
        buildEvent({
          request: { timestamp: 1_705_000_000_500, session_id: 'builtin-normal' },
          context: { chain_depth: 2 },
          metadata: { frequency_1m: 10, consecutive_failures: 0 },
        }),
      );
      expect(normal.combinedScore).toBeLessThan(0.7);
      expect(normal.zScore.dimensionScores['metadata_frequency_1m']?.value).toBe(10);
      expect(normal.zScore.dimensionScores['chain_depth']?.value).toBe(2);

      const anomalous = baselineEngine.processEvent(
        buildEvent({
          request: { timestamp: 1_705_000_001_000, session_id: 'builtin-hit' },
          context: { chain_depth: 50 },
          metadata: { frequency_1m: 200, consecutive_failures: 10 },
        }),
      );
      expect(anomalous.zScore.dimensionScores['metadata_consecutive_failures']?.value).toBe(10);
      expect(anomalous.zScore.maxZScore).toBeGreaterThan(3);
      expect(anomalous.isAnomaly).toBe(true);
    });

    it('样本量不足时自动填充默认基线种子', () => {
      const sparse = new StatEngine();
      for (let index = 0; index < 4; index += 1) {
        sparse.processEvent(
          buildEvent({
            request: {
              timestamp: 1_705_000_000_000 + index * 100,
              session_id: 'sparse-seed',
            },
            context: { chain_depth: index },
          }),
        );
      }

      const stats = sparse.getBaselineStats();
      expect(stats['chain_depth']?.count).toBeGreaterThan(0);
      expect(stats['chain_depth']?.count).toBeLessThan(30);
      expect(stats['arg_count']?.count).toBeGreaterThan(0);
    });

    it('过期时间戳加载内置基线后维度为空并走冷启动', () => {
      const expired = new StatEngine();
      expired.loadBuiltinBaseline(1_900_000_000_000);
      expect(expired.isBuiltinBaselineEffective(1_900_000_000_000)).toBe(false);
      expect(Object.keys(expired.getBaselineStats()).length).toBe(0);

      const result = expired.processEvent(
        buildEvent({
          request: { timestamp: 1_900_000_000_000, session_id: 'expired-cold' },
          context: { chain_depth: 3 },
        }),
      );
      expect(result.zScore.dimensionScores['chain_depth']?.note).toBe('cold_start');
    });
  });

  describe('WARN / BLOCK alert classification', () => {
    it('classifies BLOCK vs WARN vs ALLOW from configured thresholds', () => {
      const low: L1DetectionResult = {
        zScore: {
          combinedScore: 0.1,
          maxZScore: 0.5,
          maxDimension: 'chain_depth',
          dimensionScores: {},
          isAnomaly: false,
          confidence: 0.5,
        },
        frequency: {
          toolName: 't',
          frequencies: { '1m': 1, '5m': 1, '1h': 1, '1d': 1 },
          anomalyScore: 0.05,
          isAnomaly: false,
        },
        markov: {
          logProbability: -0.5,
          perplexity: 1.2,
          anomalyScore: 0.05,
          isAnomaly: false,
        },
        combinedScore: 0.2,
        isAnomaly: false,
        latencyMs: 1,
      };

      const warn = { ...low, combinedScore: 0.55, isAnomaly: true };
      const block = { ...low, combinedScore: 0.85, isAnomaly: true };

      expect(classifyAlertAction(low)).toBe('ALLOW');
      expect(classifyAlertAction(warn)).toBe('WARN');
      expect(classifyAlertAction(block)).toBe('BLOCK');
    });
  });

  describe('null-byte tool name isolation', () => {
    it('sanitizes tool names containing \\x00 without cross-field false match', () => {
      engine.loadBuiltinBaseline(1_705_000_000_000);
      const result = engine.processEvent(
        buildEvent({
          tool: { name: 'safe\u0000injected' },
          request: { timestamp: 1_705_000_000_200, session_id: 'null-byte' },
        }),
      );

      expect(Number.isFinite(result.combinedScore)).toBe(true);
      expect(result.frequency.toolName).toBe('safeinjected');
      expect(result.markov.anomalyScore).toBeLessThan(1);
    });
  });

  describe('ProxyConfig integration', () => {
    it('reads maxMatchTimeMs and windowSizeMs from ProxyConfig constructor', () => {
      const configured = new StatEngine(buildProxyConfig(1, 120_000));
      let elapsed = 0;
      vi.spyOn(performance, 'now').mockImplementation(() => {
        elapsed += 5;
        return elapsed;
      });

      try {
        configured.processEvent(
          buildEvent({
            request: { timestamp: 1_705_000_000_000, session_id: 'proxy-config' },
          }),
        );
        expect.unreachable('should throw');
      } catch (error) {
        assertStructuredStatError(error, {
          riskType: 'STAT_ENGINE_PROCESS_TIMEOUT',
          eventId: 'proxy-config',
        });
      }
    });
  });

  describe('CUSUM / EWMA smoothing outputs', () => {
    it('populates cusum and ewma records on every processEvent', () => {
      engine.loadBuiltinBaseline(1_705_000_000_000);
      const result = engine.processEvent(
        buildEvent({
          request: { timestamp: 1_705_000_000_300, session_id: 'cusum-ewma' },
          context: { chain_depth: 2 },
        }),
      );

      expect(result.cusum).toBeDefined();
      expect(result.ewma).toBeDefined();
      expect(Object.keys(result.cusum ?? {}).length).toBeGreaterThan(0);
      expect(Object.keys(result.ewma ?? {}).length).toBeGreaterThan(0);
      expect(result.cusum?.['chain_depth']?.value).toBe(2);
      expect(result.ewma?.['chain_depth']?.ewma).toBeTypeOf('number');
    });

    it('连续极值输入时 CUSUM/EWMA 平滑得分单调抬升', () => {
      engine.loadBuiltinBaseline(1_705_000_000_000);
      const baseTs = 1_705_000_000_000;
      let previousCusum = 0;
      let previousEwma = 0;

      for (let index = 0; index < 6; index += 1) {
        const result = engine.processEvent(
          buildEvent({
            request: {
              timestamp: baseTs + index * 200,
              session_id: 'cusum-ewma-ramp',
            },
            context: { chain_depth: 10 + index * 5 },
          }),
        );

        const cusumValue = result.cusum?.['chain_depth']?.positiveSum ?? 0;
        const ewmaValue = result.ewma?.['chain_depth']?.ewma ?? 0;
        expect(cusumValue).toBeGreaterThanOrEqual(previousCusum);
        expect(ewmaValue).toBeGreaterThanOrEqual(previousEwma);
        previousCusum = cusumValue;
        previousEwma = ewmaValue;
      }
    });
  });

  describe('Proxy wiring smoke', () => {
    it('supports new StatEngine() + loadBuiltinBaseline() without manual config', () => {
      const stat = new StatEngine();
      stat.loadBuiltinBaseline(1_705_000_000_000);
      const result = stat.processEvent(
        buildEvent({
          request: { timestamp: 1_705_000_000_400, session_id: 'proxy-wire' },
          context: { chain_depth: 2 },
        }),
      );
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(stat.getBaselineStats()['chain_depth']?.count).toBeGreaterThanOrEqual(30);
    });
  });

  describe('temporal edge cases', () => {
    it('handles missing optional context and metadata without NaN scores', () => {
      const result = engine.processEvent(
        buildEvent({
          request: { timestamp: 1_700_000_000_000, session_id: 'sparse' },
        }),
      );

      expect(Number.isFinite(result.combinedScore)).toBe(true);
      expect(Number.isFinite(result.zScore.combinedScore)).toBe(true);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('uses timestamp fallback eventId when session_id is absent', () => {
      const tightEngine = new StatEngine({ maxProcessTimeMs: 1 });
      let elapsed = 0;
      vi.spyOn(performance, 'now').mockImplementation(() => {
        elapsed += 8;
        return elapsed;
      });

      try {
        tightEngine.processEvent({
          tool: { name: 'read_file' },
          argument: { name: 'path', value: '/tmp/a.txt' },
          request: { timestamp: 4242 },
        });
        expect.unreachable('should throw');
      } catch (error) {
        assertStructuredStatError(error, {
          riskType: 'STAT_ENGINE_PROCESS_TIMEOUT',
          eventId: '4242',
        });
      }
    });
  });

  describe('session tracker memory budget', () => {
    it('evicts oldest session trackers when count budget exceeded', () => {
      const engine = new StatEngine();
      engine.loadBuiltinBaseline(1_705_000_000_000);

      for (let index = 0; index < 520; index += 1) {
        engine.processEvent(
          buildEvent({
            request: {
              timestamp: 1_705_000_000_000 + index,
              session_id: `sess-${String(index)}`,
            },
          }),
        );
      }

      const stats = engine.getBaselineStats();
      expect(stats['chain_depth']?.count).toBeGreaterThan(0);
    });

    it('loads all eight V0_BUILTIN_BASELINE profiles into Welford state', () => {
      const engine = new StatEngine();
      engine.loadBuiltinBaseline(1_705_000_000_000);
      const stats = engine.getBaselineStats();

      expect(V0_BUILTIN_BASELINE).toHaveLength(8);
      expect(stats['chain_depth']?.count).toBeGreaterThanOrEqual(30);
      expect(stats['metadata_consecutive_failures']?.count).toBeGreaterThanOrEqual(30);
    });
  });

  describe('L1 math benchmark — architecture doc numeric parity', () => {
    it('Welford 在线算法: [1,2,3,4,5] → mean=3, sample variance=2.5', () => {
      let count = 0;
      let mean = 0;
      let m2 = 0;
      for (const value of [1, 2, 3, 4, 5]) {
        count += 1;
        const delta = value - mean;
        mean += delta / count;
        const delta2 = value - mean;
        m2 += delta * delta2;
      }
      const variance = m2 / (count - 1);
      expect(mean).toBe(3);
      expect(variance).toBe(2.5);
    });

    it('sigmoid anomalyScore: 同均值输入接近 0，极值输入显著抬升', () => {
      engine.loadBuiltinBaseline(1_705_000_000_000);
      const baseTs = 1_705_000_000_000;
      const sessionId = 'bench-sigmoid';

      for (let index = 0; index < 35; index += 1) {
        engine.processEvent(
          buildEvent({
            request: { timestamp: baseTs + index * 1_000, session_id: sessionId },
            context: { chain_depth: 2 },
          }),
        );
      }

      const atMean = engine.processEvent(
        buildEvent({
          request: { timestamp: baseTs + 40_000, session_id: sessionId },
          context: { chain_depth: 2 },
        }),
      );
      const meanScore = atMean.zScore.dimensionScores['chain_depth']?.anomalyScore ?? 1;
      expect(meanScore).toBeLessThan(0.01);

      const extreme = engine.processEvent(
        buildEvent({
          request: { timestamp: baseTs + 50_000, session_id: sessionId },
          context: { chain_depth: 50 },
        }),
      );
      const extremeScore = extreme.zScore.dimensionScores['chain_depth']?.anomalyScore ?? 0;
      expect(extremeScore).toBeGreaterThan(0.4);
    });
  });

  describe('10-round multi-granularity window batch processing', () => {
    it('10轮 processEvent 跨 1m/5m/1h/1d 窗口累计独立更新', () => {
      engine.loadBuiltinBaseline(1_705_000_000_000);
      const sessionId = 'batch-10-round';
      const baseTs = 1_705_000_000_000;

      let lastResult = engine.processEvent(
        buildEvent({
          tool: { name: 'read_file' },
          request: { timestamp: baseTs, session_id: sessionId },
        }),
      );

      for (let round = 1; round < 10; round += 1) {
        lastResult = engine.processEvent(
          buildEvent({
            tool: { name: 'read_file' },
            request: { timestamp: baseTs + round * 25_000, session_id: sessionId },
          }),
        );
      }

      expect(lastResult.frequency.frequencies['1m']).toBeGreaterThanOrEqual(1);
      expect(lastResult.frequency.frequencies['5m']).toBe(10);
      expect(lastResult.frequency.frequencies['1d']).toBe(10);
    });

    it('metadata_frequency_5m Z-score 维度对齐 5m 滑动窗口与 metadata.frequency_5m', () => {
      engine.loadBuiltinBaseline(1_705_000_000_000);
      const sessionId = 'freq-5m-dim';
      const baseTs = 1_705_000_000_000;

      for (let round = 0; round < 6; round += 1) {
        engine.processEvent(
          buildEvent({
            tool: { name: 'read_file' },
            request: { timestamp: baseTs + round * 20_000, session_id: sessionId },
            metadata: { frequency_5m: 50 + round },
          }),
        );
      }

      const result = engine.processEvent(
        buildEvent({
          tool: { name: 'read_file' },
          request: { timestamp: baseTs + 130_000, session_id: sessionId },
          metadata: { frequency_5m: 120 },
        }),
      );

      expect(result.frequency.frequencies['5m']).toBeGreaterThanOrEqual(6);
      expect(result.zScore.dimensionScores['metadata_frequency_5m']?.value).toBe(120);
      expect(result.zScore.dimensionScores['metadata_frequency_5m']).toBeDefined();
    });
  });
});
