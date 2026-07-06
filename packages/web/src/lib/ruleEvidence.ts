import type { AgentWatchEvent } from '@/types/events';
import type { ObjectiveFactRow } from '@/lib/auditRiskItems';
import { buildMatchedFieldRows, findTriggeredRule } from '@/lib/auditRiskItems';

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function pushUnique(rows: ObjectiveFactRow[], row: ObjectiveFactRow): void {
  if (rows.some((r) => r.label === row.label)) return;
  rows.push(row);
}

/**
 * 与某次 L0 命中相关的可核对字段 — 优先 matchedFields，其次事件级同名字段
 */
export function buildCorrelatedFactRows(
  event: AgentWatchEvent,
  ruleId: string,
): ObjectiveFactRow[] {
  const rule = findTriggeredRule(event, ruleId);
  const rows: ObjectiveFactRow[] = [];

  if (rule?.matchedFields) {
    rows.push(...buildMatchedFieldRows(rule.matchedFields));
  }

  const add = (id: string, label: string, value: unknown, group: ObjectiveFactRow['group']) => {
    if (value === null || value === undefined) return;
    pushUnique(rows, { id, label, value: formatValue(value), group, mono: true });
  };

  switch (ruleId) {
    case 'PARAM_TAMPER_001':
      add('tool_name', 'tool_name', event.tool_name, 'context');
      add('has_amount', 'has_amount', event.has_amount, 'call');
      add('amount_bucket', 'amount_bucket', event.amount_bucket, 'call');
      break;
    case 'CHAIN_ABUSE_001':
      add('chain_depth', 'chain_depth', event.chain_depth, 'chain');
      add('tool_name', 'tool_name', event.tool_name, 'context');
      add('previous_tool', 'previous_tool', event.previous_tool, 'chain');
      break;
    case 'PERM_PROBE_001':
      add(
        'consecutive_failures',
        'consecutive_failures',
        event.consecutive_failures,
        'detection',
      );
      if (event.consecutive_failures === null || event.consecutive_failures === undefined) {
        pushUnique(rows, {
          id: 'perm_note',
          label: 'consecutive_failures',
          value: '（当前记录未含此字段 — 见本机 audit 日志）',
          group: 'detection',
        });
      }
      break;
    case 'FREQ_001':
      add('frequency_1m', 'frequency_1m', event.frequency_1m, 'detection');
      if (event.frequency_1m === null || event.frequency_1m === undefined) {
        pushUnique(rows, {
          id: 'freq_note',
          label: 'frequency_1m',
          value: '（当前记录未含此字段 — 见本机 audit 日志）',
          group: 'detection',
        });
      }
      break;
    case 'SUPPLY_CHAIN_001':
      add('service_name', 'service_name', event.service_name, 'context');
      add('tool_source', 'tool_source', event.tool_source, 'context');
      break;
    case 'GOAL_HIJACK_001':
    case 'GOAL_HIJACK_002':
    case 'PROMPT_INJ_001':
      add('arg_count', 'arg_count', event.arg_count > 0 ? event.arg_count : null, 'call');
      if (event.arg_value_types.length > 0) {
        add('arg_value_types', 'arg_value_types', event.arg_value_types.join(', '), 'call');
      }
      add('has_address', 'has_address', event.has_address ? true : null, 'call');
      break;
    default:
      break;
  }

  return rows;
}

export function buildL1FactRows(event: AgentWatchEvent): ObjectiveFactRow[] {
  const rows: ObjectiveFactRow[] = [
    {
      id: 'l1_score',
      label: 'l1_combined_score',
      value: String(Math.round(event.l1_combined_score * 1000) / 1000),
      group: 'detection',
      mono: true,
    },
    {
      id: 'l0_rules',
      label: 'l0_triggered_rules',
      value: JSON.stringify(event.l0_triggered_rules),
      group: 'detection',
      mono: true,
    },
    {
      id: 'decision',
      label: 'final_decision',
      value: event.final_decision,
      group: 'context',
      mono: true,
    },
  ];

  if (event.l1_scores) {
    for (const [key, val] of Object.entries(event.l1_scores)) {
      rows.push({
        id: `l1_${key}`,
        label: `l1_scores.${key}`,
        value: String(val),
        group: 'detection',
        mono: true,
      });
    }
  }

  return rows;
}
