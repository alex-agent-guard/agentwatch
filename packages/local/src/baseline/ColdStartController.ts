/**
 * 三级冷启动策略 — 0-10 L1 / 10-100 L2 / 100+ L3
 * 动态调整 Z-score 阈值与拦截敏感度
 */
export type ColdStartTier = 'L1' | 'L2' | 'L3';

export interface ColdStartPolicy {
  tier: ColdStartTier;
  zScoreThreshold: number;
  coldStartMinSamples: number;
  /** 基线偏离分权重 — 冷启动期间降低 */
  deviationWeight: number;
  /** 是否允许 BLOCK 决策由基线单独触发 */
  allowBaselineBlock: boolean;
}

const TIER_L1_MAX = 10;
const TIER_L2_MAX = 100;

export class ColdStartController {
  resolveTier(totalCalls: number): ColdStartTier {
    if (totalCalls < TIER_L1_MAX) {
      return 'L1';
    }
    if (totalCalls < TIER_L2_MAX) {
      return 'L2';
    }
    return 'L3';
  }

  /** 根据累计调用次数生成检测策略 */
  buildPolicy(totalCalls: number, baseZScoreThreshold: number): ColdStartPolicy {
    const tier = this.resolveTier(totalCalls);

    switch (tier) {
      case 'L1':
        return {
          tier,
          zScoreThreshold: Math.max(baseZScoreThreshold, 5),
          coldStartMinSamples: 10,
          deviationWeight: 0.05,
          allowBaselineBlock: false,
        };
      case 'L2':
        return {
          tier,
          zScoreThreshold: Math.max(baseZScoreThreshold, 3.5),
          coldStartMinSamples: 30,
          deviationWeight: 0.1,
          allowBaselineBlock: false,
        };
      case 'L3':
        return {
          tier,
          zScoreThreshold: baseZScoreThreshold,
          coldStartMinSamples: 30,
          deviationWeight: 0.15,
          allowBaselineBlock: true,
        };
    }
  }
}
