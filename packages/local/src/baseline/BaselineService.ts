/**
 * BaselineService — 三维行为基线总控
 * 统计持久化委托 StatBaseline；冷启动 / 偏离检测逻辑不变
 */
import { BaselineStorage } from './BaselineStorage.js';
import { ColdStartController, type ColdStartPolicy } from './ColdStartController.js';
import { StatBaseline } from '../stat/StatBaseline.js';

import type {
  BaselineCache,
  DetectionEvent,
  L1BehaviorDimensions,
  L1StatEngineConfig,
  WelfordStatsState,
} from '@packages/shared/types';

const PROFILE_VERSION = 'v0.1';

export interface BaselineProfileSnapshot {
  version: string;
  totalCalls: number;
  toolFrequency: Record<string, number>;
  paramStats: Record<string, WelfordStatsState>;
  hourlyActivity: number[];
  lastDecayDayKey: string;
}

export interface BaselineObservationInput {
  event: DetectionEvent;
  dimensions: L1BehaviorDimensions;
  isAnomaly: boolean;
  baseZScoreThreshold: number;
}

export interface BaselineServiceOptions {
  userId?: string;
  agentId?: string;
  storage?: BaselineStorage;
  coldStart?: ColdStartController;
  persistEvery?: number;
  /** scenarios.baselineDeviation.monthlyDecay — false 日级（默认），true 月级 */
  monthlyDecay?: boolean;
}

export class BaselineService {
  private readonly storage: BaselineStorage;
  private readonly coldStart: ColdStartController;
  private readonly userId: string;
  private readonly agentId: string;
  private readonly statBaseline: StatBaseline;
  private readonly monthlyDecay: boolean;

  private totalCalls = 0;
  private lastDecayDayKey = '';

  constructor(options?: BaselineServiceOptions) {
    this.storage = options?.storage ?? new BaselineStorage();
    this.coldStart = options?.coldStart ?? new ColdStartController();
    this.userId = options?.userId ?? 'default';
    this.agentId = options?.agentId ?? 'default';
    this.monthlyDecay = options?.monthlyDecay ?? false;

    this.statBaseline = new StatBaseline(this.storage, this.userId, this.agentId, {
      exportMetadata: () => ({
        totalCalls: this.totalCalls,
        lastDecayDayKey: this.lastDecayDayKey,
      }),
      importMetadata: (raw) => {
        if (typeof raw['totalCalls'] === 'number') {
          this.totalCalls = raw['totalCalls'];
        }
        if (typeof raw['lastDecayDayKey'] === 'string') {
          this.lastDecayDayKey = raw['lastDecayDayKey'];
        }
      },
    });
  }

  /** 启动时从 SQLite 恢复 — StatBaseline 构造时已 load */
  hydrateFromStorage(): BaselineCache | null {
    try {
      if (this.statBaseline.getTotalUpdates() === 0 && this.totalCalls === 0) {
        return null;
      }
      return this.exportBaselineCache();
    } catch (cause) {
      console.error('[BaselineService] hydrateFromStorage failed', cause);
      return null;
    }
  }

  getDetectionPolicy(baseZScoreThreshold: number): ColdStartPolicy {
    return this.coldStart.buildPolicy(this.totalCalls, baseZScoreThreshold);
  }

  computeDeviationScore(
    toolName: string,
    dimensions: L1BehaviorDimensions,
  ): number {
    const scores: number[] = [];

    const toolCount = this.statBaseline.getToolFrequency(toolName);
    const snapshot = this.statBaseline.exportSnapshot();
    const totalToolCalls = Object.values(snapshot.toolFrequency).reduce(
      (sum, count) => sum + count,
      0,
    );
    if (totalToolCalls > 0) {
      const expectedShare = toolCount / totalToolCalls;
      const observedShare = 1 / Math.max(1, Object.keys(snapshot.toolFrequency).length);
      scores.push(Math.min(1, Math.abs(observedShare - expectedShare) * 4));
    }

    for (const [dimension, rawValue] of Object.entries(dimensions)) {
      const value = Number.isFinite(rawValue) ? rawValue : 0;
      const score = this.statBaseline.getParamAnomalyScore(dimension, value);
      if (score > 0) {
        scores.push(score);
      }
    }

    if (scores.length === 0) {
      return 0;
    }
    return scores.reduce((sum, score) => sum + score, 0) / scores.length;
  }

  recordObservation(input: BaselineObservationInput): void {
    try {
      this.applyPeriodicDecayIfNeeded(input.event.request.timestamp);

      if (!input.isAnomaly) {
        this.statBaseline.update({
          toolName: input.event.tool.name,
          dimensions: input.dimensions,
          timestamp: input.event.request.timestamp,
        });
      }

      this.totalCalls += 1;
    } catch (cause) {
      console.error('[BaselineService] recordObservation failed', cause);
    }
  }

  persist(): void {
    this.statBaseline.persist();
  }

  getTotalCalls(): number {
    return this.totalCalls;
  }

  getToolFrequency(toolName: string): number {
    return this.statBaseline.getToolFrequency(toolName);
  }

  getParamVariance(dimension: string): number {
    return this.statBaseline.getParamVariance(dimension);
  }

  getParamAnomalyScore(dimension: string, value: number): number {
    return this.statBaseline.getParamAnomalyScore(dimension, value);
  }

  getHourlyActivity(): readonly number[] {
    return this.statBaseline.getHourlyActivity();
  }

  exportBaselineCache(): BaselineCache {
    return { dimensions: this.statBaseline.exportParamStats() };
  }

  exportSnapshot(): BaselineProfileSnapshot {
    const snapshot = this.statBaseline.exportSnapshot();
    return {
      version: PROFILE_VERSION,
      totalCalls: this.totalCalls,
      toolFrequency: snapshot.toolFrequency,
      paramStats: snapshot.paramStats,
      hourlyActivity: [...snapshot.hourlyActivity],
      lastDecayDayKey: this.lastDecayDayKey,
    };
  }

  private applyPeriodicDecayIfNeeded(timestamp: number): void {
    const periodKey = this.monthlyDecay
      ? utcMonthKey(timestamp)
      : utcDayKey(timestamp);

    if (this.lastDecayDayKey.length === 0) {
      this.lastDecayDayKey = periodKey;
      return;
    }
    if (periodKey === this.lastDecayDayKey) {
      return;
    }

    this.statBaseline.applyForgetting();
    this.lastDecayDayKey = periodKey;
  }
}

function utcDayKey(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function utcMonthKey(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/** 供 StatEngine 读取的检测阈值覆盖 */
export function toStatEngineOverrides(
  policy: ColdStartPolicy,
): Pick<L1StatEngineConfig, 'zScoreThreshold' | 'coldStartMinSamples'> {
  return {
    zScoreThreshold: policy.zScoreThreshold,
    coldStartMinSamples: policy.coldStartMinSamples,
  };
}
