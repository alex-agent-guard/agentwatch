/**
 * EventUploader — 定时批量上报 BLOCK/WARN 事件
 * 5s 间隔 flush，单次最多 100 条；失败走 RetryQueue 指数退避
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  CloudClient,
  normalizeCloudEndpoint,
  type CloudEventPayload,
} from './CloudClient.js';
import { toCloudEventPayload } from './cloudEventMapper.js';
import { RetryQueue } from './RetryQueue.js';

import type { AlertRecord, BehaviorLogEntry, CloudConfig } from '@packages/shared/types';
import type { ILogger } from '@packages/shared/types';

/** 默认 SQLite 路径 — 与 DatabaseManager 单例一致 */
export function defaultAgentWatchDbPath(): string {
  return join(homedir(), '.agentwatch', 'agentwatch.db');
}

/** 生产构造参数 — bootstrap 传入全局配置 */
export interface EventUploaderConfig {
  /** SQLite 队列库路径 — RetryQueue 复用 DatabaseManager 单例连接 */
  dbPath: string;
  /** 云端 API 基址 */
  endpoint: string;
  /** Bearer Token */
  apiKey: string;
  /** CLI → Edge Function 上报密钥 */
  uploadSecret?: string;
  /** 结构化日志 — 上报链路告警 */
  logger: Pick<ILogger, 'logAlert'>;
  /** 是否启用云端上报 — 默认 true */
  enabled?: boolean;
  /** flush 间隔 (ms) — 默认 5000 */
  flushIntervalMs?: number;
  /** 单批最大条数 — 默认 100 */
  batchSize?: number;
  /** 被代理 MCP 服务标识 — 写入每条上报事件的 service_name */
  mcpServiceName?: string;
}

/** 测试/集成注入选项 */
export interface EventUploaderOptions extends EventUploaderConfig {
  queue?: RetryQueue;
  client?: CloudClient;
}

/** @deprecated 使用 EventUploaderConfig — 保留 bootstrap 过渡 */
export interface EventUploaderLegacyOptions {
  cloudConfig: CloudConfig;
  logger: Pick<ILogger, 'logAlert'>;
  queue?: RetryQueue;
  client?: CloudClient;
  flushIntervalMs?: number;
  batchSize?: number;
}

const DEFAULT_FLUSH_INTERVAL_MS = 5000;
const DEFAULT_BATCH_SIZE = 100;

function isLegacyOptions(
  options: EventUploaderConfig | EventUploaderLegacyOptions,
): options is EventUploaderLegacyOptions {
  return 'cloudConfig' in options;
}

function resolveConfig(
  options: EventUploaderConfig | EventUploaderLegacyOptions,
): EventUploaderConfig {
  if (!isLegacyOptions(options)) {
    return options;
  }

  const { cloudConfig } = options;
  return {
    dbPath: defaultAgentWatchDbPath(),
    endpoint: normalizeCloudEndpoint(cloudConfig.endpoint),
    apiKey: cloudConfig.apiKey ?? '',
    ...(cloudConfig.uploadSecret ? { uploadSecret: cloudConfig.uploadSecret } : {}),
    logger: options.logger,
    enabled: cloudConfig.enabled,
    flushIntervalMs:
      options.flushIntervalMs ?? cloudConfig.batch.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS,
    batchSize: options.batchSize ?? cloudConfig.batch.batchSize ?? DEFAULT_BATCH_SIZE,
  };
}

export class EventUploader {
  private readonly dbPath: string;
  private readonly queue: RetryQueue;
  private readonly client: CloudClient;
  private readonly logger: Pick<ILogger, 'logAlert'>;
  private readonly enabled: boolean;
  private readonly flushIntervalMs: number;
  private readonly batchSize: number;
  private readonly mcpServiceName?: string;
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;

  constructor(options: EventUploaderOptions | EventUploaderLegacyOptions) {
    const config = resolveConfig(options);
    this.dbPath = config.dbPath;
    this.logger = config.logger;
    this.enabled = config.enabled ?? true;
    this.flushIntervalMs = config.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this.batchSize = config.batchSize ?? DEFAULT_BATCH_SIZE;
    if (config.mcpServiceName !== undefined) {
      this.mcpServiceName = config.mcpServiceName;
    }

    const queueLogger = {
      logAlert: (alert: AlertRecord) => this.logger.logAlert(alert),
    };

    const injectable = options as EventUploaderOptions;

    if (isLegacyOptions(options)) {
      this.queue =
        injectable.queue ??
        new RetryQueue({ logger: queueLogger });
      this.client =
        injectable.client ??
        new CloudClient(
          {
            endpoint: normalizeCloudEndpoint(options.cloudConfig.endpoint),
            apiKey: options.cloudConfig.apiKey ?? '',
            ...(options.cloudConfig.uploadSecret
              ? { uploadSecret: options.cloudConfig.uploadSecret }
              : {}),
          },
          { logger: queueLogger },
        );
      return;
    }

    this.queue =
      injectable.queue ??
      new RetryQueue({ logger: queueLogger });
    this.client =
      injectable.client ??
      new CloudClient(
        {
          endpoint: normalizeCloudEndpoint(config.endpoint),
          apiKey: config.apiKey,
          ...(config.uploadSecret ? { uploadSecret: config.uploadSecret } : {}),
        },
        { logger: queueLogger },
      );
  }

  /** 获取构造时声明的 SQLite 路径 — 队列实际复用 DatabaseManager 单例 */
  getDbPath(): string {
    return this.dbPath;
  }

  start(): void {
    try {
      if (this.timer !== null || !this.enabled) {
        return;
      }
      this.timer = setInterval(() => {
        void this.flush();
      }, this.flushIntervalMs);
      this.logInfo(
        `定时上报队列已启动，${String(this.flushIntervalMs)}ms 刷新一次`,
      );
    } catch (cause) {
      this.logError('start failed', cause);
    }
  }

  stop(): void {
    try {
      if (this.timer !== null) {
        clearInterval(this.timer);
        this.timer = null;
      }
      this.queue.flushToDisk();
      this.logInfo('上报器停止，内存事件已落盘 SQLite');
    } catch (cause) {
      this.logError('stop failed', cause);
    }
  }

  /**
   * 由 AsyncLogger cloudSink 调用 — 仅 BLOCK/WARN 行为日志入队
   * ALLOW 事件在此过滤，不进入上报队列
   */
  enqueue(entry: BehaviorLogEntry): void {
    try {
      if (!this.enabled) {
        return;
      }
      if (entry.dec !== 'BLOCK' && entry.dec !== 'WARN') {
        return;
      }
      if (!entry._meta?.hmac && !entry.hmac) {
        this.logInfo(`skip event without hmac eventId=${entry.eventId}`);
        return;
      }
      this.queue.push(
        toCloudEventPayload(entry, {
          ...(this.mcpServiceName ? { mcpServiceName: this.mcpServiceName } : {}),
        }),
      );
    } catch (cause) {
      this.logError('事件入队失败', cause);
    }
  }

  /** 直接入队 CloudEventPayload — 测试或已映射载荷 */
  enqueuePayload(event: CloudEventPayload): void {
    try {
      if (!this.enabled) {
        return;
      }
      this.queue.push(event);
    } catch (cause) {
      this.logError('事件入队失败', cause);
    }
  }

  /** 立即执行一次批量上报 — 定时器与手动均可调用 */
  async flush(): Promise<void> {
    if (!this.enabled || this.flushing) {
      return;
    }

    this.flushing = true;
    let events: CloudEventPayload[] = [];

    try {
      events = this.queue.pollDueEvents(this.batchSize);
      if (events.length === 0) {
        return;
      }

      const result = await this.client.uploadBatch(events);

      if (result === null) {
        this.logError('批量上报请求失败，全部事件进入重试队列', null);
        for (const event of events) {
          const retryCount = this.queue.getRetryCount(event.eventId);
          this.queue.nack(event.eventId, retryCount);
        }
        return;
      }

      const failedIndices = new Set(result.errors.map((error) => error.index));
      const successIds: string[] = [];

      for (let index = 0; index < events.length; index += 1) {
        if (!failedIndices.has(index)) {
          successIds.push(events[index]!.eventId);
        }
      }

      if (successIds.length > 0) {
        this.queue.ack(successIds);
      }

      for (const error of result.errors) {
        const failedEvent = events[error.index];
        if (failedEvent !== undefined) {
          const retryCount = this.queue.getRetryCount(failedEvent.eventId);
          this.queue.nack(failedEvent.eventId, retryCount);
        }
      }

      this.logInfo(
        `批量上报完成，共 ${String(events.length)} 条，失败 ${String(result.errors.length)} 条`,
      );
    } catch (cause) {
      this.logError('批量上报请求失败，全部事件进入重试队列', cause);
      for (const event of events) {
        try {
          const retryCount = this.queue.getRetryCount(event.eventId);
          this.queue.nack(event.eventId, retryCount);
        } catch (nackCause) {
          this.logError(`nack failed eventId=${event.eventId}`, nackCause);
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  private logInfo(message: string): void {
    console.info(`[CloudUpload] ${message}`);
  }

  private logError(message: string, cause: unknown): void {
    const detail =
      cause === null
        ? ''
        : cause instanceof Error
          ? cause.stack ?? cause.message
          : String(cause);
    const fullMessage =
      detail.length > 0 ? `[CloudUpload] ${message}: ${detail}` : `[CloudUpload] ${message}`;

    void Promise.resolve(
      this.logger.logAlert({
        alertId: `cloud-upload-${String(Date.now())}`,
        timestamp: Date.now(),
        severity: 'CRITICAL',
        scenario: 'cloud_upload_fault',
        message: fullMessage,
        score: 1,
      }),
    ).catch(() => {
      console.error(fullMessage);
    });
  }
}

export type { CloudEventPayload };
