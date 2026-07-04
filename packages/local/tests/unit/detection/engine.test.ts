import { describe, expect, it, vi } from 'vitest';

import { DecisionRouter } from '../../../src/detection/DecisionRouter.js';

import type {
  L1DetectionResult,
  RuleMatchResult,
  ScenarioScore,
} from '@packages/shared/types';

type StructuredDecisionError = Error & {
  eventId?: string | null;
  riskType?: string;
  originalStack?: string;
};

function assertStructuredDecisionError(
  error: unknown,
  expected: { riskType: string; eventId?: string | null },
): asserts error is StructuredDecisionError {
  expect(error).toBeInstanceOf(Error);
  const structured = error as StructuredDecisionError;
  expect(structured.riskType).toBe(expected.riskType);
  if (expected.eventId !== undefined) {
    expect(structured.eventId).toBe(expected.eventId);
  }
  expect(structured.originalStack).toBeTruthy();
}

function buildRuleMatch(
  overrides: Partial<RuleMatchResult> &
    Pick<RuleMatchResult, 'ruleId' | 'action'>,
): RuleMatchResult {
  return {
    ruleName: overrides.ruleName ?? overrides.ruleId,
    severity: overrides.severity ?? 'HIGH',
    matchedConditions: overrides.matchedConditions ?? ['c1'],
    confidence: overrides.confidence ?? 0.9,
    matchedFields: overrides.matchedFields ?? { 'tool.name': 'transfer' },
    timestamp: overrides.timestamp ?? Date.now(),
    ...overrides,
  };
}

function buildL1Result(overrides?: Partial<L1DetectionResult>): L1DetectionResult {
  const combinedScore = overrides?.combinedScore ?? 0.1;
  const isAnomaly = overrides?.isAnomaly ?? combinedScore >= 0.7;

  return {
    zScore: {
      combinedScore,
      maxZScore: overrides?.zScore?.maxZScore ?? 1,
      maxDimension: overrides?.zScore?.maxDimension ?? 'chain_depth',
      dimensionScores: overrides?.zScore?.dimensionScores ?? {},
      isAnomaly: overrides?.zScore?.isAnomaly ?? isAnomaly,
      confidence: overrides?.zScore?.confidence ?? 0.5,
    },
    frequency: {
      toolName: overrides?.frequency?.toolName ?? 'read_file',
      frequencies: overrides?.frequency?.frequencies ?? {
        '1m': 1,
        '5m': 1,
        '1h': 1,
        '1d': 1,
      },
      anomalyScore: overrides?.frequency?.anomalyScore ?? 0.1,
      isAnomaly: overrides?.frequency?.isAnomaly ?? false,
    },
    markov: {
      logProbability: overrides?.markov?.logProbability ?? -1,
      perplexity: overrides?.markov?.perplexity ?? 1,
      anomalyScore: overrides?.markov?.anomalyScore ?? 0.1,
      isAnomaly: overrides?.markov?.isAnomaly ?? false,
    },
    combinedScore,
    isAnomaly,
    latencyMs: overrides?.latencyMs ?? 1,
    ...(overrides?.cusum !== undefined ? { cusum: overrides.cusum } : {}),
    ...(overrides?.ewma !== undefined ? { ewma: overrides.ewma } : {}),
  };
}

function buildScenarioScores(entries: Record<string, ScenarioScore>): Map<string, ScenarioScore> {
  return new Map(Object.entries(entries));
}

function createRouter(
  overrides?: ConstructorParameters<typeof DecisionRouter>[0],
): DecisionRouter {
  return new DecisionRouter({ decisionBudgetMs: 50, ...overrides });
}

describe('DecisionRouter', () => {
  it('L0 BLOCK + L1任意分 → 最终阻断', () => {
    const router = createRouter();
    const result = router.detect(
      [buildRuleMatch({ ruleId: 'BLOCK_001', action: 'BLOCK', confidence: 0.95 })],
      buildL1Result({ combinedScore: 0.2, isAnomaly: false }),
      'evt-block-1',
    );

    expect(result.finalDecision).toBe('BLOCK');
    expect(result.enhancedScore).toBeGreaterThanOrEqual(0.8);
    expect(result.activeScenarios).toContain('rule_engine');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('L0 WARN + L1 HIGH → 告警', () => {
    const router = createRouter();
    const result = router.detect(
      [buildRuleMatch({ ruleId: 'WARN_001', action: 'WARN', confidence: 0.65 })],
      buildL1Result({ combinedScore: 0.75, isAnomaly: true }),
      'evt-warn-1',
    );

    expect(result.finalDecision).toBe('WARN');
    expect(result.scenarioBreakdown.rule_engine?.indicators).toContain('WARN_001');
    expect(result.scenarioBreakdown.statistical_engine?.isAnomaly).toBe(true);
  });

  it('L0 ALLOW + L1 LOW/MEDIUM → 放行', () => {
    const router = createRouter();

    const lowResult = router.detect([], buildL1Result({ combinedScore: 0.15, isAnomaly: false }));
    expect(lowResult.finalDecision).toBe('ALLOW');

    const mediumResult = router.detect(
      [],
      buildL1Result({ combinedScore: 0.45, isAnomaly: false }),
    );
    expect(mediumResult.finalDecision).toBe('ALLOW');
  });

  it('空规则、空时序样本、无 tool 字段边界用例 → ALLOW 兜底', () => {
    const router = createRouter();

    const emptyDetect = router.detect([], buildL1Result({ combinedScore: 0, isAnomaly: false }));
    expect(emptyDetect.finalDecision).toBe('ALLOW');
    expect(emptyDetect.baseScore).toBe(0);
    expect(emptyDetect.activeScenarios).toEqual([]);

    const emptyDecide = router.decide(new Map<string, ScenarioScore>());
    expect(emptyDecide.finalDecision).toBe('ALLOW');
    expect(emptyDecide.confidence).toBe(0);

    const noToolResult = router.detect(
      [],
      buildL1Result({
        combinedScore: 0.9,
        isAnomaly: true,
        frequency: {
          toolName: '',
          frequencies: { '1m': 0, '5m': 0, '1h': 0, '1d': 0 },
          anomalyScore: 0,
          isAnomaly: false,
        },
        markov: {
          logProbability: 0,
          perplexity: 0,
          anomalyScore: 0,
          isAnomaly: false,
        },
      }),
    );
    expect(noToolResult.finalDecision).toBe('ALLOW');
    expect(noToolResult.scenarioBreakdown.statistical_engine?.score).toBe(0);
  });

  it('decide() 融合 scenarioScores 并输出 confidence', () => {
    const router = createRouter();
    const scores = buildScenarioScores({
      rule_engine: {
        scenario: 'rule_engine',
        score: 0.92,
        isAnomaly: true,
        indicators: ['GOAL_HIJACK_001'],
      },
      statistical_engine: {
        scenario: 'statistical_engine',
        score: 0.3,
        isAnomaly: false,
        indicators: [],
      },
    });

    const result = router.decide(scores);
    expect(result.finalDecision).toBe('BLOCK');
    expect(result.scenarioBreakdown.rule_engine?.indicators).toEqual(['GOAL_HIJACK_001']);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('决策超时捕获结构化错误', () => {
    const router = new DecisionRouter({
      decisionBudgetMs: 0,
      injectDecisionDelayMs: 2,
    });

    try {
      router.detect(
        [buildRuleMatch({ ruleId: 'SLOW_001', action: 'ALLOW' })],
        buildL1Result(),
        'evt-timeout-1',
      );
      expect.unreachable('expected decision router timeout');
    } catch (error) {
      assertStructuredDecisionError(error, {
        riskType: 'DECISION_ROUTER_TIMEOUT',
        eventId: 'evt-timeout-1',
      });
      expect((error as Error).message).toMatch(
        /Decision router exceeded budget elapsedMs=\d+\.\d{3}/,
      );
    }
  });

  it('输出决策性能日志', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const router = createRouter({ decisionBudgetMs: 1 });

    router.detect([], buildL1Result());

    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^\[DecisionRouter\]\[perf\] op=decide durationMs=\d+\.\d{3} budgetMs=1 withinBudget=(true|false)$/),
    );

    infoSpy.mockRestore();
  });

  describe('V0_COMBINATION_RULES boost', () => {
    it('high_value_transfer — parameter_tampering + tool_chain_abuse 联动 boost', () => {
      const router = createRouter();
      const result = router.detect(
        [
          buildRuleMatch({
            ruleId: 'PARAM_TAMPER_001',
            action: 'BLOCK',
            confidence: 0.65,
          }),
          buildRuleMatch({
            ruleId: 'CHAIN_ABUSE_001',
            action: 'BLOCK',
            confidence: 0.45,
          }),
        ],
        buildL1Result({ combinedScore: 0.1, isAnomaly: false }),
        'evt-combo-transfer',
      );

      expect(result.triggeredCombinations).toContain('high_value_transfer');
      expect(result.enhancedScore).toBeGreaterThan(result.baseScore);
      expect(result.enhancedScore).toBeLessThanOrEqual(0.99);
      expect(result.scenarioBreakdown.parameter_tampering?.score).toBeGreaterThanOrEqual(
        0.6,
      );
      expect(result.scenarioBreakdown.tool_chain_abuse?.score).toBeGreaterThanOrEqual(0.4);
    });

    it('coordinated_attack — goal_hijacking + prompt_injection 联动 boost 且 capped', () => {
      const router = createRouter();
      const result = router.detect(
        [
          buildRuleMatch({
            ruleId: 'GOAL_HIJACK_001',
            action: 'BLOCK',
            confidence: 0.55,
          }),
          buildRuleMatch({
            ruleId: 'PROMPT_INJ_001',
            action: 'WARN',
            confidence: 0.45,
          }),
        ],
        buildL1Result({ combinedScore: 0.05, isAnomaly: false }),
        'evt-combo-attack',
      );

      expect(result.triggeredCombinations).toContain('coordinated_attack');
      expect(result.enhancedScore).toBeLessThanOrEqual(0.95);
      expect(result.scenarioBreakdown.goal_hijacking?.score).toBeGreaterThanOrEqual(0.5);
      expect(result.scenarioBreakdown.prompt_injection?.score).toBeGreaterThanOrEqual(0.4);
    });

    it('rapid_probing — permission_probing + frequency_anomaly 联动 boost', () => {
      const router = createRouter();
      const result = router.detect(
        [
          buildRuleMatch({
            ruleId: 'PERM_PROBE_001',
            action: 'WARN',
            confidence: 0.65,
          }),
        ],
        buildL1Result({
          combinedScore: 0.2,
          isAnomaly: true,
          frequency: {
            toolName: 'read_file',
            frequencies: { '1m': 120, '5m': 120, '1h': 120, '1d': 120 },
            anomalyScore: 0.55,
            isAnomaly: true,
          },
        }),
        'evt-combo-probe',
      );

      expect(result.triggeredCombinations).toContain('rapid_probing');
      expect(result.scenarioBreakdown.permission_probing?.score).toBeGreaterThanOrEqual(0.6);
      expect(result.scenarioBreakdown.frequency_anomaly?.score).toBeGreaterThanOrEqual(0.5);
      expect(result.enhancedScore).toBeLessThanOrEqual(0.95);
    });

    it('多场景叠加 boost 全部触发且分值受 maxBoostedScore 上限约束', () => {
      const router = createRouter();
      const result = router.detect(
        [
          buildRuleMatch({
            ruleId: 'PARAM_TAMPER_001',
            action: 'BLOCK',
            confidence: 0.85,
          }),
          buildRuleMatch({
            ruleId: 'CHAIN_ABUSE_001',
            action: 'BLOCK',
            confidence: 0.75,
          }),
          buildRuleMatch({
            ruleId: 'GOAL_HIJACK_001',
            action: 'BLOCK',
            confidence: 0.7,
          }),
          buildRuleMatch({
            ruleId: 'PROMPT_INJ_001',
            action: 'WARN',
            confidence: 0.65,
          }),
          buildRuleMatch({
            ruleId: 'PERM_PROBE_001',
            action: 'WARN',
            confidence: 0.7,
          }),
        ],
        buildL1Result({
          combinedScore: 0.3,
          isAnomaly: true,
          frequency: {
            toolName: 'read_file',
            frequencies: { '1m': 150, '5m': 150, '1h': 150, '1d': 150 },
            anomalyScore: 0.8,
            isAnomaly: true,
          },
        }),
        'evt-multi-boost',
      );

      expect(result.triggeredCombinations).toEqual(
        expect.arrayContaining([
          'high_value_transfer',
          'coordinated_attack',
          'rapid_probing',
        ]),
      );
      expect(result.enhancedScore).toBeLessThanOrEqual(0.99);
      expect(result.enhancedScore).toBeGreaterThan(result.baseScore);
    });

    it('单场景不满足 minScore 时不触发对应组合 boost', () => {
      const router = createRouter();
      const result = router.detect(
        [
          buildRuleMatch({
            ruleId: 'PARAM_TAMPER_001',
            action: 'BLOCK',
            confidence: 0.65,
          }),
          buildRuleMatch({
            ruleId: 'CHAIN_ABUSE_001',
            action: 'BLOCK',
            confidence: 0.35,
          }),
        ],
        buildL1Result({ combinedScore: 0.1, isAnomaly: false }),
        'evt-partial-combo',
      );

      expect(result.triggeredCombinations).not.toContain('high_value_transfer');
      expect(result.scenarioBreakdown.tool_chain_abuse?.score).toBe(0.35);
    });

    it('三类组合 boost 下限 — 各组合 enhancedScore 严格高于 baseScore', () => {
      const router = createRouter();
      const cases = [
        {
          combo: 'high_value_transfer',
          rules: [
            buildRuleMatch({ ruleId: 'PARAM_TAMPER_001', action: 'BLOCK', confidence: 0.65 }),
            buildRuleMatch({ ruleId: 'CHAIN_ABUSE_001', action: 'BLOCK', confidence: 0.45 }),
          ],
          l1: buildL1Result({ combinedScore: 0.1, isAnomaly: false }),
        },
        {
          combo: 'coordinated_attack',
          rules: [
            buildRuleMatch({ ruleId: 'GOAL_HIJACK_001', action: 'BLOCK', confidence: 0.55 }),
            buildRuleMatch({ ruleId: 'PROMPT_INJ_001', action: 'WARN', confidence: 0.45 }),
          ],
          l1: buildL1Result({ combinedScore: 0.05, isAnomaly: false }),
        },
        {
          combo: 'rapid_probing',
          rules: [buildRuleMatch({ ruleId: 'PERM_PROBE_001', action: 'WARN', confidence: 0.65 })],
          l1: buildL1Result({
            combinedScore: 0.2,
            isAnomaly: true,
            frequency: {
              toolName: 'read_file',
              frequencies: { '1m': 120, '5m': 120, '1h': 120, '1d': 120 },
              anomalyScore: 0.7,
              isAnomaly: true,
            },
          }),
        },
      ] as const;

      for (const testCase of cases) {
        const result = router.detect(
          [...testCase.rules],
          testCase.l1,
          `evt-boost-${testCase.combo}`,
        );
        expect(result.triggeredCombinations).toContain(testCase.combo);
        expect(result.enhancedScore).toBeGreaterThan(result.baseScore);
      }
    });

    it('纯 L1 markov 异常映射 tool_chain_abuse 场景键（无 L0 CHAIN 规则）', () => {
      const router = createRouter();
      const result = router.detect(
        [],
        buildL1Result({
          combinedScore: 0.75,
          isAnomaly: true,
          markov: {
            logProbability: -4,
            perplexity: 12,
            anomalyScore: 0.82,
            isAnomaly: true,
          },
        }),
        'evt-l1-markov-chain',
      );

      expect(result.scenarioBreakdown.tool_chain_abuse?.score).toBeGreaterThanOrEqual(0.5);
      expect(result.scenarioBreakdown.tool_chain_abuse?.isAnomaly).toBe(true);
      expect(result.scenarioBreakdown.tool_chain_abuse?.indicators).toContain(
        'l1:markov:sequence',
      );
    });

    it('纯 L1 chain_depth Z-score 映射 tool_chain_abuse，可与 L0 parameter_tampering 联动 boost', () => {
      const router = createRouter();
      const result = router.detect(
        [
          buildRuleMatch({
            ruleId: 'PARAM_TAMPER_001',
            action: 'BLOCK',
            confidence: 0.65,
          }),
        ],
        buildL1Result({
          combinedScore: 0.55,
          isAnomaly: true,
          zScore: {
            combinedScore: 0.55,
            maxZScore: 4.2,
            maxDimension: 'chain_depth',
            dimensionScores: {
              chain_depth: {
                value: 8,
                mean: 2,
                stdDev: 1,
                zScore: 4.2,
                anomalyScore: 0.72,
                isAnomaly: true,
              },
            },
            isAnomaly: true,
            confidence: 0.8,
          },
        }),
        'evt-l1-zscore-chain',
      );

      expect(result.scenarioBreakdown.tool_chain_abuse?.score).toBeGreaterThanOrEqual(0.4);
      expect(result.scenarioBreakdown.tool_chain_abuse?.indicators).toContain(
        'l1:zscore:chain_depth',
      );
      expect(result.scenarioBreakdown.parameter_tampering?.score).toBeGreaterThanOrEqual(0.6);
      expect(result.triggeredCombinations).toContain('high_value_transfer');
    });
  });
});
