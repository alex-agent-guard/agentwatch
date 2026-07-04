/**
 * Decision Router — L0/L1 检测结果融合与最终决策
 * 契约：fusion.types IDecisionRouter / FusionResult
 */
import {
  DEFAULT_BASELINE_DEVIATION_WEIGHT,
  DEFAULT_BLOCK_THRESHOLD,
  DEFAULT_DECISION_BUDGET_MS,
  DEFAULT_RULE_WEIGHT,
  DEFAULT_STAT_WEIGHT,
  DEFAULT_WARN_THRESHOLD,
  L1_HIGH_SCORE_THRESHOLD,
  L1_MEDIUM_SCORE_THRESHOLD,
  RiskType,
  RULE_ID_SCENARIO_MAP,
} from '@packages/shared/constants';

import type {
  CombinationRule,
  DecisionRouterConfig,
  FusionDecision,
  FusionResult,
  IDecisionRouter,
  L1DetectionResult,
  RuleAction,
  RuleMatchResult,
  ScenarioScore,
} from '@packages/shared/types';

const ACTION_PRIORITY: Record<RuleAction, number> = {
  BLOCK: 3,
  ESCALATE: 2,
  WARN: 2,
  LOG: 1,
  ALLOW: 0,
};

const V0_COMBINATION_RULES: CombinationRule[] = [
  {
    id: 'high_value_transfer',
    name: 'High Value Transfer',
    conditions: [
      { scenario: 'parameter_tampering', minScore: 0.6 },
      { scenario: 'tool_chain_abuse', minScore: 0.4 },
    ],
    boostFactor: 1.5,
    maxBoostedScore: 0.99,
  },
  {
    id: 'coordinated_attack',
    name: 'Coordinated Attack',
    conditions: [
      { scenario: 'goal_hijacking', minScore: 0.5 },
      { scenario: 'prompt_injection', minScore: 0.4 },
    ],
    boostFactor: 1.4,
    maxBoostedScore: 0.95,
  },
  {
    id: 'rapid_probing',
    name: 'Rapid Probing',
    conditions: [
      { scenario: 'permission_probing', minScore: 0.6 },
      { scenario: 'frequency_anomaly', minScore: 0.5 },
    ],
    boostFactor: 1.3,
    maxBoostedScore: 0.95,
  },
];

/**
 * 决策路由器 — L0/L1 加权融合 + 组合增强 + 阈值判定
 * 契约：task_router_logger_structure.md DR-001~003 / fusion.types IDecisionRouter
 */
export class DecisionRouter implements IDecisionRouter {
  private readonly blockThreshold: number;
  private readonly warnThreshold: number;
  private readonly ruleWeight: number;
  private readonly statWeight: number;
  private readonly decisionBudgetMs: number;
  private readonly injectDecisionDelayMs: number;

  // TODO(DR-V1): 双缓冲阈值热重载 — 读写分离 config snapshot
  // TODO(DR-V1): 告警持久化缓存 — 跨会话 dedupe / TTL store

  /**
   * @param options - DecisionRouterConfig 子集；block/warn 阈值默认 0.8/0.5
   */
  constructor(
    options: Partial<DecisionRouterConfig> & {
      decisionBudgetMs?: number;
      injectDecisionDelayMs?: number;
    } = {},
  ) {
    this.blockThreshold = options.blockThreshold ?? DEFAULT_BLOCK_THRESHOLD;
    this.warnThreshold = options.warnThreshold ?? DEFAULT_WARN_THRESHOLD;
    this.ruleWeight = options.ruleWeight ?? DEFAULT_RULE_WEIGHT;
    this.statWeight = options.statWeight ?? DEFAULT_STAT_WEIGHT;
    this.decisionBudgetMs = options.decisionBudgetMs ?? DEFAULT_DECISION_BUDGET_MS;
    this.injectDecisionDelayMs = options.injectDecisionDelayMs ?? 0;
  }

  /** 场景分数 Map 融合入口 — V1 RiskFusionEngine.fuse() 契约 */
  decide(scenarioScores: Map<string, ScenarioScore>): FusionResult {
    return this.runWithBudget(null, () => this.fuseScenarioScores(scenarioScores));
  }

  /**
   * L0 match + L1 processEvent 结果融合 — MCPProxyCore.handleToolCall 主入口
   * @param eventId - JSON-RPC request id，超时/异常结构化 Error 携带
   */
  detect(
    ruleResults: RuleMatchResult[],
    l1Result: L1DetectionResult,
    eventId: string | null = null,
    extraScenarioScores: ScenarioScore[] = [],
  ): FusionResult {
    return this.runWithBudget(eventId, () =>
      this.fuseDetectionInputs(ruleResults, l1Result, extraScenarioScores),
    );
  }

  private fuseDetectionInputs(
    ruleResults: RuleMatchResult[],
    l1Result: L1DetectionResult,
    extraScenarioScores: ScenarioScore[] = [],
  ): FusionResult {
    const safeL1 = this.normalizeL1Result(l1Result);
    const scenarioScores = this.buildScenarioScoresFromInputs(ruleResults, safeL1);
    for (const entry of extraScenarioScores) {
      scenarioScores.set(entry.scenario, entry);
    }
    const fusion = this.fuseScenarioScores(scenarioScores);
    const l0Action = this.resolveL0Action(ruleResults);

    if (l0Action === 'BLOCK') {
      return {
        ...fusion,
        finalDecision: 'BLOCK',
        enhancedScore: Math.max(fusion.enhancedScore, this.blockThreshold),
      };
    }

    const l1Level = this.classifyL1Level(safeL1);
    const mergedDecision = this.mergeDecisions(l0Action, l1Level, fusion.enhancedScore);

    return {
      ...fusion,
      finalDecision: mergedDecision,
    };
  }

  private fuseScenarioScores(scenarioScores: Map<string, ScenarioScore>): FusionResult {
    if (scenarioScores.size === 0) {
      return this.buildAllowFallback({});
    }

    const scenarioBreakdown = Object.fromEntries(scenarioScores.entries());
    const ruleScenario = scenarioScores.get('rule_engine');
    const statScenario = scenarioScores.get('statistical_engine');

    const l0Score = ruleScenario?.score ?? 0;
    const l1Score = statScenario?.score ?? 0;
    const baselineScenario = scenarioScores.get('baseline_deviation');
    const baselineContribution =
      baselineScenario !== undefined
        ? DEFAULT_BASELINE_DEVIATION_WEIGHT * baselineScenario.score
        : 0;
    const baseScore =
      this.ruleWeight * l0Score + this.statWeight * l1Score + baselineContribution;

    const { enhancedScore, triggeredCombinations } = this.applyCombinationBoost(
      scenarioScores,
      baseScore,
    );

    const activeScenarios = [...scenarioScores.values()]
      .filter((entry) => entry.isAnomaly || entry.score >= this.warnThreshold)
      .map((entry) => entry.scenario);

    let finalDecision = this.decideFromScore(enhancedScore);

    if (
      ruleScenario?.isAnomaly === true &&
      ruleScenario.score >= this.blockThreshold
    ) {
      finalDecision = 'BLOCK';
    } else if (
      ruleScenario?.isAnomaly === true &&
      ruleScenario.score >= this.warnThreshold &&
      finalDecision === 'ALLOW'
    ) {
      finalDecision = 'WARN';
    }

    if (
      statScenario?.isAnomaly === true &&
      statScenario.score >= this.blockThreshold
    ) {
      finalDecision = 'BLOCK';
    } else if (
      statScenario?.isAnomaly === true &&
      statScenario.score >= this.warnThreshold &&
      finalDecision === 'ALLOW'
    ) {
      finalDecision = 'WARN';
    }

    finalDecision = this.applyCriticalScenarioFallback(
      finalDecision,
      enhancedScore,
      activeScenarios,
    );

    const confidence = this.calculateConfidence(activeScenarios);

    return {
      baseScore,
      enhancedScore,
      finalDecision,
      threshold: {
        blockThreshold: this.blockThreshold,
        warnThreshold: this.warnThreshold,
      },
      activeScenarios,
      triggeredCombinations,
      scenarioBreakdown,
      confidence,
    };
  }

  private buildScenarioScoresFromInputs(
    ruleResults: RuleMatchResult[],
    l1Result: L1DetectionResult,
  ): Map<string, ScenarioScore> {
    const l0Score =
      ruleResults.length > 0
        ? Math.max(...ruleResults.map((match) => match.confidence))
        : 0;

    const scenarioScores = new Map<string, ScenarioScore>();
    scenarioScores.set('rule_engine', {
      scenario: 'rule_engine',
      score: l0Score,
      isAnomaly: ruleResults.some(
        (match) => match.action === 'BLOCK' || match.action === 'WARN',
      ),
      indicators: ruleResults.map((match) => match.ruleId),
    });
    scenarioScores.set('statistical_engine', {
      scenario: 'statistical_engine',
      score: l1Result.combinedScore,
      isAnomaly: l1Result.isAnomaly,
      indicators: this.buildL1Indicators(l1Result),
    });

    for (const match of ruleResults) {
      const scenarioKey = RULE_ID_SCENARIO_MAP[match.ruleId];
      if (scenarioKey === undefined) {
        continue;
      }
      this.upsertScenarioScore(
        scenarioScores,
        scenarioKey,
        match.confidence,
        match.action === 'BLOCK' || match.action === 'WARN',
        match.ruleId,
      );
    }

    const frequencyScore = Math.max(
      l1Result.frequency.anomalyScore,
      l1Result.frequency.isAnomaly ? Math.max(l1Result.combinedScore, 0.5) : 0,
    );
    if (frequencyScore > 0 || l1Result.frequency.isAnomaly) {
      this.upsertScenarioScore(
        scenarioScores,
        'frequency_anomaly',
        frequencyScore,
        l1Result.frequency.isAnomaly,
        `l1:frequency:${l1Result.frequency.toolName || 'unknown'}`,
      );
    }

    const markovScore = Math.max(
      l1Result.markov.anomalyScore,
      l1Result.markov.isAnomaly ? Math.max(l1Result.combinedScore, 0.5) : 0,
    );
    if (markovScore > 0 || l1Result.markov.isAnomaly) {
      this.upsertScenarioScore(
        scenarioScores,
        'tool_chain_abuse',
        markovScore,
        l1Result.markov.isAnomaly,
        'l1:markov:sequence',
      );
      this.upsertScenarioScore(
        scenarioScores,
        'goal_hijacking',
        markovScore,
        l1Result.markov.isAnomaly,
        'l1:markov:goal_consistency',
      );
    }

    const chainDepthDim = l1Result.zScore.dimensionScores['chain_depth'];
    if (chainDepthDim !== undefined) {
      const chainScore = Math.max(
        chainDepthDim.anomalyScore,
        chainDepthDim.isAnomaly ? Math.max(l1Result.combinedScore, 0.4) : 0,
      );
      if (chainScore > 0 || chainDepthDim.isAnomaly) {
        this.upsertScenarioScore(
          scenarioScores,
          'tool_chain_abuse',
          chainScore,
          chainDepthDim.isAnomaly,
          'l1:zscore:chain_depth',
        );
      }
    }

    const consecutiveDim = l1Result.zScore.dimensionScores['metadata_consecutive_failures'];
    if (consecutiveDim !== undefined) {
      const probeScore = Math.max(
        consecutiveDim.anomalyScore,
        consecutiveDim.isAnomaly ? Math.max(l1Result.combinedScore, 0.4) : 0,
      );
      if (probeScore > 0 || consecutiveDim.isAnomaly) {
        this.upsertScenarioScore(
          scenarioScores,
          'permission_probing',
          probeScore,
          consecutiveDim.isAnomaly,
          'l1:zscore:metadata_consecutive_failures',
        );
      }
    }

    const transferDim = l1Result.zScore.dimensionScores['transfer_amount'];
    const argCountDim = l1Result.zScore.dimensionScores['arg_count'];
    const tamperScore = Math.max(
      transferDim?.anomalyScore ?? 0,
      argCountDim?.anomalyScore ?? 0,
      transferDim?.isAnomaly || argCountDim?.isAnomaly
        ? Math.max(l1Result.combinedScore, 0.4)
        : 0,
    );
    if (
      tamperScore > 0 ||
      transferDim?.isAnomaly === true ||
      argCountDim?.isAnomaly === true
    ) {
      this.upsertScenarioScore(
        scenarioScores,
        'parameter_tampering',
        tamperScore,
        transferDim?.isAnomaly === true || argCountDim?.isAnomaly === true,
        transferDim !== undefined ? 'l1:zscore:transfer_amount' : 'l1:zscore:arg_count',
      );
    }

    const latencyDim = l1Result.zScore.dimensionScores['latency'];
    if (latencyDim !== undefined) {
      const timingScore = Math.max(
        latencyDim.anomalyScore,
        latencyDim.isAnomaly ? Math.max(l1Result.combinedScore, 0.4) : 0,
      );
      if (timingScore > 0 || latencyDim.isAnomaly) {
        this.upsertScenarioScore(
          scenarioScores,
          'timing_anomaly',
          timingScore,
          latencyDim.isAnomaly,
          'l1:zscore:latency',
        );
      }
    }

    return scenarioScores;
  }

  private upsertScenarioScore(
    scenarioScores: Map<string, ScenarioScore>,
    scenario: string,
    score: number,
    isAnomaly: boolean,
    indicator: string,
  ): void {
    const existing = scenarioScores.get(scenario);
    if (existing === undefined) {
      scenarioScores.set(scenario, {
        scenario,
        score,
        isAnomaly,
        indicators: [indicator],
      });
      return;
    }

    existing.score = Math.max(existing.score, score);
    existing.isAnomaly = existing.isAnomaly || isAnomaly;
    if (!existing.indicators.includes(indicator)) {
      existing.indicators.push(indicator);
    }
  }

  private normalizeL1Result(l1Result: L1DetectionResult): L1DetectionResult {
    const toolName = l1Result.frequency?.toolName?.trim() ?? '';
    const hasToolContext = toolName.length > 0;
    const hasSequenceSignal =
      (l1Result.markov?.anomalyScore ?? 0) > 0 ||
      (l1Result.markov?.unknownRatio ?? 0) > 0;

    if (hasToolContext || hasSequenceSignal) {
      return l1Result;
    }

    return {
      ...l1Result,
      combinedScore: 0,
      isAnomaly: false,
      frequency: {
        ...l1Result.frequency,
        toolName: toolName || 'unknown',
        anomalyScore: 0,
        isAnomaly: false,
      },
      markov: {
        ...l1Result.markov,
        anomalyScore: 0,
        isAnomaly: false,
      },
    };
  }

  private buildL1Indicators(l1Result: L1DetectionResult): string[] {
    const indicators: string[] = [];
    if (l1Result.isAnomaly) {
      indicators.push('l1_combined_anomaly');
    }
    if (l1Result.zScore.isAnomaly) {
      indicators.push(`zscore:${l1Result.zScore.maxDimension || 'unknown'}`);
    }
    if (l1Result.frequency.isAnomaly) {
      indicators.push(`frequency:${l1Result.frequency.toolName || 'unknown'}`);
    }
    if (l1Result.markov.isAnomaly) {
      indicators.push('markov:sequence');
    }
    return indicators;
  }

  private resolveL0Action(ruleResults: RuleMatchResult[]): RuleAction {
    if (ruleResults.length === 0) {
      return 'ALLOW';
    }

    let worst: RuleAction = 'ALLOW';
    for (const match of ruleResults) {
      if (ACTION_PRIORITY[match.action] > ACTION_PRIORITY[worst]) {
        worst = match.action;
      }
    }
    return worst;
  }

  private classifyL1Level(l1Result: L1DetectionResult): 'HIGH' | 'MEDIUM' | 'LOW' {
    if (l1Result.combinedScore >= L1_HIGH_SCORE_THRESHOLD || l1Result.isAnomaly) {
      return 'HIGH';
    }
    if (l1Result.combinedScore >= L1_MEDIUM_SCORE_THRESHOLD) {
      return 'MEDIUM';
    }
    return 'LOW';
  }

  private mergeDecisions(
    l0Action: RuleAction,
    l1Level: 'HIGH' | 'MEDIUM' | 'LOW',
    enhancedScore: number,
  ): FusionDecision {
    if (l0Action === 'BLOCK' || enhancedScore >= this.blockThreshold) {
      return 'BLOCK';
    }

    if (l0Action === 'WARN' || l1Level === 'HIGH' || enhancedScore >= this.warnThreshold) {
      if (l0Action === 'ALLOW' && (l1Level === 'LOW' || l1Level === 'MEDIUM')) {
        return 'ALLOW';
      }
      return 'WARN';
    }

    return 'ALLOW';
  }

  private decideFromScore(score: number): FusionDecision {
    if (score >= this.blockThreshold) {
      return 'BLOCK';
    }
    if (score >= this.warnThreshold) {
      return 'WARN';
    }
    return 'ALLOW';
  }

  private applyCombinationBoost(
    scenarioScores: Map<string, ScenarioScore>,
    baseScore: number,
  ): { enhancedScore: number; triggeredCombinations: string[] } {
    let enhancedScore = baseScore;
    const triggeredCombinations: string[] = [];

    for (const rule of V0_COMBINATION_RULES) {
      const matched = rule.conditions.every((condition) => {
        const scenario = scenarioScores.get(condition.scenario);
        return scenario !== undefined && scenario.score >= condition.minScore;
      });

      if (matched) {
        triggeredCombinations.push(rule.id);
        enhancedScore *= rule.boostFactor;
        enhancedScore = Math.min(enhancedScore, rule.maxBoostedScore);
      }
    }

    return {
      enhancedScore: Math.min(Math.max(enhancedScore, 0), 1),
      triggeredCombinations,
    };
  }

  private applyCriticalScenarioFallback(
    current: FusionDecision,
    enhancedScore: number,
    activeScenarios: string[],
  ): FusionDecision {
    if (current === 'BLOCK') {
      return current;
    }

    const criticalActive =
      activeScenarios.includes('goal_hijacking') ||
      activeScenarios.includes('parameter_tampering');

    if (criticalActive && enhancedScore >= this.warnThreshold) {
      return 'WARN';
    }

    return current;
  }

  private calculateConfidence(activeScenarios: string[]): number {
    return Math.min(activeScenarios.length / 3, 1);
  }

  private buildAllowFallback(
    scenarioBreakdown: Record<string, ScenarioScore>,
  ): FusionResult {
    return {
      baseScore: 0,
      enhancedScore: 0,
      finalDecision: 'ALLOW',
      threshold: {
        blockThreshold: this.blockThreshold,
        warnThreshold: this.warnThreshold,
      },
      activeScenarios: [],
      triggeredCombinations: [],
      scenarioBreakdown,
      confidence: 0,
    };
  }

  private runWithBudget<T>(
    eventId: string | null,
    operation: () => T,
  ): T {
    const perfStart = performance.now();

    try {
      if (this.injectDecisionDelayMs > 0) {
        const deadline = perfStart + this.decisionBudgetMs;
        while (performance.now() - deadline < this.injectDecisionDelayMs) {
          // busy wait for deterministic timeout testing
        }
      }

      const result = operation();
      const durationMs = performance.now() - perfStart;

      if (durationMs > this.decisionBudgetMs) {
        throw this.createStructuredError(
          `Decision router exceeded budget elapsedMs=${durationMs.toFixed(3)}`,
          eventId,
          RiskType.DECISION_ROUTER_TIMEOUT,
          new Error(`Exceeded decisionBudgetMs=${String(this.decisionBudgetMs)}`),
        );
      }

      this.logPerformance('decide', perfStart, this.decisionBudgetMs);
      return result;
    } catch (cause) {
      if (
        cause instanceof Error &&
        'riskType' in cause &&
        (cause as Error & { riskType?: string }).riskType === RiskType.DECISION_ROUTER_TIMEOUT
      ) {
        throw cause;
      }

      throw this.createStructuredError(
        'Decision router evaluation failed',
        eventId,
        RiskType.DECISION_ROUTER_EVAL_FAILED,
        cause,
      );
    }
  }

  private logPerformance(
    operation: string,
    startMs: number,
    budgetMs: number,
  ): void {
    const durationMs = performance.now() - startMs;
    const withinBudget = durationMs <= budgetMs;
    console.info(
      `[DecisionRouter][perf] op=${operation} durationMs=${durationMs.toFixed(3)} budgetMs=${String(budgetMs)} withinBudget=${String(withinBudget)}`,
    );
  }

  private createStructuredError(
    message: string,
    eventId: string | null,
    riskType: string,
    cause: unknown,
  ): Error {
    const base =
      cause instanceof Error
        ? cause
        : new Error(typeof cause === 'string' ? cause : JSON.stringify(cause));

    const err = new Error(message, { cause: base });
    Object.assign(err, {
      eventId,
      riskType,
      originalStack: base.stack ?? String(cause),
    });
    return err;
  }
}
