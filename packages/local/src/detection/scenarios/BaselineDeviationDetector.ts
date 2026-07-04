/**
 * BaselineDeviationDetector — 行为基线偏离独立场景检测
 * 从 L1 StatEngine 抽离 Z-score 基线偏离逻辑，固定场景键 baseline_deviation
 */
import type { BaselineService } from '../../baseline/BaselineService.js';

import type {
  DetectionEvent,
  L1BehaviorDimensions,
  ScenarioScore,
} from '@packages/shared/types';

export const BASELINE_DEVIATION_SCENARIO = 'baseline_deviation';

export interface BaselineDeviationDetectorOptions {
  enabled: boolean;
  baselineService: BaselineService;
}

export interface BaselineDeviationDimensionScores {
  toolFrequency: number;
  paramVariance: number;
  temporal: number;
}

export class BaselineDeviationDetector {
  private readonly enabled: boolean;
  private readonly baselineService: BaselineService;

  constructor(options: BaselineDeviationDetectorOptions) {
    this.enabled = options.enabled;
    this.baselineService = options.baselineService;
  }

  /** L1 之后同步评估 — enabled=false 时直接返回 null */
  assess(
    event: DetectionEvent,
    dimensions: L1BehaviorDimensions,
  ): ScenarioScore | null {
    try {
      if (!this.enabled) {
        return null;
      }

      const aggregated = this.aggregateDeviationScores(
        event.tool.name,
        dimensions,
        event.request.timestamp,
      );
      if (aggregated === null) {
        return null;
      }

      return {
        scenario: BASELINE_DEVIATION_SCENARIO,
        score: aggregated.score,
        isAnomaly: aggregated.score >= 0.5,
        indicators: aggregated.indicators,
      };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      console.error(`[BaselineDeviationDetector] assess failed: ${message}`);
      return null;
    }
  }

  /** 暴露三维得分 — 供测试与诊断 */
  computeDimensionScores(
    toolName: string,
    dimensions: L1BehaviorDimensions,
    timestamp: number,
  ): BaselineDeviationDimensionScores {
    return {
      toolFrequency: this.computeToolFrequencyDeviation(toolName),
      paramVariance: this.computeParamVarianceDeviation(dimensions),
      temporal: this.computeTemporalDeviation(timestamp),
    };
  }

  private aggregateDeviationScores(
    toolName: string,
    dimensions: L1BehaviorDimensions,
    timestamp: number,
  ): { score: number; indicators: string[] } | null {
    const scores: number[] = [];
    const indicators: string[] = [];

    const snapshot = this.baselineService.exportSnapshot();
    const totalToolCalls = Object.values(snapshot.toolFrequency).reduce(
      (sum, count) => sum + count,
      0,
    );
    if (totalToolCalls > 0) {
      const toolScore = this.computeToolFrequencyDeviation(toolName);
      scores.push(toolScore);
      indicators.push('baseline:tool_frequency');
    }

    for (const [dimension, rawValue] of Object.entries(dimensions)) {
      const value = Number.isFinite(rawValue) ? rawValue : 0;
      const score = this.baselineService.getParamAnomalyScore(dimension, value);
      if (score > 0) {
        scores.push(score);
        indicators.push(`baseline:param:${dimension}`);
      }
    }

    const hourlyTotal = snapshot.hourlyActivity.reduce((sum, count) => sum + count, 0);
    if (hourlyTotal > 0) {
      const temporalScore = this.computeTemporalDeviation(timestamp);
      scores.push(temporalScore);
      const hour = new Date(timestamp).getHours();
      indicators.push(`baseline:temporal:hour_${String(hour)}`);
    }

    if (scores.length === 0) {
      return null;
    }

    const score = scores.reduce((sum, entry) => sum + entry, 0) / scores.length;
    return { score, indicators };
  }

  /** 工具调用频次偏离 — 对齐 BaselineService.computeDeviationScore */
  private computeToolFrequencyDeviation(toolName: string): number {
    const toolCount = this.baselineService.getToolFrequency(toolName);
    const snapshot = this.baselineService.exportSnapshot();
    const totalToolCalls = Object.values(snapshot.toolFrequency).reduce(
      (sum, count) => sum + count,
      0,
    );
    if (totalToolCalls <= 0) {
      return 0;
    }

    const expectedShare = toolCount / totalToolCalls;
    const observedShare =
      1 / Math.max(1, Object.keys(snapshot.toolFrequency).length);
    return Math.min(1, Math.abs(observedShare - expectedShare) * 4);
  }

  /** 参数数值方差偏离 — 对齐 BaselineService.computeDeviationScore */
  private computeParamVarianceDeviation(dimensions: L1BehaviorDimensions): number {
    const scores: number[] = [];
    for (const [dimension, rawValue] of Object.entries(dimensions)) {
      const value = Number.isFinite(rawValue) ? rawValue : 0;
      const score = this.baselineService.getParamAnomalyScore(dimension, value);
      if (score > 0) {
        scores.push(score);
      }
    }
    if (scores.length === 0) {
      return 0;
    }
    return scores.reduce((sum, entry) => sum + entry, 0) / scores.length;
  }

  /** 调用时段偏离 — 与频次偏离同尺度 (×4)，低活跃时段强化 */
  private computeTemporalDeviation(timestamp: number): number {
    const hourly = this.baselineService.getHourlyActivity();
    const total = hourly.reduce((sum, count) => sum + count, 0);
    if (total <= 0) {
      return 0;
    }

    const hour = new Date(timestamp).getHours();
    const hourCount = hourly[hour] ?? 0;
    const expectedShare = hourCount / total;
    const observedShare = 1 / 24;
    const scaledDeviation = Math.min(1, Math.abs(observedShare - expectedShare) * 4);

    if (expectedShare < 0.01) {
      return Math.min(1, Math.max(scaledDeviation, 1 - expectedShare * 24));
    }
    return scaledDeviation;
  }
}
