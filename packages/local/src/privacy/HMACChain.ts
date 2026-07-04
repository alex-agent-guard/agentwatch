/**
 * AL-005 HMAC 链式签名校验 — SHA256-HMAC 链，上一条哈希作为下一条 prev_hash
 * 密钥：~/.agentwatch/.hmac_key（0o600）| 持久化表：hmac_chain（DatabaseManager）
 */
import {
  createHmac,
  randomBytes,
  type BinaryLike,
} from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** 链式签名输入 — sign() / verifyChain() 公共字段 */
export interface HmacChainEntry {
  ts: number;
  sid: string;
  seq: number;
  tool: string;
  dec: string;
}

/** verifyChain() 入参 — 含已签名 hmac 字段 */
export interface HmacChainSignedEntry extends HmacChainEntry {
  hmac: string;
}

/** verifyChain() 返回值 — valid=false 时携带首个篡改条目下标 */
export interface HmacChainVerifyResult {
  valid: boolean;
  tamperedIndex?: number;
}

/** 文件/密钥异常回调 — 由 AsyncLogger 注入，禁止未捕获异常冒泡 */
export type HmacChainErrorHandler = (
  message: string,
  cause?: unknown,
) => void;

export interface HMACChainOptions {
  /** 链头初始 prev_hash — 默认 64 位零 genesis */
  initialLastHmac?: string;
  /** 密钥文件路径 — 默认 ~/.agentwatch/.hmac_key */
  keyPath?: string;
  /** 文件操作失败时的结构化日志回调 */
  onError?: HmacChainErrorHandler;
}

const GENESIS_HMAC = '0'.repeat(64);
const DEFAULT_KEY_RELATIVE = join('.agentwatch', '.hmac_key');

/**
 * HMAC 链式签名器
 * - sign：将 lastHmac 作为 prev_hash 写入 payload，返回 hex digest 并推进链头
 * - verifyChain：从 genesis 起逐条复算，定位首个篡改下标
 */
export class HMACChain {
  private secretKey: Buffer;
  private lastHmac: string;
  private readonly dbTable = 'hmac_chain';
  private readonly keyPath: string;
  private readonly onError: HmacChainErrorHandler | undefined;

  /**
   * @param options.initialLastHmac SQLite 恢复链头；缺省为 genesis
   * @param options.keyPath 测试隔离用自定义密钥路径
   * @param options.onError 文件 IO 失败时写入 AsyncLogger，不抛出至主进程
   */
  constructor(options?: HMACChainOptions) {
    this.keyPath = options?.keyPath ?? join(homedir(), DEFAULT_KEY_RELATIVE);
    this.onError = options?.onError;
    this.lastHmac = options?.initialLastHmac ?? GENESIS_HMAC;
    this.secretKey = this.loadOrCreateKey();
    void this.dbTable;
  }

  /**
   * 对单条日志字段做链式 HMAC 签名
   * @param entry 日志核心维度（ts/sid/seq/tool/dec）
   * @returns 当前条目的 hex HMAC，同时更新内部 lastHmac
   */
  sign(entry: HmacChainEntry): string {
    const data = JSON.stringify({
      ts: entry.ts,
      sid: entry.sid,
      seq: entry.seq,
      tool: entry.tool,
      dec: entry.dec,
      prev_hash: this.lastHmac,
    });

    const hmac = createHmac('sha256', this.secretKey as BinaryLike)
      .update(data)
      .digest('hex');

    this.lastHmac = hmac;
    return hmac;
  }

  /**
   * 验证整条 HMAC 链完整性
   * @param entries 按时间顺序排列的已签名日志数组
   * @returns valid=true 全链通过；否则返回首个 tamperedIndex
   */
  verifyChain(entries: HmacChainSignedEntry[]): HmacChainVerifyResult {
    let prevHash = GENESIS_HMAC;

    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (entry === undefined) {
        continue;
      }

      const data = JSON.stringify({
        ts: entry.ts,
        sid: entry.sid,
        seq: entry.seq,
        tool: entry.tool,
        dec: entry.dec,
        prev_hash: prevHash,
      });

      const expected = createHmac('sha256', this.secretKey as BinaryLike)
        .update(data)
        .digest('hex');

      if (entry.hmac !== expected) {
        return { valid: false, tamperedIndex: index };
      }

      prevHash = entry.hmac;
    }

    return { valid: true };
  }

  /** 读取当前链头 HMAC — SQLite 恢复 / AsyncLogger prev_hmac 字段 */
  getLastHmac(): string {
    return this.lastHmac;
  }

  /** 从 SQLite 最后一节恢复链头 — HmacChainSigner.loadFromDatabase 调用 */
  restoreLastHmac(hmac: string): void {
    this.lastHmac = hmac;
  }

  /** 密钥文件绝对路径 — 单元测试断言用 */
  getKeyPath(): string {
    return this.keyPath;
  }

  /**
   * 加载或创建 32 字节二进制密钥
   * 路径固定 ~/.agentwatch/.hmac_key，权限 0o600
   * 失败时回调 onError 并回退内存随机密钥，不抛出
   */
  private loadOrCreateKey(): Buffer {
    try {
      const keyDir = join(this.keyPath, '..');
      if (!existsSync(keyDir)) {
        mkdirSync(keyDir, { recursive: true });
      }

      if (existsSync(this.keyPath)) {
        const key = readFileSync(this.keyPath);
        if (key.length >= 32) {
          return key.subarray(0, 32);
        }
        this.reportError(
          `HMAC key file invalid length=${String(key.length)} path=${this.keyPath}`,
        );
      }

      const key = randomBytes(32);
      writeFileSync(this.keyPath, key, { mode: 0o600 });
      return key;
    } catch (cause) {
      this.reportError('Failed to load or create HMAC key file', cause);
      return randomBytes(32);
    }
  }

  private reportError(message: string, cause?: unknown): void {
    if (this.onError !== undefined) {
      this.onError(message, cause);
      return;
    }
    const detail = cause instanceof Error ? cause.message : String(cause ?? '');
    console.error(`[HMACChain] ${message}${detail.length > 0 ? `: ${detail}` : ''}`);
  }
}

/** 断言密钥文件权限为 0o600 — Vitest 专用 */
export function assertHmacKeyPermissions(keyPath: string): boolean {
  try {
    const stat = statSync(keyPath);
    return (stat.mode & 0o777) === 0o600;
  } catch {
    return false;
  }
}

/** 强制修正密钥文件权限为 0o600 — 读取已存在密钥后调用 */
export function ensureHmacKeyPermissions(keyPath: string): void {
  try {
    if (existsSync(keyPath)) {
      chmodSync(keyPath, 0o600);
    }
  } catch {
    // 权限修正失败不阻塞签名流程
  }
}
