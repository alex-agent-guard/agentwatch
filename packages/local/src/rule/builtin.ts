/**
 * V0 内置规则库 — L0-RULE-01 ~ L0-RULE-09
 * 契约：task_l0_engine.md (§1.4) + packages/shared/types/rule.types.ts
 * 仅静态 Rule[] 数据集，不含匹配/索引/超时业务逻辑
 */
import type {
  ConditionLogic,
  MatchType,
  Rule,
  RuleAction,
  RuleCondition,
  RuleSeverity,
} from '@packages/shared/types';

const V0_RULE_AUTHOR = 'AgentWatch';
const V0_RULE_VERSION = '1.0.0';
const V0_RULE_CREATED_AT = 1_704_067_200_000;
const V0_RULE_UPDATED_AT = 1_704_067_200_000;

function condition(
  id: string,
  field: RuleCondition['field'],
  matchType: MatchType,
  pattern: RuleCondition['pattern'],
  options?: Pick<RuleCondition, 'negate' | 'weight'>,
): RuleCondition {
  return {
    id,
    field,
    matchType,
    pattern,
    ...(options?.negate !== undefined ? { negate: options.negate } : {}),
    ...(options?.weight !== undefined ? { weight: options.weight } : {}),
  };
}

function builtinRule(params: {
  id: string;
  name: string;
  description: string;
  category: string;
  severity: RuleSeverity;
  action: RuleAction;
  conditionLogic: ConditionLogic;
  conditions: RuleCondition[];
  tags: string[];
  minWeight?: number;
}): Rule {
  return {
    id: params.id,
    name: params.name,
    description: params.description,
    category: params.category,
    severity: params.severity,
    action: params.action,
    enabled: true,
    immutable: true,
    conditions: params.conditions,
    conditionLogic: params.conditionLogic,
    ...(params.minWeight !== undefined ? { minWeight: params.minWeight } : {}),
    version: V0_RULE_VERSION,
    author: V0_RULE_AUTHOR,
    tags: params.tags,
    createdAt: V0_RULE_CREATED_AT,
    updatedAt: V0_RULE_UPDATED_AT,
    hitCount: 0,
    falsePositiveCount: 0,
  };
}

/** L0-RULE-01：V0 内置规则集静态数组（L0-RULE-02 ~ L0-RULE-09 共八条规则） */
export const V0_BUILTIN_RULES: Rule[] = [
  // L0-RULE-02 GOAL_HIJACK_001 — 关键词劫持检测
  builtinRule({
    id: 'GOAL_HIJACK_001',
    name: 'Goal Hijack Keyword Detection',
    description:
      'Detects prompt injection attempts that instruct the agent to ignore prior instructions.',
    category: 'goal_hijacking',
    severity: 'CRITICAL',
    action: 'BLOCK',
    conditionLogic: 'AND',
    tags: ['goal_hijack', 'prompt_injection', 'builtin', 'v0'],
    conditions: [
      condition(
        'c1',
        'argument.value',
        'CONTAINS',
        'ignore previous instruction',
      ),
    ],
  }),

  // L0-RULE-03 GOAL_HIJACK_002 — 角色覆盖检测
  builtinRule({
    id: 'GOAL_HIJACK_002',
    name: 'Goal Hijack Role Override Detection',
    description:
      'Detects role override or system impersonation patterns in tool arguments.',
    category: 'goal_hijacking',
    severity: 'CRITICAL',
    action: 'BLOCK',
    conditionLogic: 'OR',
    tags: ['goal_hijack', 'role_override', 'builtin', 'v0'],
    conditions: [
      condition(
        'c1',
        'argument.value',
        'REGEX',
        String.raw`[Rr][Oo][Ll][Ee]\s*:\s*[Ss][Yy][Ss][Tt][Ee][Mm]`,
      ),
      condition('c2', 'argument.value', 'CONTAINS', 'you are now'),
      condition(
        'c3',
        'argument.value',
        'REGEX',
        String.raw`0x[a-fA-F0-9]{40}`,
      ),
    ],
  }),

  // L0-RULE-04 PARAM_TAMPER_001 — 大额转账检测
  builtinRule({
    id: 'PARAM_TAMPER_001',
    name: 'Large Transfer Parameter Tampering',
    description:
      'Blocks transfer tool calls with amount parameters exceeding the configured threshold.',
    category: 'parameter_tampering',
    severity: 'CRITICAL',
    action: 'BLOCK',
    conditionLogic: 'AND',
    tags: ['parameter_tampering', 'transfer', 'builtin', 'v0'],
    conditions: [
      condition('c1', 'tool.name', 'EXACT', 'transfer'),
      condition('c2', 'argument.name', 'SET', ['amount', 'value', 'sum']),
      condition('c3', 'argument.value', 'NUMERIC_RANGE', '[100000,Infinity)'),
    ],
  }),

  // L0-RULE-05 CHAIN_ABUSE_001 — 工具链滥用检测
  builtinRule({
    id: 'CHAIN_ABUSE_001',
    name: 'Sensitive Tool Chain Abuse Detection',
    description:
      'Detects sensitive tool invocations at excessive chain depth indicating automated abuse.',
    category: 'chain_abuse',
    severity: 'HIGH',
    action: 'BLOCK',
    conditionLogic: 'AND',
    tags: ['chain_abuse', 'tool_chain', 'builtin', 'v0'],
    conditions: [
      condition('c1', 'tool.name', 'SET', [
        'execute_shell',
        'run_script',
        'transfer',
        'delete_file',
        'write_file',
      ]),
      condition('c2', 'context.chain_depth', 'NUMERIC_RANGE', '[3,Infinity)'),
    ],
  }),

  // L0-RULE-06 PERM_PROBE_001 — 权限探测检测
  builtinRule({
    id: 'PERM_PROBE_001',
    name: 'Permission Probing Detection',
    description:
      'Detects repeated consecutive authorization failures indicating permission probing.',
    category: 'permission_probe',
    severity: 'HIGH',
    action: 'WARN',
    conditionLogic: 'AND',
    tags: ['permission_probe', 'auth_failure', 'builtin', 'v0'],
    conditions: [
      condition(
        'c1',
        'metadata.consecutive_failures',
        'NUMERIC_RANGE',
        '[3,Infinity)',
      ),
    ],
  }),

  // L0-RULE-07 SUPPLY_CHAIN_001 — 供应链来源检测
  builtinRule({
    id: 'SUPPLY_CHAIN_001',
    name: 'Tool Supply Chain Source Validation',
    description:
      'Warns when tool source is not in the trusted whitelist of official registries.',
    category: 'supply_chain',
    severity: 'MEDIUM',
    action: 'WARN',
    conditionLogic: 'AND',
    tags: ['supply_chain', 'tool_source', 'builtin', 'v0'],
    conditions: [
      condition(
        'c1',
        'tool.source',
        'REGEX',
        String.raw`^(?!official$|builtin$|registry$|npm$|mcp_official$).+$`,
      ),
    ],
  }),

  // L0-RULE-08 FREQ_001 — 极端频率检测
  builtinRule({
    id: 'FREQ_001',
    name: 'Extreme Call Frequency Detection',
    description:
      'Blocks tool call bursts exceeding 100 invocations per minute.',
    category: 'frequency_anomaly',
    severity: 'CRITICAL',
    action: 'BLOCK',
    conditionLogic: 'AND',
    tags: ['frequency', 'rate_limit', 'builtin', 'v0'],
    conditions: [
      condition(
        'c1',
        'metadata.frequency_1m',
        'NUMERIC_RANGE',
        '[100,Infinity)',
      ),
    ],
  }),

  // L0-RULE-09 PROMPT_INJ_001 — 分隔符注入检测
  builtinRule({
    id: 'PROMPT_INJ_001',
    name: 'Prompt Delimiter Injection Detection',
    description:
      'Detects markdown or HTML delimiter injection patterns in tool arguments.',
    category: 'prompt_injection',
    severity: 'HIGH',
    action: 'WARN',
    conditionLogic: 'OR',
    tags: ['prompt_injection', 'delimiter', 'builtin', 'v0'],
    conditions: [
      condition('c1', 'argument.value', 'REGEX', String.raw`[\-#]{3,}`),
      condition(
        'c2',
        'argument.value',
        'REGEX',
        String.raw`<\s*/\s*\w+\s*>`,
      ),
    ],
  }),
];
