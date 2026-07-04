/**
 * L0 规则引擎检测事件类型定义
 * 适配文档：task_l0_engine.md (§3.5) + agentwatch_v0_mvp_tasklist.md
 * 嵌套路径与 packages/shared/types/rule.types.ts 中 FieldSource 严格对齐
 */
/** tool.* — FieldSource: tool.name | tool.version | tool.source */
export interface DetectionEventTool {
  name: string;
  version?: string;
  source?: string;
}
/** argument.* — FieldSource: argument.name | argument.value | argument.type */
export interface DetectionEventArgument {
  name: string;
  value: unknown;
  type?: string;
}
/** request.* — FieldSource: request.origin | request.user_id | request.session_id | request.timestamp */
export interface DetectionEventRequest {
  origin?: string;
  user_id?: string;
  session_id?: string;
  timestamp: number;
}
/** context.* — FieldSource: context.agent_id | context.skill_id | context.chain_depth */
export interface DetectionEventContext {
  agent_id?: string;
  skill_id?: string;
  chain_depth?: number;
}
/** metadata.* — FieldSource: metadata.frequency_1m | metadata.frequency_5m | metadata.consecutive_failures | metadata.duration_ms */
export interface DetectionEventMetadata {
  frequency_1m?: number;
  frequency_5m?: number;
  consecutive_failures?: number;
  /** 上一笔 tools/call 服务端耗时 (ms) — L1 timing_anomaly 维度 */
  duration_ms?: number;
}
/**
 * L0 规则引擎检测事件
 * getFieldValue(event, field) 按 FieldSource 点路径取值，如 'argument.value' → event.argument.value
 */
export interface DetectionEvent {
  tool: DetectionEventTool;
  /** 主匹配参数 — L0 getFieldValue('argument.*') 入口 */
  argument: DetectionEventArgument;
  /** tools/call arguments 拆分后的全量键值对 */
  arguments?: DetectionEventArgument[];
  request: DetectionEventRequest;
  context?: DetectionEventContext;
  metadata?: DetectionEventMetadata;
}
