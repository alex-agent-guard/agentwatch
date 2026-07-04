/**
 * AL-005 HMAC 链式签名 — BehaviorLogEntry 适配层 + SQLite hmac_chain 持久化
 * 核心算法委托 privacy/HMACChain.ts
 */
import { createHash } from 'node:crypto';

import type Database from 'better-sqlite3';

import { HMACChain, type HmacChainErrorHandler, type HMACChainOptions } from './HMACChain.js';

import type { BehaviorLogEntry } from '@packages/shared/types';

const GENESIS_HMAC = '0'.repeat(64);

export interface HmacVerifyResult {
  valid: boolean;
  tamperedIndex?: number;
}

/** BehaviorLogEntry ↔ HMACChain 桥接 + SQLite 链节落盘 */
export class HmacChainSigner {
  private readonly chain: HMACChain;

  constructor(chain: HMACChain) {
    this.chain = chain;
  }

  /**
   * 从 SQLite 恢复链头并构造签名器
   * @param db DatabaseManager.getDb()
   * @param onError 文件/密钥异常写入 AsyncLogger
   */
  static loadFromDatabase(
    db: Database.Database,
    onError?: HmacChainErrorHandler,
  ): HmacChainSigner {
    const row = db
      .prepare('SELECT hmac FROM hmac_chain ORDER BY id DESC LIMIT 1')
      .get() as { hmac: string } | undefined;

    const chainOptions: HMACChainOptions = {
      initialLastHmac: row?.hmac ?? GENESIS_HMAC,
    };
    if (onError !== undefined) {
      chainOptions.onError = onError;
    }
    const chain = new HMACChain(chainOptions);
    return new HmacChainSigner(chain);
  }

  /** 为日志条目生成链式 HMAC 并更新内存链头 */
  signEntry(entry: BehaviorLogEntry): BehaviorLogEntry {
    const prev_hmac = this.chain.getLastHmac();
    const hmac = this.chain.sign({
      ts: entry.ts,
      sid: entry.sid,
      seq: entry.sequence_no ?? 0,
      tool: entry.tool,
      dec: entry.dec,
    });
    return { ...entry, hmac, prev_hmac };
  }

  /** 持久化 HMAC 链节至 hmac_chain 表 */
  persistLink(db: Database.Database, entry: BehaviorLogEntry): void {
    const hmac = entry.hmac ?? entry._meta?.hmac;
    if (hmac === undefined) {
      return;
    }

    const prevHmac = entry.prev_hmac ?? entry._meta?.prev_hmac ?? GENESIS_HMAC;

    try {
      const logHash = this.hashLogEntry(entry);
      db.prepare(
        `INSERT INTO hmac_chain (log_hash, prev_hash, hmac, created_at)
         VALUES (?, ?, ?, ?)`,
      ).run(logHash, prevHmac, hmac, entry.ts);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      console.error(`[HmacChainSigner] persistLink failed: ${message}`);
    }
  }

  /** 验证日志链完整性 — 篡改可定位条目索引 */
  verifyChain(entries: BehaviorLogEntry[]): HmacVerifyResult {
    const signed = entries
      .filter((entry) => entry.hmac !== undefined)
      .map((entry) => ({
        ts: entry.ts,
        sid: entry.sid,
        seq: entry.sequence_no ?? 0,
        tool: entry.tool,
        dec: entry.dec,
        hmac: entry.hmac as string,
      }));

    return this.chain.verifyChain(signed);
  }

  getLastHash(): string {
    return this.chain.getLastHmac();
  }

  /** 暴露底层 HMACChain — 单元测试 / 直接 sign 场景 */
  getChain(): HMACChain {
    return this.chain;
  }

  private hashLogEntry(entry: BehaviorLogEntry): string {
    const { hmac: _hmac, prev_hmac: _prev, ...rest } = entry;
    return createHash('sha256').update(JSON.stringify(rest)).digest('hex');
  }
}
