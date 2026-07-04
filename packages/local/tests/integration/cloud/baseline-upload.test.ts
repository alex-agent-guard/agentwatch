import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BaselineService } from '../../../src/baseline/BaselineService.js';
import { CloudClient, normalizeCloudEndpoint, type CloudEventPayload } from '../../../src/cloud/CloudClient.js';
import { EventUploader } from '../../../src/cloud/EventUploader.js';
import { RetryQueue } from '../../../src/cloud/RetryQueue.js';
import { AsyncLogger } from '../../../src/logging/AsyncLogger.js';
import { HMACChainManager } from '../../../src/privacy/HMACChainManager.js';
import { DatabaseManager } from '../../../src/storage/DatabaseManager.js';
import { StatEngine } from '../../../src/stat/StatEngine.js';

import type { CloudConfig, DetectionResult, JSONRPCRequest } from '@packages/shared/types';

function buildRequest(overrides?: Partial<JSONRPCRequest>): JSONRPCRequest {
  return {
    jsonrpc: '2.0',
    id: overrides?.id ?? 'evt-e2e',
    method: overrides?.method ?? 'tools/call',
    params: overrides?.params ?? {
      name: 'transfer',
      arguments: { amount: 1000, apiKey: 'secret-key-value' },
      _meta: { sessionId: 'sess-e2e', seq: 1 },
    },
  };
}

function buildResult(overrides?: Partial<DetectionResult>): DetectionResult {
  return {
    decision: overrides?.decision ?? 'BLOCK',
    score: overrides?.score ?? 0.92,
    triggeredRules: overrides?.triggeredRules ?? [],
    statAnomalies: overrides?.statAnomalies ?? [],
  };
}

describe('baseline + cloud upload E2E', () => {
  let previousHome: string | undefined;
  let logRoot = '';

  beforeEach(() => {
    previousHome = process.env['HOME'];
    process.env['HOME'] = mkdtempSync(join(tmpdir(), 'agentwatch-e2e-'));
    logRoot = mkdtempSync(join(tmpdir(), 'agentwatch-log-e2e-'));
    HMACChainManager.initialize();
  });

  afterEach(() => {
    HMACChainManager.reset();
    DatabaseManager.getInstance().close();
    if (previousHome === undefined) {
      delete process.env['HOME'];
    } else {
      process.env['HOME'] = previousHome;
    }
  });

  it('detection log -> masked+HMAC local jsonl -> cloud queue -> retry after outage', async () => {
    const posted: CloudEventPayload[][] = [];
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => 'offline',
      })
      .mockImplementation(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { events: CloudEventPayload[] };
        posted.push(body.events);
        return {
          ok: true,
          status: 200,
          json: async () => ({ batchId: 'b1', accepted: body.events.length, rejected: 0, errors: [] }),
        };
      });

    const cloudConfig: CloudConfig = {
      enabled: true,
      endpoint: 'https://api.agentwatch.test/v1',
      apiKey: 'e2e-key',
      batch: { batchSize: 100, flushIntervalMs: 5000, maxRetries: 5 },
    };

    const queue = new RetryQueue({ maxRetries: 5 });
    const uploader = new EventUploader({
      cloudConfig,
      logger: {
        logAlert: async () => undefined,
      },
      queue,
      client: new CloudClient(
        {
          endpoint: normalizeCloudEndpoint(cloudConfig.endpoint),
          apiKey: cloudConfig.apiKey!,
        },
        { fetchImpl },
      ),
    });

    const logger = new AsyncLogger(
      {
        level: 'info',
        format: 'json',
        output: logRoot,
        mask: { enabled: true, level: 2, sensitiveFields: ['apiKey'] },
        rotation: { maxSizeMB: 100, maxFiles: 7 },
      },
      false,
      undefined,
      { config: cloudConfig, uploader },
    );

    const baselineService = new BaselineService({ userId: 'e2e-user', agentId: 'e2e-agent' });
    const statEngine = new StatEngine();
    statEngine.loadBuiltinBaseline();
    statEngine.setBaselineService(baselineService);

    await logger.logBlocked(buildRequest(), buildResult({ decision: 'BLOCK' }));
    await logger.flush();

    const dateKey = new Date().toISOString().slice(0, 10);
    const blockPath = join(logRoot, dateKey, 'block.jsonl');
    const diskLog = readFileSync(blockPath, 'utf8');
    expect(diskLog).not.toContain('secret-key-value');
    expect(diskLog).toContain('_meta');
    expect(diskLog).toMatch(/"hmac":"[0-9a-f]{64}"/);

    await uploader.flush();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 10_000);
    await uploader.flush();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(posted.length).toBeGreaterThan(0);
    expect(posted[0]?.[0]?.detection.finalDecision).toBe('BLOCK');
    expect(posted[0]?.[0]?.hmac).toMatch(/^[0-9a-f]{64}$/);

    for (let index = 0; index < 2; index += 1) {
      statEngine.processEvent({
        tool: { name: 'transfer' },
        argument: { name: 'amount', value: 100 + index },
        request: { timestamp: Date.now(), session_id: 'sess-e2e' },
      });
    }
    baselineService.persist();
    const reloaded = new BaselineService({ userId: 'e2e-user', agentId: 'e2e-agent' });
    expect(reloaded.hydrateFromStorage()).not.toBeNull();

    await logger.shutdown();
  });
});
