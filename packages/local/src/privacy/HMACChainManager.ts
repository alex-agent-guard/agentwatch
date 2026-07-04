/**
 * HMACChain 全局单例 — 对齐 bootstrap DatabaseManager 初始化模式
 * AL-005 链式签名在 AsyncLogger 写入前统一取实例
 */
import type Database from 'better-sqlite3';

import type { BehaviorLogEntry } from '@packages/shared/types';

import { HMACChain, type HmacChainErrorHandler, type HMACChainOptions } from './HMACChain.js';
import { HmacChainSigner } from './HmacChainSigner.js';

/** HMAC 链全局管理器 — bootstrap 初始化，AsyncLogger 读取 */
export class HMACChainManager {
  private static chain: HMACChain | null = null;
  private static signer: HmacChainSigner | null = null;

  /**
   * 从 SQLite 恢复链头并注册全局实例 — bootstrap 在 DatabaseManager 之后调用
   * @param db better-sqlite3 连接
   * @param onError 密钥/文件异常回调（写入 AsyncLogger 告警）
   */
  static initializeFromDatabase(
    db: Database.Database,
    onError?: HmacChainErrorHandler,
  ): HMACChain {
    const signer = HmacChainSigner.loadFromDatabase(db, onError);
    HMACChainManager.signer = signer;
    HMACChainManager.chain = signer.getChain();
    return HMACChainManager.chain;
  }

  /** 独立初始化（测试 / 无 DB 场景） */
  static initialize(options?: HMACChainOptions): HMACChain {
    HMACChainManager.chain = new HMACChain(options);
    HMACChainManager.signer = null;
    return HMACChainManager.chain;
  }

  /** 获取全局实例 — 未初始化时 lazy 创建内存链 */
  static getInstance(): HMACChain {
    if (HMACChainManager.chain === null) {
      HMACChainManager.chain = new HMACChain();
    }
    return HMACChainManager.chain;
  }

  /** 仅返回已初始化实例 — AsyncLogger 生产路径 */
  static tryGetInstance(): HMACChain | null {
    return HMACChainManager.chain;
  }

  /** 持久化签名链节至 hmac_chain 表 */
  static persistSignedEntry(db: Database.Database, entry: BehaviorLogEntry): void {
    if (HMACChainManager.signer === null) {
      return;
    }
    try {
      HMACChainManager.signer.persistLink(db, entry);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      console.error(`[HMACChainManager] persistSignedEntry failed: ${message}`);
    }
  }

  /** 进程退出 / 测试 teardown 重置单例 */
  static reset(): void {
    HMACChainManager.chain = null;
    HMACChainManager.signer = null;
  }
}
