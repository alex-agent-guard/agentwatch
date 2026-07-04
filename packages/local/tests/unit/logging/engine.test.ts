import {
  existsSync,
  mkdtempSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fsMocks = vi.hoisted(() => ({
  appendFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  enabled: false,
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    appendFileSync: (
      ...args: Parameters<typeof actual.appendFileSync>
    ): ReturnType<typeof actual.appendFileSync> => {
      if (fsMocks.enabled) {
        return fsMocks.appendFileSync(...args) as ReturnType<typeof actual.appendFileSync>;
      }
      return actual.appendFileSync(...args);
    },
    mkdirSync: (
      ...args: Parameters<typeof actual.mkdirSync>
    ): ReturnType<typeof actual.mkdirSync> => {
      if (fsMocks.enabled) {
        return fsMocks.mkdirSync(...args) as ReturnType<typeof actual.mkdirSync>;
      }
      return actual.mkdirSync(...args);
    },
  };
});

import { AsyncLogger } from '../../../src/logging/AsyncLogger.js';
import { DataMasker, MaskLevel } from '../../../src/privacy/DataMasker.js';
import { HMACChain } from '../../../src/privacy/HMACChain.js';
import { HMACChainManager } from '../../../src/privacy/HMACChainManager.js';
import { DatabaseManager } from '../../../src/storage/DatabaseManager.js';

import type {
  BehaviorLogEntry,
  DetectionResult,
  JSONRPCRequest,
  LoggingConfig,
} from '@packages/shared/types';

function assertStructuredLogError(
  error: unknown,
  expected: { riskType: string; eventId?: string | null },
): void {
  expect(error).toBeInstanceOf(Error);
  const structured = error as Error & {
    eventId?: string | null;
    riskType?: string;
    originalStack?: string;
  };
  expect(structured.riskType).toBe(expected.riskType);
  if (expected.eventId !== undefined) {
    expect(structured.eventId).toBe(expected.eventId);
  }
  expect(structured.originalStack).toBeTruthy();
}

function buildConfig(output: string): Partial<LoggingConfig> {
  return {
    level: 'info',
    format: 'json',
    output,
    bufferSize: 1000,
    mask: { enabled: false, level: 0, sensitiveFields: [] },
    rotation: { maxSizeMB: 100, maxFiles: 7 },
  };
}

function buildRequest(overrides?: Partial<JSONRPCRequest>): JSONRPCRequest {
  return {
    jsonrpc: '2.0',
    id: overrides?.id ?? 'evt-001',
    method: overrides?.method ?? 'tools/call',
    params: overrides?.params ?? {
      name: 'transfer_funds',
      arguments: { amount: 1000, to: '0xabc' },
      _meta: { sessionId: 'sess-001' },
    },
  };
}

function buildResult(overrides?: Partial<DetectionResult>): DetectionResult {
  return {
    decision: overrides?.decision ?? 'BLOCK',
    score: overrides?.score ?? 0.95,
    triggeredRules: overrides?.triggeredRules ?? [
      {
        ruleId: 'BLOCK_001',
        ruleName: 'Block Rule',
        severity: 'CRITICAL',
        matchedValue: { amount: 1000 },
      },
    ],
    statAnomalies: overrides?.statAnomalies ?? [
      {
        metricName: 'zscore',
        metricType: 'zscore',
        observedValue: 4.2,
        expectedValue: 0,
        deviation: 4.2,
      },
    ],
    ...(overrides?.blockReason !== undefined ? { blockReason: overrides.blockReason } : {}),
    ...(overrides?.markers !== undefined ? { markers: overrides.markers } : {}),
  };
}

function readJsonl(filePath: string): BehaviorLogEntry[] {
  const raw = readFileSync(filePath, 'utf8').trim();
  if (raw.length === 0) {
    return [];
  }
  return raw.split('\n').map((line) => JSON.parse(line) as BehaviorLogEntry);
}

function utcDateKey(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function tierLogPath(root: string, dateKey: string, tier: string): string {
  return join(root, dateKey, `${tier}.jsonl`);
}

describe('AsyncLogger', () => {
  let logRoot = '';
  let previousHome: string | undefined;

  beforeEach(() => {
    logRoot = mkdtempSync(join(tmpdir(), 'agentwatch-log-'));
    previousHome = process.env['HOME'];
    process.env['HOME'] = mkdtempSync(join(tmpdir(), 'agentwatch-hmac-log-'));
    HMACChainManager.initialize();
    fsMocks.enabled = false;
    fsMocks.appendFileSync.mockReset();
    fsMocks.mkdirSync.mockReset();
  });

  afterEach(async () => {
    HMACChainManager.reset();
    if (previousHome === undefined) {
      delete process.env['HOME'];
    } else {
      process.env['HOME'] = previousHome;
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('BLOCK 阻断日志完整写入磁盘，校验 logBlocked 携带完整 ruleId/score', async () => {
    const logger = new AsyncLogger(buildConfig(logRoot), false);

    await logger.logBlocked(
      buildRequest({ id: 'evt-block-1' }),
      buildResult({
        decision: 'BLOCK',
        score: 0.95,
        blockReason: 'Fusion score exceeded block threshold',
      }),
    );
    await logger.flush();
    await logger.shutdown();

    const dateKey = utcDateKey(Date.now());
    const rows = readJsonl(tierLogPath(logRoot, dateKey, 'block'));
    expect(rows).toHaveLength(1);

    const entry = rows[0]!;
    expect(entry.eventId).toBe('evt-block-1');
    expect(entry.tool).toBe('transfer_funds');
    expect(entry.dec).toBe('BLOCK');
    expect(entry.score).toBe(0.95);
    expect(entry.l0_rules?.[0]?.ruleId).toBe('BLOCK_001');
    expect(entry.params?.triggerRuleIds).toEqual(['BLOCK_001']);
    expect(entry.l1_scores?.zscore).toBe(4.2);
  });

  describe('WARN日志分层隔离', () => {
    it('WARN 告警日志分层隔离，不混入 BLOCK 告警存储', async () => {
      const logger = new AsyncLogger(buildConfig(logRoot), false);

      await logger.logBlocked(
        buildRequest({ id: 'evt-block-2' }),
        buildResult({ decision: 'BLOCK', score: 0.99 }),
      );
      await logger.logAllowed(
        buildRequest({ id: 'evt-warn-1' }),
        buildResult({ decision: 'WARN', score: 0.62 }),
      );
      await logger.flush();
      await logger.shutdown();

      const dateKey = utcDateKey(Date.now());
      const blockRows = readJsonl(tierLogPath(logRoot, dateKey, 'block'));
      const warnRows = readJsonl(tierLogPath(logRoot, dateKey, 'warn'));

      expect(blockRows).toHaveLength(1);
      expect(warnRows).toHaveLength(1);
      expect(blockRows[0]?.eventId).toBe('evt-block-2');
      expect(warnRows[0]?.eventId).toBe('evt-warn-1');
      expect(warnRows[0]?.dec).toBe('WARN');
      expect(blockRows.some((row) => row.eventId === 'evt-warn-1')).toBe(false);
      expect(warnRows.some((row) => row.eventId === 'evt-block-2')).toBe(false);
    });

    it('logAlert 写入 warn 层，queryLogs 按 dec 过滤不交叉', async () => {
      const logger = new AsyncLogger(buildConfig(logRoot), false);

      await logger.logBlocked(
        buildRequest({ id: 'evt-block-tier' }),
        buildResult({ decision: 'BLOCK', score: 0.91 }),
      );
      await logger.logAlert({
        alertId: 'alert-warn-tier',
        timestamp: Date.now(),
        severity: 'HIGH',
        scenario: 'frequency_anomaly',
        message: 'burst detected',
        score: 0.72,
      });
      await logger.flush();
      await logger.shutdown();

      const dateKey = utcDateKey(Date.now());
      const blockRows = readJsonl(tierLogPath(logRoot, dateKey, 'block'));
      const warnRows = readJsonl(tierLogPath(logRoot, dateKey, 'warn'));

      expect(blockRows).toHaveLength(1);
      expect(warnRows).toHaveLength(1);
      expect(logger.queryLogs({ dec: 'BLOCK' })).toHaveLength(1);
      expect(logger.queryLogs({ dec: 'WARN' })).toHaveLength(1);
      expect(logger.queryLogs({ dec: 'BLOCK' })[0]?.eventId).toBe('evt-block-tier');
      expect(logger.queryLogs({ dec: 'WARN' })[0]?.eventId).toBe('alert-warn-tier');
    });

    it('ESCALATE 写入 escalate 层，不与 WARN 混写', async () => {
      const logger = new AsyncLogger(buildConfig(logRoot), false);

      await logger.logAllowed(
        buildRequest({ id: 'evt-escalate-1' }),
        buildResult({ decision: 'ESCALATE', score: 0.75 }),
      );
      await logger.logAllowed(
        buildRequest({ id: 'evt-warn-only' }),
        buildResult({ decision: 'WARN', score: 0.62 }),
      );
      await logger.logBlocked(
        buildRequest({ id: 'evt-block-only' }),
        buildResult({ decision: 'BLOCK', score: 0.99 }),
      );
      await logger.flush();
      await logger.shutdown();

      const dateKey = utcDateKey(Date.now());
      const blockRows = readJsonl(tierLogPath(logRoot, dateKey, 'block'));
      const warnRows = readJsonl(tierLogPath(logRoot, dateKey, 'warn'));
      const escalateRows = readJsonl(tierLogPath(logRoot, dateKey, 'escalate'));

      expect(blockRows).toHaveLength(1);
      expect(warnRows).toHaveLength(1);
      expect(escalateRows).toHaveLength(1);
      expect(escalateRows[0]?.dec).toBe('ESCALATE');
      expect(warnRows[0]?.dec).toBe('WARN');
      expect(blockRows[0]?.dec).toBe('BLOCK');
      expect(warnRows.some((row) => row.dec === 'ESCALATE')).toBe(false);
    });
  });

  it('普通 ALLOW 工具调用日志正常落盘', async () => {
    const logger = new AsyncLogger(buildConfig(logRoot), false);

    await logger.logAllowed(
      buildRequest({ id: 'evt-allow-1' }),
      buildResult({
        decision: 'ALLOW',
        score: 0.08,
        triggeredRules: [],
        statAnomalies: [],
      }),
    );
    await logger.flush();
    await logger.shutdown();

    const dateKey = utcDateKey(Date.now());
    const rows = readJsonl(tierLogPath(logRoot, dateKey, 'info'));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.dec).toBe('ALLOW');
    expect(rows[0]?.eventId).toBe('evt-allow-1');
  });

  it('单文件 log.jsonl 模式写入 tier 字段并与 CLI 路径对齐', async () => {
    const logFile = join(logRoot, 'log.jsonl');
    const logger = new AsyncLogger(buildConfig(logFile), false);

    await logger.logBlocked(
      buildRequest({ id: 'evt-single-block' }),
      buildResult({ decision: 'BLOCK', score: 0.95 }),
    );
    await logger.logAllowed(
      buildRequest({ id: 'evt-single-allow' }),
      buildResult({ decision: 'ALLOW', score: 0.1, triggeredRules: [], statAnomalies: [] }),
    );
    await logger.flush();
    await logger.shutdown();

    const rows = readJsonl(logFile);
    expect(rows).toHaveLength(2);
    expect(rows.some((row) => row.eventId === 'evt-single-block' && row.tier === 'block')).toBe(
      true,
    );
    expect(rows.some((row) => row.eventId === 'evt-single-allow' && row.tier === 'info')).toBe(
      true,
    );
  });

  it('高频工具调用批量合并写入，验证 100ms 批处理逻辑', async () => {
    vi.useFakeTimers();
    fsMocks.enabled = true;
    fsMocks.mkdirSync.mockImplementation(() => undefined);
    fsMocks.appendFileSync.mockImplementation(() => undefined);

    const logger = new AsyncLogger(buildConfig(logRoot), false);

    const writes = Array.from({ length: 20 }, (_, index) =>
      logger.logAllowed(
        buildRequest({
          id: `evt-batch-${String(index)}`,
          params: {
            name: 'read_file',
            arguments: { path: `/tmp/${String(index)}.txt` },
          },
        }),
        buildResult({
          decision: 'ALLOW',
          score: 0.05,
          triggeredRules: [],
          statAnomalies: [],
        }),
      ),
    );

    await Promise.all(writes);
    expect(fsMocks.appendFileSync).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100);
    expect(fsMocks.appendFileSync).toHaveBeenCalledTimes(1);

    const payload = fsMocks.appendFileSync.mock.calls[0]?.[1] as string;
    expect(payload.trim().split('\n')).toHaveLength(20);

    await logger.shutdown();
  });

  it('显式 shutdown 刷新队列，无日志丢失', async () => {
    fsMocks.enabled = true;
    fsMocks.mkdirSync.mockImplementation(() => undefined);
    fsMocks.appendFileSync.mockImplementation(() => undefined);

    const logger = new AsyncLogger(buildConfig(logRoot), false);

    await logger.logBlocked(buildRequest({ id: 'evt-shutdown-flush-1' }), buildResult());
    expect(fsMocks.appendFileSync).not.toHaveBeenCalled();

    await logger.shutdown();
    expect(fsMocks.appendFileSync).toHaveBeenCalledTimes(1);

    const payload = fsMocks.appendFileSync.mock.calls[0]?.[1] as string;
    const parsed = JSON.parse(payload.trim()) as BehaviorLogEntry;
    expect(parsed.eventId).toBe('evt-shutdown-flush-1');
  });

  describe('shutdown 多级 flush', () => {
    it('shutdown 幂等，不重复写盘', async () => {
      fsMocks.enabled = true;
      fsMocks.mkdirSync.mockImplementation(() => undefined);
      fsMocks.appendFileSync.mockImplementation(() => undefined);

      const logger = new AsyncLogger(buildConfig(logRoot), false);
      await logger.logAllowed(
        buildRequest({ id: 'evt-multi-shutdown' }),
        buildResult({ decision: 'ALLOW', score: 0.1, triggeredRules: [], statAnomalies: [] }),
      );

      await logger.shutdown();
      await logger.shutdown();

      expect(fsMocks.appendFileSync).toHaveBeenCalledTimes(1);
    });

    it('flush 与 shutdown 均可刷盘', async () => {
      fsMocks.enabled = true;
      fsMocks.mkdirSync.mockImplementation(() => undefined);
      fsMocks.appendFileSync.mockImplementation(() => undefined);

      const logger = new AsyncLogger(buildConfig(logRoot), false);
      await logger.logBlocked(buildRequest({ id: 'evt-flush-shutdown-1' }), buildResult());

      await logger.flush();
      expect(fsMocks.appendFileSync).toHaveBeenCalledTimes(1);

      await logger.shutdown();
    });

    it('writeFlush 与 beforeExit 生命周期接口可用', async () => {
      fsMocks.enabled = true;
      fsMocks.mkdirSync.mockImplementation(() => undefined);
      fsMocks.appendFileSync.mockImplementation(() => undefined);

      const logger = new AsyncLogger(buildConfig(logRoot), false);
      await logger.logAllowed(buildRequest({ id: 'evt-write-flush' }), buildResult());
      await logger.writeFlush();
      expect(fsMocks.appendFileSync).toHaveBeenCalled();
      expect(() => logger.beforeExit()).not.toThrow();
    });
  });

  describe('高频批量刷盘性能', () => {
    it('多轮高频调用分批次刷盘，每轮独立合并写入', async () => {
      vi.useFakeTimers();
      fsMocks.enabled = true;
      fsMocks.mkdirSync.mockImplementation(() => undefined);
      fsMocks.appendFileSync.mockImplementation(() => undefined);

      const logger = new AsyncLogger(buildConfig(logRoot), false);

      for (let round = 0; round < 10; round += 1) {
        const writes = Array.from({ length: 10 }, (_, index) =>
          logger.logAllowed(
            buildRequest({
              id: `evt-round-${String(round)}-${String(index)}`,
              params: { name: 'read_file', arguments: { path: `/r${String(round)}/${String(index)}` } },
            }),
            buildResult({
              decision: 'ALLOW',
              score: 0.05,
              triggeredRules: [],
              statAnomalies: [],
            }),
          ),
        );
        await Promise.all(writes);
        await vi.advanceTimersByTimeAsync(100);
      }

      expect(fsMocks.appendFileSync).toHaveBeenCalledTimes(10);
      const totalLines = fsMocks.appendFileSync.mock.calls.reduce((sum, call) => {
        const payload = call[1] as string;
        return sum + payload.trim().split('\n').length;
      }, 0);
      expect(totalLines).toBe(100);

      await logger.shutdown();
    });
  });

  it('日志写入 IO 超时捕获 ASYNC_LOGGER_WRITE_TIMEOUT 结构化错误', async () => {
    fsMocks.enabled = true;
    fsMocks.mkdirSync.mockImplementation(() => undefined);
    fsMocks.appendFileSync.mockImplementation(() => {
      const start = performance.now();
      while (performance.now() - start < 15) {
        // busy wait to exceed 10ms write budget
      }
    });

    const logger = new AsyncLogger(buildConfig(logRoot), false);
    await logger.logBlocked(buildRequest({ id: 'evt-write-timeout' }), buildResult());

    try {
      await logger.flush();
      expect.unreachable('expected write timeout');
    } catch (error) {
      assertStructuredLogError(error, {
        riskType: 'ASYNC_LOGGER_WRITE_FAILED',
        eventId: 'evt-write-timeout',
      });
      const structured = error as Error & {
        cause?: Error & { riskType?: string; originalStack?: string };
        originalStack?: string;
      };
      const inner = structured.cause as Error & { riskType?: string } | undefined;
      expect(inner?.riskType ?? structured.originalStack).toMatch(
        /ASYNC_LOGGER_WRITE_TIMEOUT|writeBudgetMs|write budget/i,
      );
    }

    await logger.shutdown();
  });

  it('日志写入 IO 异常捕获结构化错误', async () => {
    fsMocks.enabled = true;
    fsMocks.mkdirSync.mockImplementation(() => undefined);
    fsMocks.appendFileSync.mockImplementation(() => {
      throw new Error('disk full');
    });

    const logger = new AsyncLogger(buildConfig(logRoot), false);
    await logger.logBlocked(buildRequest({ id: 'evt-write-fail' }), buildResult());

    try {
      await logger.flush();
      expect.unreachable('expected write failure');
    } catch (error) {
      assertStructuredLogError(error, {
        riskType: 'ASYNC_LOGGER_WRITE_FAILED',
        eventId: 'evt-write-fail',
      });
      const structured = error as Error & {
        eventId?: string | null;
        riskType?: string;
        originalStack?: string;
      };
      expect(structured.eventId).toBe('evt-write-fail');
      expect(structured.riskType).toBe('ASYNC_LOGGER_WRITE_FAILED');
      expect(structured.originalStack).toContain('disk full');
    }

    await logger.shutdown();
  });

  describe('session / eventId / markov 字段边界', () => {
    it('空 session、无 eventId、超长 markov 序列字段边界', async () => {
      const logger = new AsyncLogger(buildConfig(logRoot), false);
      const longMarkovSequence = Array.from({ length: 128 }, (_, index) => `tool_${String(index)}`);

      await logger.logRaw({
        jsonrpc: '2.0',
        id: null,
        method: 'tools/call',
        params: {},
      });
      await logger.logAllowed(
        buildRequest({
          id: 'evt-no-session',
          params: {
            name: 'markov_probe',
            arguments: { sequence: longMarkovSequence },
          },
        }),
        buildResult({
          decision: 'ALLOW',
          score: 0.15,
          triggeredRules: [],
          statAnomalies: longMarkovSequence.map((tool, index) => ({
            metricName: `markov_step_${String(index)}`,
            metricType: 'markov',
            observedValue: index,
            expectedValue: 0,
            deviation: index,
          })),
        }),
      );
      await logger.flush();
      await logger.shutdown();

      const dateKey = utcDateKey(Date.now());
      const rows = readJsonl(tierLogPath(logRoot, dateKey, 'info'));
      expect(rows).toHaveLength(2);

      const noSession = rows.find((row) => row.eventId === 'evt-no-session');
      expect(noSession?.sid).toBe('default');
      expect((noSession?.params?.sequence as string[]).length).toBe(128);
      expect(Object.keys(noSession?.l1_scores ?? {}).length).toBe(128);

      const noEventId = rows.find((row) => row.eventId === 'unknown');
      expect(noEventId?.sid).toBe('default');
      expect(noEventId?.dec).toBe('LOG');
    });
  });

  it('空 event、无 tool 字段、超长 argument 字符串边界用例', async () => {
    const logger = new AsyncLogger(buildConfig(logRoot), false);
    const longArgument = 'x'.repeat(4096);

    await logger.logRaw(
      {
        jsonrpc: '2.0',
        id: null,
        method: 'tools/call',
        params: {},
      },
    );
    await logger.logAllowed(
      buildRequest({
        id: 'evt-long-arg',
        params: {
          arguments: { payload: longArgument },
        },
      }),
      buildResult({
        decision: 'ALLOW',
        score: 0,
        triggeredRules: [],
        statAnomalies: [],
      }),
    );
    await logger.flush();
    await logger.shutdown();

    const dateKey = utcDateKey(Date.now());
    const rows = readJsonl(tierLogPath(logRoot, dateKey, 'info'));
    expect(rows).toHaveLength(2);

    const emptyEvent = rows.find((row) => row.eventId === 'unknown');
    expect(emptyEvent?.tool).toBe('unknown');
    expect(emptyEvent?.dec).toBe('LOG');

    const longArgRow = rows.find((row) => row.eventId === 'evt-long-arg');
    expect((longArgRow?.params?.payload as string).length).toBe(4096);
  });

  describe('日志文件按 1d 粒度切割', () => {
    it('验证日志文件按日期切割、缺失目录自动生成', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-01T12:00:00.000Z'));

      const nestedRoot = join(logRoot, 'nested', 'logs');
      expect(existsSync(nestedRoot)).toBe(false);

      const logger = new AsyncLogger(buildConfig(nestedRoot), false);
      await logger.logAllowed(
        buildRequest({ id: 'evt-day-1' }),
        buildResult({ decision: 'ALLOW', score: 0.1, triggeredRules: [], statAnomalies: [] }),
      );
      await logger.flush();

      expect(existsSync(nestedRoot)).toBe(true);
      expect(existsSync(tierLogPath(nestedRoot, '2026-07-01', 'info'))).toBe(true);

      vi.setSystemTime(new Date('2026-07-02T12:00:00.000Z'));
      await logger.logAllowed(
        buildRequest({ id: 'evt-day-2' }),
        buildResult({ decision: 'ALLOW', score: 0.2, triggeredRules: [], statAnomalies: [] }),
      );
      await logger.flush();
      await logger.shutdown();

      expect(existsSync(tierLogPath(nestedRoot, '2026-07-02', 'info'))).toBe(true);
      expect(readJsonl(tierLogPath(nestedRoot, '2026-07-01', 'info'))).toHaveLength(1);
      expect(readJsonl(tierLogPath(nestedRoot, '2026-07-02', 'info'))).toHaveLength(1);
    });

    it('跨自然日 BLOCK/WARN 分层文件各自按 1d 切割', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-10T08:00:00.000Z'));

      const logger = new AsyncLogger(buildConfig(logRoot), false);
      await logger.logBlocked(buildRequest({ id: 'evt-d10-block' }), buildResult());
      await logger.logAllowed(
        buildRequest({ id: 'evt-d10-warn' }),
        buildResult({ decision: 'WARN', score: 0.6 }),
      );
      await logger.flush();

      vi.setSystemTime(new Date('2026-07-11T08:00:00.000Z'));
      await logger.logBlocked(buildRequest({ id: 'evt-d11-block' }), buildResult());
      await logger.flush();
      await logger.shutdown();

      expect(existsSync(tierLogPath(logRoot, '2026-07-10', 'block'))).toBe(true);
      expect(existsSync(tierLogPath(logRoot, '2026-07-10', 'warn'))).toBe(true);
      expect(existsSync(tierLogPath(logRoot, '2026-07-11', 'block'))).toBe(true);
      expect(readJsonl(tierLogPath(logRoot, '2026-07-10', 'block'))).toHaveLength(1);
      expect(readJsonl(tierLogPath(logRoot, '2026-07-11', 'block'))).toHaveLength(1);
    });
  });

  describe('persistedEntries 内存上限淘汰', () => {
    it('超出内存预算时淘汰最旧条目，保留最新 queryLogs', async () => {
      const logger = new AsyncLogger(buildConfig(logRoot), false, 2048);

      for (let index = 0; index < 30; index += 1) {
        await logger.logAllowed(
          buildRequest({
            id: `evt-mem-${String(index)}`,
            params: {
              name: 'read_file',
              arguments: { payload: 'x'.repeat(120) },
            },
          }),
          buildResult({
            decision: 'ALLOW',
            score: 0.01,
            triggeredRules: [],
            statAnomalies: [],
          }),
        );
      }
      await logger.flush();

      const rows = logger.queryLogs({});
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.length).toBeLessThan(30);
      expect(rows[rows.length - 1]?.eventId).toBe('evt-mem-29');

      await logger.shutdown();
    });
  });

  describe('logRaw ESCALATE 分层', () => {
    it('logRaw 携带 ESCALATE 决策写入 escalate 层，queryLogs 可独立过滤', async () => {
      const logger = new AsyncLogger(buildConfig(logRoot), false);

      await logger.logRaw(
        buildRequest({ id: 'evt-raw-escalate' }),
        buildResult({ decision: 'ESCALATE', score: 0.88 }),
      );
      await logger.logAllowed(
        buildRequest({ id: 'evt-warn-plain' }),
        buildResult({ decision: 'WARN', score: 0.55 }),
      );
      await logger.flush();
      await logger.shutdown();

      const dateKey = utcDateKey(Date.now());
      const escalateRows = readJsonl(tierLogPath(logRoot, dateKey, 'escalate'));
      const warnRows = readJsonl(tierLogPath(logRoot, dateKey, 'warn'));

      expect(escalateRows).toHaveLength(1);
      expect(escalateRows[0]?.dec).toBe('ESCALATE');
      expect(warnRows).toHaveLength(1);
      expect(warnRows[0]?.dec).toBe('WARN');
      expect(logger.queryLogs({ dec: 'ESCALATE' })).toHaveLength(1);
      expect(logger.queryLogs({ dec: 'WARN' })).toHaveLength(1);
    });
  });

  describe('多层 markov / 超长 argument / 跨自然日分片边界', () => {
    it('超长 argument 字符串完整落盘且 l1_scores 字段保留', async () => {
      const logger = new AsyncLogger(buildConfig(logRoot), false);
      const longPayload = 'x'.repeat(8_192);

      await logger.logBlocked(
        buildRequest({
          id: 'evt-long-arg',
          params: {
            name: 'read_file',
            arguments: { content: longPayload },
          },
        }),
        buildResult({
          decision: 'BLOCK',
          score: 0.95,
          triggeredRules: [
            {
              ruleId: 'GOAL_HIJACK_001',
              ruleName: 'Goal Hijack',
              severity: 'CRITICAL',
              matchedValue: longPayload,
            },
          ],
          statAnomalies: [
            {
              metricName: 'markov_anomaly',
              metricType: 'markov',
              observedValue: 0.82,
              expectedValue: 0.1,
              deviation: 3.2,
            },
          ],
        }),
      );
      await logger.flush();
      await logger.shutdown();

      const rows = readJsonl(tierLogPath(logRoot, utcDateKey(Date.now()), 'block'));
      expect(rows).toHaveLength(1);
      expect(String(rows[0]?.params?.content)).toHaveLength(8_192);
      expect(rows[0]?.l1_scores?.markov_anomaly).toBe(0.82);
    });

    it('跨自然日 BLOCK/WARN 分片写入独立日期目录', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-10T08:00:00.000Z'));

      const logger = new AsyncLogger(buildConfig(logRoot), false);

      await logger.logBlocked(
        buildRequest({ id: 'evt-day-one-block' }),
        buildResult({ decision: 'BLOCK', score: 0.91 }),
      );
      await logger.logAllowed(
        buildRequest({ id: 'evt-day-one-warn' }),
        buildResult({ decision: 'WARN', score: 0.55 }),
      );
      await logger.flush();

      expect(readJsonl(tierLogPath(logRoot, '2026-07-10', 'block'))).toHaveLength(1);
      expect(readJsonl(tierLogPath(logRoot, '2026-07-10', 'warn'))).toHaveLength(1);

      vi.setSystemTime(new Date('2026-07-11T08:00:00.000Z'));
      await logger.logBlocked(
        buildRequest({ id: 'evt-day-two-block' }),
        buildResult({ decision: 'BLOCK', score: 0.93 }),
      );
      await logger.flush();
      await logger.shutdown();
      vi.useRealTimers();

      expect(existsSync(tierLogPath(logRoot, '2026-07-11', 'block'))).toBe(true);
      expect(readJsonl(tierLogPath(logRoot, '2026-07-11', 'block'))[0]?.eventId).toBe(
        'evt-day-two-block',
      );
    });

    it('多层 markov 得分写入 l1_scores 且 queryLogs 可检索', async () => {
      const logger = new AsyncLogger(buildConfig(logRoot), false);

      await logger.logAllowed(
        buildRequest({ id: 'evt-markov-layer' }),
        buildResult({
          decision: 'WARN',
          score: 0.62,
          statAnomalies: [
            {
              metricName: 'markov_anomaly',
              metricType: 'markov',
              observedValue: 0.71,
              expectedValue: 0.2,
              deviation: 2.5,
            },
            {
              metricName: 'markov_perplexity',
              metricType: 'markov',
              observedValue: 4.2,
              expectedValue: 1.1,
              deviation: 1.8,
            },
            {
              metricName: 'markov_unknown_ratio',
              metricType: 'markov',
              observedValue: 0.45,
              expectedValue: 0.05,
              deviation: 3.0,
            },
          ],
        }),
      );
      await logger.flush();
      await logger.shutdown();

      const rows = logger.queryLogs({ tid: 'evt-markov-layer' });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.l1_scores?.markov_anomaly).toBe(0.71);
      expect(rows[0]?.l1_scores?.markov_perplexity).toBe(4.2);
      expect(rows[0]?.l1_scores?.markov_unknown_ratio).toBe(0.45);
    });
  });

  describe('DataMasker 脱敏', () => {
    it('BLOCK 决策脱敏 apiKey 与 consecutive_failures', () => {
      const masker = DataMasker.fromLogMaskConfig({
        enabled: true,
        level: 2,
        sensitiveFields: ['apiKey'],
      });
      const masked = masker.maskParams(
        {
          apiKey: 'secret-token-abcdef',
          consecutive_failures: 5,
          note: 'visible',
        },
        'BLOCK',
      );
      expect('maskedValues' in masked).toBe(true);
      if ('maskedValues' in masked) {
        const values = masked.maskedValues as Record<string, unknown>;
        expect(values['apiKey']).toBe('[REDACTED]');
        expect(values['consecutive_failures']).toBe('[REDACTED]');
        expect(values['note']).toBe('visible');
      }
    });

    it('ALLOW 在 level=0 时透传原始值', () => {
      const masker = DataMasker.fromLogMaskConfig({
        enabled: true,
        level: 0,
        sensitiveFields: ['apiKey'],
      });
      const params = { apiKey: 'keep-me' };
      expect(masker.maskParams(params, 'ALLOW')).toEqual(params);
    });
  });

  describe('脱敏与 HMAC 链', () => {
    it('持久化日志自动脱敏，明文敏感字段不出现在磁盘', async () => {
      const logger = new AsyncLogger(
        {
          ...buildConfig(logRoot),
          mask: { enabled: true, level: 2, sensitiveFields: ['apiKey'] },
        },
        false,
      );

      await logger.logBlocked(
        buildRequest({
          id: 'evt-mask-disk',
          params: {
            name: 'transfer_funds',
            arguments: {
              apiKey: 'super-secret-api-key-value',
              note: 'visible-note',
            },
            _meta: { sessionId: 'sess-mask' },
          },
        }),
        buildResult({ decision: 'BLOCK' }),
      );
      await logger.flush();
      await logger.shutdown();

      const rows = readJsonl(tierLogPath(logRoot, utcDateKey(Date.now()), 'block'));
      expect(rows).toHaveLength(1);
      const serialized = JSON.stringify(rows[0]);
      expect(serialized).not.toContain('super-secret-api-key-value');
      expect((rows[0]?.params as Record<string, unknown>)?.apiKey).toBe('[REDACTED]');
      expect((rows[0]?.params as Record<string, unknown>)?.note).toBe('visible-note');
    });

    it('每条日志携带 _meta.hmac，整条链可通过 HMACChain.verifyChain 校验', async () => {
      HMACChainManager.reset();
      const chain = HMACChainManager.initialize();

      const logger = new AsyncLogger(buildConfig(logRoot), false);

      await logger.logBlocked(
        buildRequest({
          id: 'evt-hmac-1',
          params: {
            name: 'tool_a',
            arguments: {},
            _meta: { sessionId: 'sess-hmac', seq: 1 },
          },
        }),
        buildResult({ decision: 'BLOCK', score: 0.9 }),
      );
      await logger.logAllowed(
        buildRequest({
          id: 'evt-hmac-2',
          params: {
            name: 'tool_b',
            arguments: {},
            _meta: { sessionId: 'sess-hmac', seq: 2 },
          },
        }),
        buildResult({ decision: 'WARN', score: 0.6 }),
      );
      await logger.flush();
      await logger.shutdown();

      const blockRows = readJsonl(tierLogPath(logRoot, utcDateKey(Date.now()), 'block'));
      const warnRows = readJsonl(tierLogPath(logRoot, utcDateKey(Date.now()), 'warn'));
      const rows = [...blockRows, ...warnRows];

      expect(rows.length).toBeGreaterThanOrEqual(2);
      for (const row of rows) {
        expect(row._meta?.hmac).toMatch(/^[0-9a-f]{64}$/);
        expect(row._meta?.v).toBe('1.0');
      }

      const verifyChain = new HMACChain({ initialLastHmac: '0'.repeat(64) });
      const signedEntries = rows.map((row) => ({
        ts: row.ts,
        sid: row.sid,
        seq: row.sequence_no ?? 0,
        tool: row.tool,
        dec: row.dec,
        hmac: row._meta!.hmac!,
      }));

      expect(verifyChain.verifyChain(signedEntries)).toEqual({ valid: true });
      void chain;
    });
  });

  describe('cloud upload linkage', () => {
    let previousHome: string | undefined;

    beforeEach(() => {
      previousHome = process.env['HOME'];
      process.env['HOME'] = mkdtempSync(join(tmpdir(), 'agentwatch-logger-cloud-'));
      HMACChainManager.initialize();
    });

    afterEach(() => {
      HMACChainManager.reset();
      try {
        DatabaseManager.getInstance().close();
      } catch {
        // ignore if not opened
      }
      if (previousHome === undefined) {
        delete process.env['HOME'];
      } else {
        process.env['HOME'] = previousHome;
      }
    });

    const enabledCloud = {
      config: {
        enabled: true,
        endpoint: 'https://api.agentwatch.test/v1',
        apiKey: 'test-key',
        batch: { batchSize: 100, flushIntervalMs: 5000, maxRetries: 5 },
      },
    };

    const disabledCloud = {
      config: {
        enabled: false,
        endpoint: 'https://api.agentwatch.test/v1',
        apiKey: 'test-key',
        batch: { batchSize: 100, flushIntervalMs: 5000 },
      },
    };

    function uploadQueueCount(): number {
      const row = DatabaseManager.getInstance()
        .getDb()
        .prepare('SELECT COUNT(*) AS count FROM upload_queue')
        .get() as { count: number };
      return row.count;
    }

    it('does not create EventUploader when cloud.enabled=false', () => {
      const logger = new AsyncLogger(buildConfig(logRoot), false, undefined, disabledCloud);
      expect(logger.getEventUploader()).toBeNull();
    });

    it('logBlocked enqueues masked+HMAC event into upload_queue', async () => {
      const logger = new AsyncLogger(buildConfig(logRoot), false, undefined, enabledCloud);
      await logger.logBlocked(
        buildRequest({ id: 'evt-cloud-block' }),
        buildResult({ decision: 'BLOCK' }),
      );
      logger.getEventUploader()?.stop();

      expect(uploadQueueCount()).toBeGreaterThan(0);
      await logger.shutdown();
    });

    it('logWarn enqueues event into upload_queue', async () => {
      const logger = new AsyncLogger(buildConfig(logRoot), false, undefined, enabledCloud);
      await logger.logWarn(
        buildRequest({ id: 'evt-cloud-warn' }),
        buildResult({ decision: 'WARN', score: 0.6 }),
      );
      logger.getEventUploader()?.stop();

      expect(uploadQueueCount()).toBeGreaterThan(0);
      await logger.shutdown();
    });

    it('logAllowed ALLOW does not enqueue upload_queue rows', async () => {
      const logger = new AsyncLogger(buildConfig(logRoot), false, undefined, enabledCloud);
      await logger.logAllowed(
        buildRequest({ id: 'evt-cloud-allow' }),
        buildResult({ decision: 'ALLOW', score: 0 }),
      );
      logger.getEventUploader()?.stop();

      expect(uploadQueueCount()).toBe(0);
      await logger.shutdown();
    });
  });
});
