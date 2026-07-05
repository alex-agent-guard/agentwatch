/**
 * CloudClient — 云端批量事件上报 HTTP 客户端
 * 纯 POST /v1/events/batch 逻辑；入参须已由 DataMasker 脱敏 + HMACChain 签名
 */
import { RiskType } from '@packages/shared/constants';

import type { ILogger } from '@packages/shared/types';

import {
  isSupabaseEndpoint,
  uploadBatchToSupabase,
} from './supabaseCloudTransport.js';

/**
 * 云端上报单条事件载荷 — POST /v1/events/batch body.events[]
 * 所有敏感字段须提前脱敏；hmac 由 HMACChain 在入队前写入
 */
export interface CloudEventPayload {
  /** 事件唯一 ID — 对应 BehaviorLogEntry.eventId */
  eventId: string;
  /** MCP 会话 ID */
  sessionId: string;
  /** 事件时间戳 (ms) */
  timestamp: number;
  /** Agent 实例标识 */
  agentId: string;
  /** 用户标识 */
  userId: string;
  /** 工具调用摘要 — 仅含脱敏后的哈希/类型信息 */
  toolCall: {
    /** 工具名 */
    toolName: string;
    /** MCP 服务名 / method 命名空间 */
    serviceName: string;
    /** 检测链路耗时 (ms) */
    durationMs: number;
    /** 参数键数量 */
    argCount: number;
    /** 参数键 SHA256 前缀哈希列表 */
    argKeyHashes: string[];
    /** 参数值类型签名列表 — DataMasker TYPE 级输出 */
    argValueTypes: string[];
    /** 是否包含区块链地址形态参数 */
    hasAddress: boolean;
    /** 是否包含金额类参数 */
    hasAmount: boolean;
    /** 金额分桶 — 脱敏后区间标签 */
    amountBucket?: string;
  };
  /** L0/L1 检测结果摘要 */
  detection: {
    /** L0 命中规则列表 */
    l0TriggeredRules: Array<{ ruleId: string; severity: string }>;
    /** L1 融合综合分 */
    l1CombinedScore: number;
    /** 最终决策 — 仅 BLOCK/WARN 应进入上报队列 */
    finalDecision: 'ALLOW' | 'BLOCK' | 'WARN';
  };
  /** 工具链上下文 */
  context: {
    /** 当前调用链深度 */
    chainDepth: number;
    /** 上一工具名 — 可选 */
    previousTool?: string;
  };
  /** HMAC 链式签名 — 来自 BehaviorLogEntry._meta.hmac */
  hmac: string;
}

/** 云端 batch 接口成功响应体 */
export interface CloudBatchUploadResult {
  batchId: string;
  accepted: number;
  rejected: number;
  errors: Array<{ index: number; code: string }>;
}

export interface CloudClientConfig {
  /** API 基址 — Supabase 项目 URL 或 legacy REST 基址 */
  endpoint: string;
  /** Edge Function 网关 anon key 或 legacy Bearer token */
  apiKey: string;
  /** Supabase 上报 upload_secret — 必填（Supabase endpoint 时） */
  uploadSecret?: string;
}

type CloudClientLogger = Pick<ILogger, 'logAlert'>;

export interface CloudClientOptions {
  /** 请求超时 (ms) — 默认 5000 */
  timeoutMs?: number;
  /** 测试注入 fetch 实现 */
  fetchImpl?: typeof fetch;
  /** 结构化错误写入 AsyncLogger */
  logger?: CloudClientLogger | null;
}

export class CloudClient {
  private endpoint: string;
  private apiKey: string;
  private uploadSecret: string;
  private timeoutMs = 5000;
  private readonly fetchImpl: typeof fetch;
  private readonly logger: CloudClientLogger | null;

  constructor(config: CloudClientConfig, options?: CloudClientOptions) {
    this.endpoint = config.endpoint.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.uploadSecret = config.uploadSecret ?? '';
    if (options?.timeoutMs !== undefined) {
      this.timeoutMs = options.timeoutMs;
    }
    this.fetchImpl = options?.fetchImpl ?? fetch;
    this.logger = options?.logger ?? null;
  }

  /**
   * 批量上传事件 — 失败时记录 AsyncLogger 告警并返回 null，不向外抛错
   */
  async uploadBatch(events: CloudEventPayload[]): Promise<CloudBatchUploadResult | null> {
    if (events.length === 0) {
      return { batchId: 'empty', accepted: 0, rejected: 0, errors: [] };
    }

    try {
      if (isSupabaseEndpoint(this.endpoint)) {
        return await uploadBatchToSupabase(events, {
          endpoint: this.endpoint,
          apiKey: this.apiKey,
          uploadSecret: this.uploadSecret,
          timeoutMs: this.timeoutMs,
          fetchImpl: this.fetchImpl,
        });
      }

      return await this.uploadBatchLegacy(events);
    } catch (cause) {
      this.recordUploadError(cause, events[0]?.eventId);
      return null;
    }
  }

  /** 原有 POST /v1/events/batch 协议 — 非 Supabase endpoint 时使用 */
  private async uploadBatchLegacy(events: CloudEventPayload[]): Promise<CloudBatchUploadResult | null> {
    try {
      const res = await this.fetchImpl(`${this.endpoint}/v1/events/batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          batchId: this.generateId(),
          events,
          sentAt: Date.now(),
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!res.ok) {
        throw this.createStructuredError(
          `HTTP ${String(res.status)}`,
          events[0]?.eventId ?? null,
          new Error(await res.text()),
        );
      }

      let payload: unknown;
      try {
        payload = await res.json();
      } catch (cause) {
        throw this.createStructuredError(
          'Cloud batch response JSON parse failed',
          events[0]?.eventId ?? null,
          cause,
        );
      }

      return payload as CloudBatchUploadResult;
    } catch (cause) {
      this.recordUploadError(cause, events[0]?.eventId);
      return null;
    }
  }

  private generateId(): string {
    return `${String(Date.now())}-${Math.random().toString(36).slice(2)}`;
  }

  private recordUploadError(cause: unknown, eventId?: string): void {
    const structured =
      cause instanceof Error && 'riskType' in cause
        ? (cause as Error & { riskType: string; originalStack?: string })
        : this.createStructuredError(
            'Cloud upload batch failed',
            eventId ?? null,
            cause,
          );

    const message =
      structured instanceof Error
        ? structured.stack ?? structured.message
        : String(cause);

    if (this.logger !== null) {
      void Promise.resolve(
        this.logger.logAlert({
          alertId: `cloud-upload-${String(Date.now())}`,
          timestamp: Date.now(),
          severity: 'CRITICAL',
          scenario: 'cloud_upload_fault',
          message,
          score: 1,
        }),
      ).catch(() => {
        console.error(`[CloudClient] ${message}`);
      });
      return;
    }

    console.error(`[CloudClient] ${message}`);
  }

  private createStructuredError(
    message: string,
    eventId: string | null,
    cause: unknown,
  ): Error {
    const base =
      cause instanceof Error
        ? cause
        : new Error(typeof cause === 'string' ? cause : JSON.stringify(cause));

    const err = new Error(message, { cause: base });
    Object.assign(err, {
      eventId,
      riskType: RiskType.CLOUD_CLIENT_UPLOAD_FAILED,
      originalStack: base.stack ?? String(cause),
    });
    return err;
  }
}

/** 规范化 CloudConfig.endpoint — 去除重复 /v1 后缀 */
export function normalizeCloudEndpoint(endpoint: string): string {
  return endpoint.replace(/\/$/, '').replace(/\/v1$/, '');
}
