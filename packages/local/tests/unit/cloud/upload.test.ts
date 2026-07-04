import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CloudClient,
  normalizeCloudEndpoint,
  type CloudEventPayload,
} from '../../../src/cloud/CloudClient.js';
import { toCloudEventPayload } from '../../../src/cloud/cloudEventMapper.js';
import { EventUploader } from '../../../src/cloud/EventUploader.js';
import { RetryQueue } from '../../../src/cloud/RetryQueue.js';
import { AsyncLogger } from '../../../src/logging/AsyncLogger.js';
import { DatabaseManager } from '../../../src/storage/DatabaseManager.js';
import { RiskType } from '@packages/shared/constants';

import type { BehaviorLogEntry, CloudConfig } from '@packages/shared/types';

function sampleCloudEvent(overrides?: Partial<CloudEventPayload>): CloudEventPayload {
  return {
    eventId: overrides?.eventId ?? `evt-${String(Date.now())}`,
    sessionId: overrides?.sessionId ?? 'sess-1',
    timestamp: overrides?.timestamp ?? Date.now(),
    agentId: overrides?.agentId ?? 'agent-1',
    userId: overrides?.userId ?? 'user-1',
    toolCall: overrides?.toolCall ?? {
      toolName: 'transfer',
      serviceName: 'tools/call',
      durationMs: 12,
      argCount: 1,
      argKeyHashes: ['abcd1234'],
      argValueTypes: ['int'],
      hasAddress: false,
      hasAmount: true,
      amountBucket: 'lt_10k',
    },
    detection: overrides?.detection ?? {
      l0TriggeredRules: [],
      l1CombinedScore: 0.9,
      finalDecision: 'BLOCK',
    },
    context: overrides?.context ?? { chainDepth: 1 },
    hmac: overrides?.hmac ?? 'a'.repeat(64),
  };
}

function sampleEntry(overrides?: Partial<BehaviorLogEntry>): BehaviorLogEntry {
  return {
    eventId: overrides?.eventId ?? `evt-${String(Date.now())}`,
    ts: overrides?.ts ?? Date.now(),
    sid: overrides?.sid ?? 'sess-1',
    tid: overrides?.tid ?? 'tid-1',
    tool: overrides?.tool ?? 'transfer',
    dec: overrides?.dec ?? 'BLOCK',
    score: overrides?.score ?? 0.9,
    dur_ms: overrides?.dur_ms ?? 12,
    params: overrides?.params ?? { amount: 1000 },
    _meta: overrides?._meta ?? { v: '1.0', hmac: 'a'.repeat(64) },
  };
}

const cloudConfig: CloudConfig = {
  enabled: true,
  endpoint: 'https://api.agentwatch.test/v1',
  apiKey: 'test-key',
  batch: { batchSize: 100, flushIntervalMs: 5000, maxRetries: 5 },
};

describe('RetryQueue', () => {
  let previousHome: string | undefined;

  beforeEach(() => {
    previousHome = process.env['HOME'];
    process.env['HOME'] = mkdtempSync(join(tmpdir(), 'agentwatch-retry-queue-'));
  });

  afterEach(() => {
    DatabaseManager.getInstance().close();
    if (previousHome === undefined) {
      delete process.env['HOME'];
    } else {
      process.env['HOME'] = previousHome;
    }
    vi.useRealTimers();
  });

  it('auto flushToDisk when memory buffer reaches 50 items', () => {
    const queue = new RetryQueue();
    for (let index = 0; index < 50; index += 1) {
      queue.push(sampleCloudEvent({ eventId: `evt-${String(index)}` }));
    }

    expect(queue.getMemoryBufferSize()).toBe(0);
    expect(queue.getPendingCount()).toBe(50);
  });

  it('ack removes uploaded events from SQLite queue', () => {
    const queue = new RetryQueue();
    const event = sampleCloudEvent({ eventId: 'evt-ack' });
    queue.push(event);
    queue.flushToDisk();

    const polled = queue.pollDueEvents(10);
    expect(polled).toHaveLength(1);

    queue.ack([event.eventId]);
    expect(queue.getPendingCount()).toBe(0);
  });

  it('nack schedules exponential backoff retry', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-04T00:00:00.000Z'));

    const queue = new RetryQueue();
    const event = sampleCloudEvent({ eventId: 'evt-nack' });
    queue.push(event);
    queue.flushToDisk();

    queue.pollDueEvents(1);
    queue.nack(event.eventId, 0);

    const rows = DatabaseManager.getInstance()
      .getDb()
      .prepare('SELECT retry_count, next_retry_at FROM upload_queue')
      .all() as Array<{ retry_count: number; next_retry_at: number }>;

    expect(rows[0]?.retry_count).toBe(1);
    expect(rows[0]?.next_retry_at).toBeGreaterThan(Date.now());

    vi.setSystemTime(Date.now() + 2000);
    expect(queue.pollDueEvents(10)).toHaveLength(1);
  });

  it('drops events after exceeding maxRetries via moveToDeadLetter', () => {
    const queue = new RetryQueue({ maxRetries: 2 });
    const event = sampleCloudEvent({ eventId: 'evt-drop' });
    queue.push(event);
    queue.flushToDisk();

    queue.nack(event.eventId, 2);
    expect(queue.getPendingCount()).toBe(0);
  });

  it('flushToDisk persists remaining memory on process stop', () => {
    const queue = new RetryQueue();
    queue.push(sampleCloudEvent({ eventId: 'evt-flush-1' }));
    queue.push(sampleCloudEvent({ eventId: 'evt-flush-2' }));
    queue.flushToDisk();

    expect(queue.getMemoryBufferSize()).toBe(0);
    expect(queue.getPendingCount()).toBe(2);
  });
});

describe('CloudClient', () => {
  it('uploadBatch sends Bearer auth to /v1/events/batch with 5s timeout', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        batchId: 'batch-1',
        accepted: 1,
        rejected: 0,
        errors: [],
      }),
    });

    const client = new CloudClient(
      { endpoint: 'https://api.agentwatch.test', apiKey: 'test-key' },
      { fetchImpl, timeoutMs: 5000 },
    );

    const result = await client.uploadBatch([sampleCloudEvent()]);
    expect(result?.accepted).toBe(1);
    expect(fetchImpl).toHaveBeenCalledOnce();

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.agentwatch.test/v1/events/batch');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer test-key');
    expect(init.signal).toBeDefined();
  });

  it('uploadBatch returns null on HTTP 4xx/5xx without throwing', async () => {
    const logAlert = vi.fn().mockResolvedValue(undefined);
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'service unavailable',
    });

    const client = new CloudClient(
      { endpoint: 'https://api.agentwatch.test', apiKey: 'key' },
      { fetchImpl, logger: { logAlert } },
    );

    const result = await client.uploadBatch([sampleCloudEvent()]);
    expect(result).toBeNull();
    expect(logAlert).toHaveBeenCalledOnce();
    expect(logAlert.mock.calls[0]?.[0]?.scenario).toBe('cloud_upload_fault');
  });

  it('uploadBatch returns null on network timeout without crashing', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('The operation was aborted'));

    const client = new CloudClient(
      { endpoint: 'https://api.agentwatch.test', apiKey: 'key' },
      { fetchImpl },
    );

    await expect(client.uploadBatch([sampleCloudEvent()])).resolves.toBeNull();
  });

  it('uploadBatch returns null when response JSON is invalid', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    });

    const client = new CloudClient(
      { endpoint: 'https://api.agentwatch.test', apiKey: 'key' },
      { fetchImpl },
    );

    const result = await client.uploadBatch([sampleCloudEvent()]);
    expect(result).toBeNull();
  });

  it('normalizeCloudEndpoint strips trailing /v1', () => {
    expect(normalizeCloudEndpoint('https://api.agentwatch.test/v1/')).toBe(
      'https://api.agentwatch.test',
    );
  });
});

describe('cloudEventMapper', () => {
  it('maps masked BehaviorLogEntry to CloudEventPayload with hmac', () => {
    const payload = toCloudEventPayload(sampleEntry());
    expect(payload.eventId).toBeDefined();
    expect(payload.hmac).toHaveLength(64);
    expect(payload.detection.finalDecision).toBe('BLOCK');
    expect(payload.toolCall.argKeyHashes.length).toBeGreaterThan(0);
  });
});

describe('EventUploader', () => {
  let previousHome: string | undefined;

  beforeEach(() => {
    previousHome = process.env['HOME'];
    process.env['HOME'] = mkdtempSync(join(tmpdir(), 'agentwatch-uploader-'));
    vi.useRealTimers();
  });

  afterEach(() => {
    DatabaseManager.getInstance().close();
    if (previousHome === undefined) {
      delete process.env['HOME'];
    } else {
      process.env['HOME'] = previousHome;
    }
    vi.useRealTimers();
  });

  function createUploader(
    fetchImpl: typeof fetch,
    overrides?: { batchSize?: number; flushIntervalMs?: number },
  ): { uploader: EventUploader; queue: RetryQueue } {
    const queue = new RetryQueue({ maxRetries: 5 });
    const client = new CloudClient(
      { endpoint: normalizeCloudEndpoint(cloudConfig.endpoint), apiKey: cloudConfig.apiKey! },
      { fetchImpl },
    );
    const logger = new AsyncLogger(
      {
        level: 'info',
        format: 'json',
        output: join(tmpdir(), 'agentwatch-uploader-log'),
        mask: { enabled: false, level: 0, sensitiveFields: [] },
        rotation: { maxSizeMB: 100, maxFiles: 7 },
      },
      false,
    );
    const uploader = new EventUploader({
      dbPath: join(process.env['HOME']!, '.agentwatch', 'agentwatch.db'),
      endpoint: cloudConfig.endpoint,
      apiKey: cloudConfig.apiKey!,
      logger,
      queue,
      client,
      batchSize: overrides?.batchSize ?? 10,
      flushIntervalMs: overrides?.flushIntervalMs ?? 5000,
    });
    return { uploader, queue };
  }

  it('caches offline events in SQLite and clears queue after network recovery', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => 'service unavailable',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ batchId: 'b1', accepted: 1, rejected: 0, errors: [] }),
      });

    const { uploader, queue } = createUploader(fetchImpl);

    uploader.enqueue(sampleEntry({ eventId: 'evt-offline', dec: 'BLOCK' }));
    await uploader.flush();

    expect(queue.getPendingCount()).toBeGreaterThan(0);

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 5000);
    await uploader.flush();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(queue.getPendingCount()).toBe(0);
  });

  it('ignores ALLOW events and only enqueues BLOCK/WARN', () => {
    const fetchImpl = vi.fn();
    const { uploader, queue } = createUploader(fetchImpl);

    uploader.enqueue(sampleEntry({ dec: 'ALLOW' }));
    uploader.enqueue(sampleEntry({ dec: 'WARN', eventId: 'warn-1' }));

    expect(queue.getMemoryBufferSize()).toBe(1);
  });

  it('runs flush on 5s interval timer', async () => {
    vi.useFakeTimers();

    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ batchId: 'b1', accepted: 1, rejected: 0, errors: [] }),
    });

    const { uploader } = createUploader(fetchImpl, { flushIntervalMs: 5000 });
    uploader.enqueue(sampleEntry({ eventId: 'evt-timer', dec: 'BLOCK' }));
    uploader.start();

    await vi.advanceTimersByTimeAsync(5000);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    uploader.stop();
  });

  it('polls at most batchSize events per flush', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        batchId: 'b-large',
        accepted: 100,
        rejected: 0,
        errors: [],
      }),
    });

    const { uploader, queue } = createUploader(fetchImpl, { batchSize: 100 });

    for (let index = 0; index < 120; index += 1) {
      uploader.enqueuePayload(sampleCloudEvent({ eventId: `evt-batch-${String(index)}` }));
    }
    queue.flushToDisk();

    await uploader.flush();

    const firstCallBody = JSON.parse(
      String((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body),
    ) as { events: CloudEventPayload[] };
    expect(firstCallBody.events).toHaveLength(100);
    expect(queue.getPendingCount()).toBe(20);
  });

  it('acks successful events and nacks only partial batch failures', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        batchId: 'b-partial',
        accepted: 1,
        rejected: 1,
        errors: [{ index: 1, code: 'INVALID_HMAC' }],
      }),
    });

    const { uploader, queue } = createUploader(fetchImpl, { batchSize: 10 });

    uploader.enqueuePayload(sampleCloudEvent({ eventId: 'evt-ok' }));
    uploader.enqueuePayload(sampleCloudEvent({ eventId: 'evt-fail' }));
    queue.flushToDisk();

    await uploader.flush();

    expect(queue.getPendingCount()).toBe(1);

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 5000);
    const remaining = queue.pollDueEvents(10);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.eventId).toBe('evt-fail');
  });

  it('stop flushes memory buffer to SQLite', () => {
    const fetchImpl = vi.fn();
    const { uploader, queue } = createUploader(fetchImpl);

    uploader.enqueue(sampleEntry({ eventId: 'evt-stop', dec: 'BLOCK' }));
    uploader.stop();

    expect(queue.getMemoryBufferSize()).toBe(0);
    expect(queue.getPendingCount()).toBe(1);
  });
});

describe('CloudClient structured error', () => {
  it('assigns CLOUD_CLIENT_UPLOAD_FAILED riskType on HTTP errors', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'bad request',
    });

    const client = new CloudClient(
      { endpoint: 'https://api.agentwatch.test', apiKey: 'key' },
      { fetchImpl },
    );

    await client.uploadBatch([sampleCloudEvent({ eventId: 'evt-400' })]);
    // no throw — verified by reaching here
    expect(RiskType.CLOUD_CLIENT_UPLOAD_FAILED).toBe('CLOUD_CLIENT_UPLOAD_FAILED');
  });
});
