import type { AgentWatchEvent } from '@/types/events';
import { shouldShowL1Anomaly } from '@/lib/riskCopy';

export type HmacIntegrityStatus = 'verified' | 'warning' | 'broken';

export type TimelineGapReason = 'allow_missing' | 'hmac_mismatch' | 'sequence_gap';

export interface TimelineGap {
  afterIndex: number;
  reason: TimelineGapReason;
}

export const CHAIN_GAP_COLOR = '#8B5CF6';

export function shortHmac(hmac: string, length = 8): string {
  const trimmed = hmac.trim();
  if (trimmed.length <= length) return trimmed;
  return trimmed.slice(0, length);
}

export function isGrayRhinoEvent(event: AgentWatchEvent): boolean {
  const ruleIds = event.l0_triggered_rules.map((r) => r.ruleId);
  return shouldShowL1Anomaly(ruleIds, event.l1_combined_score, event.final_decision);
}

export function computeHmacIntegrity(
  event: AgentWatchEvent,
  sessionRows: AgentWatchEvent[],
): { status: HmacIntegrityStatus; detail: string } {
  if (!event.hmac?.trim()) {
    return { status: 'broken', detail: '缺少 HMAC 签名' };
  }

  const sorted = [...sessionRows].sort((a, b) => a.timestamp_ms - b.timestamp_ms);
  const idx = sorted.findIndex((row) => row.event_id === event.event_id);

  if (idx <= 0) {
    if (event.prev_hmac?.trim()) {
      return {
        status: 'warning',
        detail: '前序事件不在当前列表中（可能为正常放行或未加载）',
      };
    }
    return { status: 'verified', detail: '本会话可见范围内的链首记录' };
  }

  const prev = sorted[idx - 1];
  if (!event.prev_hmac?.trim()) {
    return { status: 'warning', detail: '缺少前序 HMAC，链可能不完整' };
  }

  if (event.prev_hmac.trim() !== prev.hmac.trim()) {
    return {
      status: 'broken',
      detail: `与前一条记录的 HMAC 不一致（前一条=${shortHmac(prev.hmac)}）`,
    };
  }

  return { status: 'verified', detail: '与前一条 WARN/BLOCK 记录衔接' };
}

export function detectTimelineGaps(rows: AgentWatchEvent[]): TimelineGap[] {
  const gaps: TimelineGap[] = [];
  const sorted = [...rows].sort((a, b) => a.timestamp_ms - b.timestamp_ms);

  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const curr = sorted[i];

    if (
      curr.prev_hmac?.trim() &&
      prev.hmac?.trim() &&
      curr.prev_hmac.trim() !== prev.hmac.trim()
    ) {
      gaps.push({ afterIndex: i - 1, reason: 'hmac_mismatch' });
      continue;
    }

    if (
      curr.sequence_no !== undefined &&
      curr.sequence_no !== null &&
      prev.sequence_no !== undefined &&
      prev.sequence_no !== null &&
      curr.sequence_no - prev.sequence_no > 1
    ) {
      gaps.push({ afterIndex: i - 1, reason: 'sequence_gap' });
      continue;
    }

    if (curr.prev_hmac?.trim() && !prev.hmac?.trim()) {
      gaps.push({ afterIndex: i - 1, reason: 'allow_missing' });
    }
  }

  return gaps;
}

export function sliceTimelineContext(
  rows: AgentWatchEvent[],
  currentEventId: string,
  contextRadius = 5,
  maxTotal = 20,
): { visible: AgentWatchEvent[]; truncatedBefore: number; truncatedAfter: number } {
  const sorted = [...rows].sort((a, b) => a.timestamp_ms - b.timestamp_ms);
  const idx = sorted.findIndex((row) => row.event_id === currentEventId);

  if (idx < 0) {
    return {
      visible: sorted.slice(0, maxTotal),
      truncatedBefore: 0,
      truncatedAfter: Math.max(0, sorted.length - maxTotal),
    };
  }

  let start = Math.max(0, idx - contextRadius);
  let end = Math.min(sorted.length - 1, idx + contextRadius);

  if (end - start + 1 > maxTotal) {
    const half = Math.floor(maxTotal / 2);
    start = Math.max(0, idx - half);
    end = Math.min(sorted.length - 1, start + maxTotal - 1);
    if (end - start + 1 < maxTotal) {
      start = Math.max(0, end - maxTotal + 1);
    }
  }

  return {
    visible: sorted.slice(start, end + 1),
    truncatedBefore: start,
    truncatedAfter: Math.max(0, sorted.length - end - 1),
  };
}

export function gapLabel(reason: TimelineGapReason): string {
  switch (reason) {
    case 'allow_missing':
      return '中间可能有正常放行（本页不展示 ALLOW）';
    case 'hmac_mismatch':
      return 'HMAC 不连续，建议用本机 audit 日志核对';
    case 'sequence_gap':
      return '调用序号不连续，中间可能有未展示的事件';
    default:
      return '链条异常';
  }
}

export function exportEvidenceJson(event: AgentWatchEvent): string {
  const payload = {
    event_id: event.event_id,
    session_id: event.session_id,
    timestamp_ms: event.timestamp_ms,
    tool_name: event.tool_name,
    service_name: event.service_name,
    tool_source: event.tool_source ?? null,
    final_decision: event.final_decision,
    block_reason: event.block_reason ?? null,
    l0_triggered_rules: event.l0_triggered_rules,
    l1_combined_score: event.l1_combined_score,
    l1_scores: event.l1_scores ?? null,
    chain_depth: event.chain_depth,
    previous_tool: event.previous_tool ?? null,
    hmac: event.hmac,
    prev_hmac: event.prev_hmac ?? null,
  };
  return JSON.stringify(payload, null, 2);
}

export function downloadEvidenceJson(event: AgentWatchEvent): void {
  const blob = new Blob([exportEvidenceJson(event)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `agentwatch-${event.event_id}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function formatHmacChainExport(events: AgentWatchEvent[]): string {
  return [...events]
    .sort((a, b) => a.timestamp_ms - b.timestamp_ms)
    .map((event) => {
      const prev = event.prev_hmac?.trim();
      return prev
        ? `${event.event_id}\t${event.hmac}\tprev:${prev}`
        : `${event.event_id}\t${event.hmac}`;
    })
    .join('\n');
}

export function integrityStatusLabel(status: HmacIntegrityStatus): string {
  switch (status) {
    case 'verified':
      return '已验证';
    case 'warning':
      return '有警告';
    case 'broken':
      return '已断裂';
    default:
      return status;
  }
}

export function integrityStatusEmoji(status: HmacIntegrityStatus): string {
  switch (status) {
    case 'verified':
      return '🟢';
    case 'warning':
      return '🟡';
    case 'broken':
      return '🔴';
    default:
      return '⚪';
  }
}

/** 找病因：与判定直接相关的上下文字段（有值才展示） */
export function traceContextFields(
  event: AgentWatchEvent,
): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];

  const push = (label: string, value: unknown) => {
    if (value === null || value === undefined || value === '') return;
    rows.push({ label, value: String(value) });
  };

  push('上一工具', event.previous_tool);
  push('调用链深度', event.chain_depth);
  if (event.has_amount && event.amount_bucket) {
    push('金额区间', event.amount_bucket);
  }
  if (event.has_address) {
    push('含链上地址参数', '是');
  }
  push('工具来源', event.tool_source);
  push('客户端', event.client_name?.trim() || null);
  push('1 分钟调用次数', event.frequency_1m);
  push('连续失败次数', event.consecutive_failures);

  return rows;
}

export function l1ContributingDetectors(event: AgentWatchEvent): string[] {
  if (!event.l1_scores) return [];
  return Object.keys(event.l1_scores);
}

export function hasTraceContext(event: AgentWatchEvent): boolean {
  return traceContextFields(event).length > 0;
}
