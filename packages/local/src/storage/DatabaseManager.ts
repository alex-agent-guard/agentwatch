import Database from 'better-sqlite3';
import { chmodSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export class DatabaseManager {
  private static instance: DatabaseManager;
  private readonly dbPath: string;
  private db: Database.Database;

  private constructor() {
    const dbDir = join(homedir(), '.agentwatch');
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }
    this.dbPath = join(dbDir, 'agentwatch.db');
    this.db = new Database(this.dbPath);
    this.initTables();
    this.hardenDbFilePermissions();
  }

  static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager();
    }
    return DatabaseManager.instance;
  }

  getDb(): Database.Database {
    return this.db;
  }

  /** SQLite 数据库文件绝对路径 — 单元测试权限断言用 */
  getDbPath(): string {
    return this.dbPath;
  }

  close(): void {
    this.db.close();
    DatabaseManager.instance = undefined as unknown as DatabaseManager;
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS baselines (
        user_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        data TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, agent_id)
      );

      CREATE TABLE IF NOT EXISTS upload_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payload TEXT NOT NULL,
        retry_count INTEGER DEFAULT 0,
        next_retry_at INTEGER NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_next_retry ON upload_queue(next_retry_at);

      CREATE TABLE IF NOT EXISTS hmac_chain (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        log_hash TEXT NOT NULL,
        prev_hash TEXT NOT NULL,
        hmac TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS perm_probe_tracker (
        tool_name TEXT NOT NULL,
        user_id TEXT NOT NULL,
        consecutive_failures INTEGER DEFAULT 0,
        last_failure_at INTEGER,
        PRIMARY KEY (tool_name, user_id)
      );
    `);
  }

  private hardenDbFilePermissions(): void {
    try {
      if (existsSync(this.dbPath)) {
        chmodSync(this.dbPath, 0o600);
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      console.error(`[DatabaseManager] failed to chmod agentwatch.db: ${message}`);
    }
  }
}

/** 断言 agentwatch.db 权限为 0o600 — 单元测试用 */
export function assertAgentWatchDbPermissions(dbPath: string): boolean {
  try {
    const stat = statSync(dbPath);
    return (stat.mode & 0o777) === 0o600;
  } catch {
    return false;
  }
}
