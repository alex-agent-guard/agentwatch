/**
 * 决策路由融合类型定义
 * 适配文档：task_router_logger_structure.md (DR-001~DR-005, L5612-L5994)
 *          agentwatch_v0_mvp_tasklist.md §4 Decision Router
 */
import type { DecisionRouterConfig } from './config.types.js';
import type { L1DetectionResult } from './risk.types.js';
import type { RuleMatchResult } from './rule.types.js';

/** 融合最终决策 */
export type FusionDecision = 'ALLOW' | 'BLOCK' | 'WARN';

/** 单场景得分 — DR-001 输入 Map<string, ScenarioScore> */
export interface ScenarioScore {
  scenario: string;
  score: number;
  isAnomaly: boolean;
  indicators: string[];
}

/** 组合增强单条件 — CombinationRule 内部条件 */
export interface CombinationRuleCondition {
  scenario: string;
  minScore: number;
}

/** 组合增强规则 — DR-003 L5644-L5672 */
export interface CombinationRule {
  id: string;
  name: string;
  conditions: CombinationRuleCondition[];
  boostFactor: number;
  maxBoostedScore: number;
}

/** RiskFusionEngine 融合输出 — DR-001 / DR-005 */
export interface FusionResult {
  baseScore: number;
  enhancedScore: number;
  finalDecision: FusionDecision;
  threshold: Pick<DecisionRouterConfig, 'blockThreshold' | 'warnThreshold'>;
  activeScenarios: string[];
  triggeredCombinations: string[];
  scenarioBreakdown: Record<string, ScenarioScore>;
  confidence: number;
}

/** FalsePositiveController 阈值调整结果 — DR-004 */
export interface ThresholdAdjustment {
  adjusted: boolean;
  actualFPR: number;
  currentThresholds: Pick<DecisionRouterConfig, 'blockThreshold' | 'warnThreshold'>;
}

/** 决策路由器抽象 — ProxySession.decisionRouter */
export interface IDecisionRouter {
  decide(scenarioScores: Map<string, ScenarioScore>): FusionResult;
  detect(
    ruleResults: RuleMatchResult[],
    l1Result: L1DetectionResult,
    eventId?: string | null,
    extraScenarioScores?: ScenarioScore[],
  ): FusionResult;
}
