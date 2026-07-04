/**
 * BaselineStorage — 行为基线 SQLite 持久化
 * 复用 DatabaseManager 全局单例；DB 异常写入 AsyncLogger，不中断主流程
 */
import { DatabaseManager } from '../storage/DatabaseManager.js';

import type { ILogger } from '@packages/shared/types';

interface BaselineRecord {
  user_id: string;
  agent_id: string;
  data: string;
  updated_at: number;
}

type BaselineStorageLogger = Pick<ILogger, 'logAlert'>;

export interface BaselineStorageOptions {
  /** 结构化错误日志输出 — bootstrap 注入 AsyncLogger */
  logger?: BaselineStorageLogger | null;
}

export class BaselineStorage {
  private static sharedLogger: BaselineStorageLogger | null = null;

  private readonly db = DatabaseManager.getInstance().getDb();
  private readonly logger: BaselineStorageLogger | null;

  constructor(options?: BaselineStorageOptions) {
    this.logger = options?.logger ?? BaselineStorage.sharedLogger;
  }

  /** bootstrap 全局注入 AsyncLogger */
  static setLogger(logger: BaselineStorageLogger | null): void {
    BaselineStorage.sharedLogger = logger;
  }

  save(userId: string, agentId: string, data: object): void {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO baselines (user_id, agent_id, data, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, agent_id) DO UPDATE SET
          data = excluded.data,
          updated_at = excluded.updated_at
      `);
      stmt.run(userId, agentId, JSON.stringify(data), Date.now());
    } catch (cause) {
      this.recordError('save failed', cause, userId, agentId);
    }
  }

  load(userId: string, agentId: string): object | null {
    try {
      const stmt = this.db.prepare(
        'SELECT data FROM baselines WHERE user_id = ? AND agent_id = ?',
      );
      const row = stmt.get(userId, agentId) as Pick<BaselineRecord, 'data'> | undefined;
      if (row === undefined) {
        return null;
      }
      return JSON.parse(row.data) as object;
    } catch (cause) {
      this.recordError('load failed', cause, userId, agentId);
      return null;
    }
  }

  private recordError(
    operation: string,
    cause: unknown,
    userId: string,
    agentId: string,
  ): void {
    const detail =
      cause instanceof Error
        ? cause.stack ?? cause.message
        : String(cause);
    const message = `[BaselineStorage] ${operation} userId=${userId} agentId=${agentId}\n${detail}`;

    if (this.logger !== null) {
      void Promise.resolve(
        this.logger.logAlert({
          alertId: `baseline-${userId}-${agentId}-${String(Date.now())}`,
          timestamp: Date.now(),
          severity: 'CRITICAL',
          scenario: 'baseline_storage_fault',
          message,
          score: 1,
        }),
      ).catch(() => {
        console.error(message);
      });
      return;
    }

    console.error(message);
  }
}
