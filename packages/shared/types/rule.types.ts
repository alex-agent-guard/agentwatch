/**
 * L0 规则引擎核心类型定义
 * 适配文档：task_l0_engine.md (792-924行) + agentwatch_v0_mvp_tasklist.md
 * 核心适配点：9种MatchType、扩展FieldSource、嵌套DetectionEvent结构
 */

/** 规则严重级别 - 决定告警/拦截优先级 */
export type RuleSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

/** 规则匹配后的动作 - 定义对检测事件的处理方式 */
export type RuleAction = 'BLOCK' | 'WARN' | 'ESCALATE' | 'LOG' | 'ALLOW';

/** 规则匹配模式类型 - L0引擎支持的9种核心匹配方式 */
export type MatchType =
  | 'EXACT'            // 精确匹配
  | 'PREFIX'           // 前缀匹配（Trie索引）
  | 'CONTAINS'         // 包含匹配（AC自动机）
  | 'REGEX'            // 正则匹配（LRU缓存）
  | 'SET'              // 集合匹配（Exact索引展开）
  | 'NUMERIC_RANGE'    // 数值范围匹配
  | 'SEMVER_RANGE'     // 语义版本范围匹配
  | 'GLOB'             // 通配符匹配（转正则）
  | 'FUNCTION';        // 自定义函数匹配

/** 规则条件字段来源 - 对应DetectionEvent的嵌套路径，扩展consecutive_failures字段 */
export type FieldSource =
  | 'tool.name'
  | 'tool.version'
  | 'tool.source'
  | 'argument.name'
  | 'argument.value'
  | 'argument.type'
  | 'request.origin'
  | 'request.user_id'
  | 'request.session_id'
  | 'request.timestamp'
  | 'context.agent_id'
  | 'context.skill_id'
  | 'context.chain_depth'
  | 'metadata.frequency_1m'
  | 'metadata.frequency_5m'
  | 'metadata.consecutive_failures'; // 扩展：权限探测规则PERM_PROBE_001依赖

/** 单个规则条件 - 规则的最小匹配单元 */
export interface RuleCondition {
  id: string;                  // 条件唯一标识
  field: FieldSource;          // 要匹配的字段来源
  matchType: MatchType;        // 匹配类型
  pattern: string | number | string[]; // 匹配模式（支持字符串/数值/集合）
  negate?: boolean;            // 是否取反匹配结果
  weight?: number;             // 权重（用于WEIGHTED_SUM逻辑）
}

/** 条件组合逻辑 - 多条件的聚合方式 */
export type ConditionLogic = 'AND' | 'OR' | 'NOT' | 'MAJORITY' | 'WEIGHTED_SUM';

/** 完整规则定义 - V0内置规则库的核心结构 */
export interface Rule {
  id: string;                  // 规则唯一ID（如GOAL_HIJACK_001）
  name: string;                // 规则名称
  description: string;         // 规则描述
  category: string;            // 规则分类（如劫持/篡改/滥用）
  severity: RuleSeverity;      // 严重级别
  action: RuleAction;          // 匹配后动作
  enabled: boolean;            // 是否启用
  immutable: boolean;          // 是否不可修改（内置规则）
  conditions: RuleCondition[]; // 条件列表
  conditionLogic: ConditionLogic; // 条件组合逻辑
  minWeight?: number;          // 最小权重（WEIGHTED_SUM时生效）
  version: string;             // 规则版本
  author: string;              // 规则作者
  tags: string[];              // 规则标签
  createdAt: number;           // 创建时间戳
  updatedAt: number;           // 更新时间戳
  effectiveFrom?: number;      // 生效起始时间
  effectiveTo?: number;        // 生效结束时间
  hitCount: number;            // 命中次数
  falsePositiveCount: number;  // 误报次数
  lastHitAt?: number;          // 最后命中时间
}

/** 规则匹配结果 - 引擎输出的匹配详情 */
export interface RuleMatchResult {
  ruleId: string;                      // 命中的规则ID
  ruleName: string;                    // 命中的规则名称
  severity: RuleSeverity;              // 规则严重级别
  action: RuleAction;                  // 执行动作
  matchedConditions: string[];         // 命中的条件ID列表
  confidence: number;                  // 匹配置信度（0-1）
  matchedFields: Record<string, unknown>; // 命中的字段键值对
  timestamp: number;                   // 匹配时间戳
}

/** 规则集 - 规则的分组管理结构 */
export interface RuleSet {
  id: string;                // 规则集ID
  name: string;              // 规则集名称
  description: string;       // 规则集描述
  rules: Rule[];             // 包含的规则列表
  priority: number;          // 规则集优先级
  defaultAction: RuleAction; // 无匹配时的默认动作
}

/** 编译后的规则 - 引擎内部优化结构（减少运行时计算） */
export interface CompiledRule {
  id: string;                          // 规则ID（与原规则一致）
  severity: RuleSeverity;              // 规则严重级别
  action: RuleAction;                  // 执行动作
  compiledConditions: CompiledCondition[]; // 编译后的条件列表
  conditionLogic: ConditionLogic;      // 条件组合逻辑
  minWeight?: number;                  // 最小权重（WEIGHTED_SUM）
  priority: number;                    // 规则优先级
}

/** 编译后的条件 - 包含预编译的匹配函数 */
export interface CompiledCondition {
  id: string;                // 条件ID（与原条件一致）
  field: FieldSource;        // 字段来源
  matcher: MatcherFn;        // 预编译的匹配函数
  weight: number;            // 权重（默认1）
  negate: boolean;           // 是否取反（默认false）
}

/** 匹配函数类型 - 编译后条件的核心执行逻辑 */
export type MatcherFn = (value: unknown) => boolean;

import type { DetectionEvent } from './event.types.js';

/** L0 规则评估上下文 — match() / evaluateRule() 入口绑定 DetectionEvent */
export interface RuleEvaluationContext {
  event: DetectionEvent;
}
