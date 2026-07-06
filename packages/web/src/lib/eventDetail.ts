import type { AgentWatchEvent, FinalDecision } from '@/types/events';
import { displayClient } from '@/lib/clientDisplay';
import { displayService } from '@/lib/serviceDisplay';

export const DECISION_LABEL_ZH: Record<FinalDecision, string> = {
  ALLOW: '放行',
  WARN: '警告',
  BLOCK: '已拦截',
};

const AMOUNT_BUCKET_ZH: Record<string, string> = {
  lt_100: '小于 100',
  lt_10k: '1 万以下',
  lt_1m: '100 万以下',
  gte_1m: '100 万及以上',
};

const SEVERITY_ZH: Record<string, string> = {
  CRITICAL: '严重',
  HIGH: '高',
  MEDIUM: '中',
  LOW: '低',
};

export function severityLabel(severity: string): string {
  return SEVERITY_ZH[severity] ?? severity;
}

export function formatAmountBucket(bucket: string | null | undefined): string | null {
  if (!bucket) return null;
  return AMOUNT_BUCKET_ZH[bucket] ?? bucket;
}

/** 一句话说明「发生了什么」 */
export function summarizeWhatHappened(event: AgentWatchEvent): string {
  const client = displayClient(event.client_name);
  const service = displayService(event.service_name);
  const clientPart = client.hasBackendSource ? `在 ${client.label} 中` : '';
  const servicePart = service.hasBackendSource ? `经 ${service.label}` : '经 MCP 代理';
  const decision = DECISION_LABEL_ZH[event.final_decision];

  return `Agent ${clientPart}${servicePart} 调用了工具「${event.tool_name}」，系统判定为${decision}。`;
}

/** 工具链上下文（不含敏感参数） */
export function chainContextText(event: AgentWatchEvent): string | null {
  if (event.chain_depth <= 1 && !event.previous_tool) return null;

  const depth = event.chain_depth;
  if (event.previous_tool) {
    return `本事件处于工具链第 ${String(depth)} 步，上一步调用了「${event.previous_tool}」。`;
  }
  return `本事件处于工具链第 ${String(depth)} 步。`;
}

/** 调用特征 — 仅类型/桶，不展示原始参数 */
export function formatArgSignals(event: AgentWatchEvent): string[] {
  const lines: string[] = [];

  if (event.arg_count > 0) {
    lines.push(`参数 ${String(event.arg_count)} 个`);
  }

  if (event.arg_value_types.length > 0) {
    lines.push(`类型：${event.arg_value_types.join('、')}`);
  }

  if (event.has_address) {
    lines.push('含链上地址字段');
  }

  if (event.has_amount) {
    const bucket = formatAmountBucket(event.amount_bucket);
    lines.push(bucket ? `含金额字段（区间：${bucket}）` : '含金额字段');
  }

  return lines;
}

export function l1ScoreHint(score: number, decision: FinalDecision): string | null {
  if (decision === 'ALLOW') return null;
  const pct = Math.round(score * 100);
  if (pct >= 85) return `统计风险分 ${String(pct)}，接近拦截阈值。`;
  if (pct >= 60) return `统计风险分 ${String(pct)}，行为相对基线偏高。`;
  return null;
}
