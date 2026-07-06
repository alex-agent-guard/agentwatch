import type { AgentWatchEvent } from '@/types/events';
import { isGrayRhinoEvent } from '@/lib/auditDetail';
import { buildCorrelatedFactRows, buildL1FactRows } from '@/lib/ruleEvidence';
import { getRiskTitle, inferCombinationHints } from '@/lib/riskCopy';

export interface EventRiskBrief {
  /** 风险类型标签 — 来自已命中的 ruleId，非臆测 */
  tags: string[];
  /** 主标题 */
  headline: string;
  /** 本条记录的可核对事实 — 全部来自引擎字段 */
  evidenceLines: string[];
}

const FIELD_LABEL_ZH: Record<string, string> = {
  pattern: '匹配模式',
  offset: '命中位置',
  category: '注入类别',
  confidence: '置信度',
  threshold: '阈值',
  'tool.name': '工具',
  'argument.value': '参数值',
  'context.chain_depth': '调用链深度',
  'metadata.consecutive_failures': '连续失败次数',
  'metadata.frequency_1m': '1 分钟调用次数',
  'tool.source': '工具来源',
  tool_name: '工具',
  amount_bucket: '金额区间',
  chain_depth: '调用链深度',
  previous_tool: '上一工具',
  tool_source: '工具来源',
  service_name: '服务',
  consecutive_failures: '连续失败次数',
  frequency_1m: '1 分钟调用次数',
  has_address: '含链上地址',
  has_amount: '含金额参数',
  sensitive_tool: '敏感工具',
  whitelist: '在白名单',
  match_type: '匹配类型',
  l1_combined_score: 'L1 综合分',
};

function labelZh(key: string): string {
  return FIELD_LABEL_ZH[key] ?? key;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'object') return JSON.stringify(value);
  const text = String(value);
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

function rowsToLines(rows: Array<{ label: string; value: string }>, prefix?: string): string[] {
  const lines: string[] = [];
  for (const row of rows) {
    if (!row.value || row.value.startsWith('（')) continue;
    const line = `${labelZh(row.label)}：${row.value}`;
    lines.push(prefix ? `${prefix}${line}` : line);
  }
  return lines;
}

function matchedFieldsToLines(
  matched: Record<string, unknown> | undefined,
  prefix?: string,
): string[] {
  if (!matched) return [];
  return Object.entries(matched)
    .map(([key, val]) => {
      const formatted = formatValue(val);
      if (!formatted) return null;
      return prefix ? `${prefix}${labelZh(key)}：${formatted}` : `${labelZh(key)}：${formatted}`;
    })
    .filter((line): line is string => line !== null);
}

function buildRuleEvidenceLines(event: AgentWatchEvent, ruleId: string): string[] {
  const rule = event.l0_triggered_rules.find((r) => r.ruleId === ruleId);
  const title = getRiskTitle(ruleId);
  const prefix = event.l0_triggered_rules.length > 1 ? `[${title}] ` : '';

  const fromMatched = matchedFieldsToLines(rule?.matchedFields, prefix);
  if (fromMatched.length > 0) return fromMatched;

  const correlated = buildCorrelatedFactRows(event, ruleId);
  return rowsToLines(
    correlated.map((r) => ({ label: r.label, value: r.value })),
    prefix,
  );
}

function buildL1EvidenceLines(event: AgentWatchEvent): string[] {
  const lines: string[] = [];
  const score = Math.round(event.l1_combined_score * 1000) / 1000;
  lines.push(`L1 综合分：${String(score)}（未命中 L0 规则）`);

  if (event.l1_scores) {
    for (const [key, val] of Object.entries(event.l1_scores)) {
      lines.push(`${labelZh(key)}：${String(val)}`);
    }
  }

  for (const row of buildL1FactRows(event)) {
    if (row.label === 'l1_combined_score' || row.label.startsWith('l0_')) continue;
    if (row.label === 'final_decision') continue;
    lines.push(`${labelZh(row.label)}：${row.value}`);
  }

  if (event.chain_depth > 0) {
    lines.push(`调用链深度：${String(event.chain_depth)}`);
  }
  if (event.previous_tool) {
    lines.push(`上一工具：${event.previous_tool}`);
  }
  if (event.frequency_1m !== undefined && event.frequency_1m !== null) {
    lines.push(`1 分钟调用次数：${String(event.frequency_1m)}`);
  }

  return lines;
}

export function buildEventRiskBrief(event: AgentWatchEvent): EventRiskBrief {
  const ruleIds = event.l0_triggered_rules.map((r) => r.ruleId);

  if (isGrayRhinoEvent(event)) {
    return {
      tags: ['统计异常'],
      headline: '行为异常（L1）',
      evidenceLines: buildL1EvidenceLines(event),
    };
  }

  if (ruleIds.length === 0) {
    return {
      tags: [],
      headline: event.final_decision === 'ALLOW' ? '未命中规则' : '待复核',
      evidenceLines: event.block_reason?.trim() ? [`引擎记录：${event.block_reason.trim()}`] : [],
    };
  }

  const tags = ruleIds.map(getRiskTitle);
  const combos = inferCombinationHints(ruleIds);
  if (combos.length === 1 && ruleIds.length > 1) {
    tags.push(combos[0].copy.userTitleZh);
  }

  const headline =
    ruleIds.length === 1 ? getRiskTitle(ruleIds[0]) : ruleIds.map(getRiskTitle).join(' + ');

  const evidenceLines = ruleIds.flatMap((id) => buildRuleEvidenceLines(event, id));

  if (event.block_reason?.trim()) {
    evidenceLines.push(`引擎记录：${event.block_reason.trim()}`);
  }

  return { tags, headline, evidenceLines };
}

export function hitEvidenceTeaser(
  event: AgentWatchEvent,
  hit: { engine: 'L0' | 'L1'; ruleId?: string },
): string {
  if (hit.engine === 'L1') {
    const lines = buildL1EvidenceLines(event);
    return lines[0] ?? '查看 L1 分项';
  }
  if (!hit.ruleId) return '查看匹配字段';
  const lines = buildRuleEvidenceLines(event, hit.ruleId);
  return lines[0] ?? getRiskTitle(hit.ruleId);
}

export function hitLabel(hit: { engine: 'L0' | 'L1'; ruleId?: string }): string {
  if (hit.engine === 'L1') return '行为异常（L1）';
  return hit.ruleId ? getRiskTitle(hit.ruleId) : '规则命中';
}
