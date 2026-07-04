/**
 * 异步日志类型定义
 * 适配文档：task_router_logger_structure.md (L4350-L4392, L5049-L5062)
 *          agentwatch_v0_mvp_tasklist.md (AL-001~AL-008)
 */
import type { MaskLevel } from './config.types.js';
import type { RuleAction } from './rule.types.js';
import type { TriggeredRule } from './proxy.types.js';

/** 参数脱敏输出 — DataMasker.maskParams() AL-004 */
export interface MaskedParams {
  maskedValues: Record<string, unknown>;
  typeSignatures: Record<string, string>;
  hashes: Record<string, string>;
}

/** 行为日志元数据 — 文档 7.1.1 _meta */
export interface BehaviorLogMeta {
  /** 日志格式版本 */
  v: string;
  /** HMAC 链式签名 — AL-005 */
  hmac?: string;
  /** 前一条日志 HMAC — 链式校验 */
  prev_hmac?: string;
  /** 日志来源 — middleware / cloud */
  src?: string;
}

/** 行为日志条目 Schema — AL-001 / L4350-L4392 / 文档 7.1.1 */
export interface BehaviorLogEntry {
  eventId: string;
  ts: number;
  /** 会话 ID — LogFilter.sid */
  sid: string;
  /** 工具调用追踪 ID — LogFilter.tid */
  tid: string;
  uid?: string;
  agentId?: string;
  /** 工具名 — LogFilter.tool */
  tool: string;
  /** 决策 — LogFilter.dec */
  dec: RuleAction;
  score: number;
  /** 检测耗时 (ms) — AL-008 dur_ms */
  dur_ms: number;
  /** 会话内递增序号 — MPC-11 */
  sequence_no?: number;
  params?: Record<string, unknown>;
  /** 命中规则 — AL-008 l0_rules */
  l0_rules?: TriggeredRule[];
  /** L1 各算法得分 — AL-008 l1_scores */
  l1_scores?: Record<string, number>;
  /** 元数据 — 文档 7.1.1 _meta（含 hmac 链式签名校验） */
  _meta?: BehaviorLogMeta;
  /** @deprecated 使用 _meta.hmac — 保留类型兼容 */
  hmac?: string;
  /** @deprecated 使用 _meta.prev_hmac — 保留类型兼容 */
  prev_hmac?: string;
  /** 脱敏级别标记 */
  maskLevel?: MaskLevel;
  /** 落盘 tier — 单文件 log.jsonl 模式下区分 block/warn/access 等 */
  tier?: string;
}

/** 告警记录 — ILogger.logAlert() */
export interface AlertRecord {
  alertId: string;
  timestamp: number;
  severity: string;
  scenario: string;
  message: string;
  score: number;
  /** FalsePositiveController 反馈 — DR-004 */
  wasFalsePositive?: boolean;
}

/** 日志查询过滤 — ILogger.queryLogs() AL-006 */
export interface LogFilter {
  startTime?: number;
  endTime?: number;
  sid?: string;
  tid?: string;
  tool?: string;
  dec?: RuleAction;
  limit?: number;
  offset?: number;
}
