/**
 * RetryQueue — 云端上报内存缓冲 + SQLite upload_queue 持久化
 * 内存上限 50 条，满量事务落盘；指数退避重试，最多 5 次，单次延迟上限 30s
 */
import { DatabaseManager } from '../storage/DatabaseManager.js';

import type { CloudEventPayload } from './CloudClient.js';
import type { ILogger } from '@packages/shared/types';

/** SQLite upload_queue 行结构 */
interface QueuedEvent {
  id: number;
  payload: string;
  retry_count: number;
  next_retry_at: number;
  created_at?: number;
}

type RetryQueueLogger = Pick<ILogger, 'logAlert'>;

export interface RetryQueueOptions {
  /** 内存缓冲上限 — 默认 50 */
  maxBuffer?: number;
  /** 最大重试次数 — 默认 5 */
  maxRetries?: number;
  /** 指数退避基数 (ms) — 默认 1000 */
  baseDelayMs?: number;
  /** 单次最大退避延迟 (ms) — 默认 30000 */
  maxDelayMs?: number;
  /** 结构化错误日志 — AsyncLogger */
  logger?: RetryQueueLogger | null;
}

const DEFAULT_MAX_BUFFER = 50;
const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 30_000;

export class RetryQueue {
  private readonly db = DatabaseManager.getInstance().getDb();
  private memoryBuffer: CloudEventPayload[] = [];
  private readonly maxBuffer: number;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly logger: RetryQueueLogger | null;

  constructor(options?: RetryQueueOptions) {
    this.maxBuffer = options?.maxBuffer ?? DEFAULT_MAX_BUFFER;
    this.maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.baseDelayMs = options?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
    this.maxDelayMs = options?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
    this.logger = options?.logger ?? null;
    this.ensureUploadQueueTable();
  }

  /** 入队 — 满 maxBuffer 自动 flushToDisk */
  push(event: CloudEventPayload): void {
    try {
      this.memoryBuffer.push(event);
      if (this.memoryBuffer.length >= this.maxBuffer) {
        this.flushToDisk();
      }
    } catch (cause) {
      this.recordError('push failed', cause, event.eventId);
    }
  }

  /** 内存缓冲事务写入 SQLite — 进程退出时主动调用 */
  flushToDisk(): void {
    if (this.memoryBuffer.length === 0) {
      return;
    }

    const batch = [...this.memoryBuffer];
    try {
      const insert = this.db.prepare(
        'INSERT INTO upload_queue (payload, next_retry_at, retry_count) VALUES (?, ?, ?)',
      );
      const transaction = this.db.transaction((events: CloudEventPayload[]) => {
        const now = Date.now();
        for (const ev of events) {
          insert.run(JSON.stringify(ev), now, 0);
        }
      });
      transaction(batch);
      this.memoryBuffer = [];
    } catch (cause) {
      this.recordError('flushToDisk failed', cause, batch[0]?.eventId ?? null);
    }
  }

  /** 取出到期可上报事件 — 先 flush 内存，再按 id 顺序读取 */
  pollDueEvents(limit = 100): CloudEventPayload[] {
    try {
      this.flushToDisk();
      const rows = this.db
        .prepare(
          `SELECT id, payload, retry_count, next_retry_at
           FROM upload_queue
           WHERE next_retry_at <= ?
           ORDER BY id ASC
           LIMIT ?`,
        )
        .all(Date.now(), limit) as QueuedEvent[];

      const events: CloudEventPayload[] = [];
      for (const row of rows) {
        try {
          events.push(JSON.parse(row.payload) as CloudEventPayload);
        } catch (cause) {
          this.recordError('pollDueEvents JSON parse failed', cause, null);
          this.deleteRowById(row.id);
        }
      }
      return events;
    } catch (cause) {
      this.recordError('pollDueEvents failed', cause, null);
      return [];
    }
  }

  /** 读取事件当前 retry_count — nack 前查询 */
  getRetryCount(eventId: string): number {
    try {
      this.flushToDisk();
      const rows = this.db
        .prepare('SELECT id, payload, retry_count FROM upload_queue')
        .all() as QueuedEvent[];

      for (const row of rows) {
        try {
          const parsed = JSON.parse(row.payload) as CloudEventPayload;
          if (parsed.eventId === eventId) {
            return row.retry_count;
          }
        } catch {
          continue;
        }
      }
      return 0;
    } catch (cause) {
      this.recordError('getRetryCount failed', cause, eventId);
      return 0;
    }
  }

  /** 上报成功 — 按 eventId 删除队列记录 */
  ack(eventIds: string[]): void {
    if (eventIds.length === 0) {
      return;
    }

    try {
      this.flushToDisk();
      const allRows = this.db
        .prepare('SELECT id, payload FROM upload_queue')
        .all() as QueuedEvent[];
      const deleteStmt = this.db.prepare('DELETE FROM upload_queue WHERE id = ?');
      const delTransaction = this.db.transaction((rowIds: number[]) => {
        for (const rid of rowIds) {
          deleteStmt.run(rid);
        }
      });

      const idSet = new Set(eventIds);
      const toDelete: number[] = [];
      for (const row of allRows) {
        try {
          const parsed = JSON.parse(row.payload) as CloudEventPayload;
          if (idSet.has(parsed.eventId)) {
            toDelete.push(row.id);
          }
        } catch (cause) {
          this.recordError('ack JSON parse failed', cause, null);
          toDelete.push(row.id);
        }
      }

      if (toDelete.length > 0) {
        delTransaction(toDelete);
      }
    } catch (cause) {
      this.recordError('ack failed', cause, eventIds[0] ?? null);
    }
  }

  /** 上报失败 — 指数退避更新 next_retry_at；超限 moveToDeadLetter */
  nack(eventId: string, retryCount: number): void {
    try {
      if (retryCount >= this.maxRetries) {
        this.moveToDeadLetter(eventId);
        return;
      }

      const delay = Math.min(
        this.baseDelayMs * 2 ** retryCount,
        this.maxDelayMs,
      );
      const nextRetry = Date.now() + delay;

      this.flushToDisk();
      const allRows = this.db
        .prepare('SELECT id, payload, retry_count FROM upload_queue')
        .all() as QueuedEvent[];
      const updateStmt = this.db.prepare(
        'UPDATE upload_queue SET retry_count = ?, next_retry_at = ? WHERE id = ?',
      );

      for (const row of allRows) {
        let parsed: CloudEventPayload;
        try {
          parsed = JSON.parse(row.payload) as CloudEventPayload;
        } catch (cause) {
          this.recordError('nack JSON parse failed', cause, eventId);
          this.deleteRowById(row.id);
          continue;
        }

        if (parsed.eventId === eventId) {
          updateStmt.run(retryCount + 1, nextRetry, row.id);
          return;
        }
      }
    } catch (cause) {
      this.recordError('nack failed', cause, eventId);
    }
  }

  /** 待上报条目总数 — 含内存 + SQLite */
  getPendingCount(): number {
    try {
      this.flushToDisk();
      const row = this.db
        .prepare('SELECT COUNT(*) AS count FROM upload_queue')
        .get() as { count: number };
      return row.count + this.memoryBuffer.length;
    } catch (cause) {
      this.recordError('getPendingCount failed', cause, null);
      return this.memoryBuffer.length;
    }
  }

  getMemoryBufferSize(): number {
    return this.memoryBuffer.length;
  }

  /** @deprecated 使用 push */
  enqueue(event: CloudEventPayload): void {
    this.push(event);
  }

  /** @deprecated 使用 flushToDisk */
  flushMemoryToDisk(): void {
    this.flushToDisk();
  }

  /** @deprecated 使用 getPendingCount */
  countPersisted(): number {
    return this.getPendingCount();
  }

  /** 超过最大重试 — V0 直接丢弃并写告警日志 */
  private moveToDeadLetter(eventId: string): void {
    try {
      this.flushToDisk();
      const allRows = this.db
        .prepare('SELECT id, payload FROM upload_queue')
        .all() as QueuedEvent[];

      for (const row of allRows) {
        try {
          const parsed = JSON.parse(row.payload) as CloudEventPayload;
          if (parsed.eventId === eventId) {
            this.deleteRowById(row.id);
            const message = `[RetryQueue] dead-letter drop eventId=${eventId} after maxRetries=${String(this.maxRetries)}`;
            this.recordError(message, new Error(message), eventId);
            return;
          }
        } catch (cause) {
          this.deleteRowById(row.id);
          this.recordError('moveToDeadLetter parse failed', cause, eventId);
        }
      }
    } catch (cause) {
      this.recordError('moveToDeadLetter failed', cause, eventId);
    }
  }

  /** 兜底建表 — DatabaseManager 启动时已创建 upload_queue */
  private ensureUploadQueueTable(): void {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS upload_queue (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          payload TEXT NOT NULL,
          retry_count INTEGER DEFAULT 0,
          next_retry_at INTEGER NOT NULL,
          created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
        );
        CREATE INDEX IF NOT EXISTS idx_next_retry ON upload_queue(next_retry_at);
      `);
    } catch (cause) {
      this.recordError('ensureUploadQueueTable failed', cause, null);
    }
  }

  private deleteRowById(rowId: number): void {
    try {
      this.db.prepare('DELETE FROM upload_queue WHERE id = ?').run(rowId);
    } catch (cause) {
      this.recordError('deleteRowById failed', cause, null);
    }
  }

  private recordError(message: string, cause: unknown, eventId: string | null): void {
    const detail =
      cause instanceof Error
        ? cause.stack ?? cause.message
        : String(cause);
    const fullMessage = `[RetryQueue] ${message}${eventId !== null ? ` eventId=${eventId}` : ''}\n${detail}`;

    if (this.logger !== null) {
      void Promise.resolve(
        this.logger.logAlert({
          alertId: `retry-queue-${String(Date.now())}`,
          timestamp: Date.now(),
          severity: 'CRITICAL',
          scenario: 'cloud_retry_queue_fault',
          message: fullMessage,
          score: 1,
        }),
      ).catch(() => {
        console.error(fullMessage);
      });
      return;
    }

    console.error(fullMessage);
  }
}
