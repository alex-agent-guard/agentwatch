/**
 * MCP Proxy Core 类型定义
 * 适配文档：task_proxy_config.md (§3.1 MPC-01/02, L341-L407, L559-L587)
 * ProxySession 见 session.types.ts（避免 proxy ↔ api 循环依赖）
 */
import type { DetectionEvent } from './event.types.js';
import type { RuleAction, RuleSeverity } from './rule.types.js';

// ─── JSON-RPC 2.0（MCP 消息协议）──────────────────────────────
/** MCP JSON-RPC 2.0 请求 — MPC-01 L390-L395 */
export interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

/** buildBlockResponse() / 流故障 error.data 结构 — MPC-06 / proxy stream fault */
export interface JSONRPCErrorData {
  reason?: string;
  /** 流故障详情 — stream_error 响应专用 */
  detail?: string;
  triggeredRules?: TriggeredRule[];
  score?: number;
  timestamp?: number;
  helpUrl?: string;
}

/** JSON-RPC 错误体 */
export interface JSONRPCError {
  code: number;
  message: string;
  data?: JSONRPCErrorData;
}

/** MCP JSON-RPC 2.0 响应 — MPC-01 L397-L406 */
export interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: JSONRPCError;
}

// ─── 工具调用事件（L1 扁平输入）──────────────────────────────
/**
 * L1 / IDetectionEngine 扁平工具调用事件
 * 文档：task_router_logger_structure.md L413, agentwatch_v0_mvp_tasklist.md L511
 */
export interface ToolCallEvent {
  toolName: string;
  timestamp: number;
  chainDepth: number;
  argumentCount: number;
  arguments: Record<string, unknown>;
  userId?: string;
  sessionId?: string;
  agentId?: string;
}

/**
 * ToolCallEvent 扁平字段 → DetectionEvent 嵌套路径映射契约
 * 实现层 convertToolCallToDetectionEvent() 须遵循此映射
 */
export type ToolCallToDetectionEventFieldMapping = {
  toolName: 'tool.name';
  timestamp: 'request.timestamp';
  chainDepth: 'context.chain_depth';
  argumentCount: 'metadata.arg_count';
  arguments: 'argument.value';
  userId: 'request.user_id';
  sessionId: 'request.session_id';
  agentId: 'context.agent_id';
};

/** ToolCallEvent 与 DetectionEvent 配对 — 映射函数 I/O 契约 */
export interface ToolCallDetectionEventPair {
  toolCall: ToolCallEvent;
  detection: DetectionEvent;
}

// ─── 检测结果（MPC-02）──────────────────────────────────────
/** 触发规则详情 — MPC-02 L568-L573 */
export interface TriggeredRule {
  ruleId: string;
  ruleName: string;
  severity: RuleSeverity;
  matchedValue: unknown;
}

/** 统计异常详情 — MPC-02 L575-L581 */
export interface StatAnomaly {
  metricName: string;
  metricType: string;
  observedValue: number;
  expectedValue: number;
  deviation: number;
}

/** 安全审计标记 — MPC-02 L583-L587 / MPC-07 */
export interface SecurityMarker {
  type: string;
  message: string;
  code: string;
}

/** 综合检测结果 — MPC-02 L559-L566 / MPC-05 */
export interface DetectionResult {
  decision: RuleAction;
  score: number;
  triggeredRules: TriggeredRule[];
  statAnomalies: StatAnomaly[];
  markers?: SecurityMarker[];
  blockReason?: string;
}
