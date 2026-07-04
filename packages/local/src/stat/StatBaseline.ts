/**
 * StatBaseline — L1 三维行为基线统计（工具频次 / Welford 方差 / 24h 活跃度）
 * 对接 BaselineStorage SQLite 持久化；不改动检测核心算法
 */
import { BaselineStorage } from '../baseline/BaselineStorage.js';

import type { L1BehaviorDimensions, WelfordStatsState } from '@packages/shared/types';

const PERSIST_INTERVAL = 100;
const FORGETTING_FACTOR = 0.95;
const SNAPSHOT_VERSION = 'v0.1';

export interface StatBaselineSnapshot {
  version: string;
  totalUpdates: number;
  totalCalls?: number;
  lastDecayDayKey?: string;
  toolFrequency: Record<string, number>;
  paramStats: Record<string, WelfordStatsState>;
  hourlyActivity: number[];
}

export interface StatBaselineOptions {
  /** 持久化时合并的附加字段 — 如冷启动 totalCalls */
  exportMetadata?: () => Record<string, unknown>;
  /** 从磁盘恢复后回调 — 还原附加字段 */
  importMetadata?: (raw: Record<string, unknown>) => void;
}

export interface StatBaselineUpdateInput {
  toolName: string;
  dimensions: L1BehaviorDimensions;
  timestamp: number;
}

class BaselineWelford {
  private count = 0;
  private mean = 0;
  private m2 = 0;

  update(value: number): void {
    this.count += 1;
    const delta = value - this.mean;
    this.mean += delta / this.count;
    this.m2 += delta * (value - this.mean);
  }

  zScore(value: number): number {
    const variance = this.count < 2 ? 0 : this.m2 / (this.count - 1);
    const std = Math.sqrt(variance);
    if (std === 0) {
      return 0;
    }
    return (value - this.mean) / std;
  }

  anomalyScore(value: number): number {
    const z = Math.abs(this.zScore(value));
    return Math.min(1, z / 4);
  }

  serialize(): WelfordStatsState {
    return { count: this.count, mean: this.mean, m2: this.m2 };
  }

  deserialize(state: WelfordStatsState): void {
    this.count = state.count;
    this.mean = state.mean;
    this.m2 = state.m2;
  }

  applyDecay(factor: number): void {
    if (this.count <= 0) {
      return;
    }
    this.mean *= factor;
    this.m2 *= factor;
    this.count = Math.max(1, Math.round(this.count * factor));
  }
}

export class StatBaseline {
  private readonly storage: BaselineStorage;
  private readonly userId: string;
  private readonly agentId: string;
  private readonly exportMetadata: (() => Record<string, unknown>) | undefined;
  private readonly importMetadata: ((raw: Record<string, unknown>) => void) | undefined;

  private totalUpdates = 0;
  private updatesSincePersist = 0;
  private toolFrequency = new Map<string, number>();
  private paramStats = new Map<string, BaselineWelford>();
  private hourlyActivity = new Array<number>(24).fill(0);

  constructor(
    storage: BaselineStorage,
    userId: string,
    agentId: string,
    options?: StatBaselineOptions,
  ) {
    this.storage = storage;
    this.userId = userId;
    this.agentId = agentId;
    this.exportMetadata = options?.exportMetadata;
    this.importMetadata = options?.importMetadata;
    this.loadFromStorage();
  }

  /** 更新基线统计 — 每累计 100 次自动 persist */
  update(input: StatBaselineUpdateInput): void {
    try {
      const toolName = input.toolName;
      this.toolFrequency.set(toolName, (this.toolFrequency.get(toolName) ?? 0) + 1);

      const hour = new Date(input.timestamp).getUTCHours();
      if (hour >= 0 && hour < 24) {
        this.hourlyActivity[hour] = (this.hourlyActivity[hour] ?? 0) + 1;
      }

      for (const [dimension, rawValue] of Object.entries(input.dimensions)) {
        if (!Number.isFinite(rawValue)) {
          continue;
        }
        this.getOrCreateParamStats(dimension).update(rawValue);
      }

      this.totalUpdates += 1;
      this.updatesSincePersist += 1;

      if (this.updatesSincePersist >= PERSIST_INTERVAL) {
        this.persist();
        this.updatesSincePersist = 0;
      }
    } catch (cause) {
      console.error('[StatBaseline] update failed', cause);
    }
  }

  /** 强制将内存基线写入 SQLite */
  persist(): void {
    try {
      const payload = {
        ...this.exportSnapshot(),
        ...(this.exportMetadata !== undefined ? this.exportMetadata() : {}),
      };
      this.storage.save(this.userId, this.agentId, payload);
    } catch (cause) {
      console.error('[StatBaseline] persist failed', cause);
    }
  }

  /** 遗忘因子 0.95 — 衰减频次、数值、时段统计（每日定时调用） */
  applyForgetting(): void {
    try {
      for (const [tool, count] of this.toolFrequency.entries()) {
        this.toolFrequency.set(tool, count * FORGETTING_FACTOR);
      }

      this.hourlyActivity = this.hourlyActivity.map(
        (value) => value * FORGETTING_FACTOR,
      );

      for (const stats of this.paramStats.values()) {
        stats.applyDecay(FORGETTING_FACTOR);
      }
    } catch (cause) {
      console.error('[StatBaseline] applyForgetting failed', cause);
    }
  }

  getTotalUpdates(): number {
    return this.totalUpdates;
  }

  getToolFrequency(toolName: string): number {
    return this.toolFrequency.get(toolName) ?? 0;
  }

  getParamVariance(dimension: string): number {
    const stats = this.paramStats.get(dimension);
    if (stats === undefined) {
      return 0;
    }
    const state = stats.serialize();
    if (state.count < 2) {
      return 0;
    }
    return state.m2 / (state.count - 1);
  }

  getParamAnomalyScore(dimension: string, value: number): number {
    const stats = this.paramStats.get(dimension);
    if (stats === undefined || stats.serialize().count < 2) {
      return 0;
    }
    return stats.anomalyScore(value);
  }

  getHourlyActivity(): readonly number[] {
    return this.hourlyActivity;
  }

  exportParamStats(): Record<string, WelfordStatsState> {
    const paramStats: Record<string, WelfordStatsState> = {};
    for (const [dimension, stats] of this.paramStats.entries()) {
      paramStats[dimension] = stats.serialize();
    }
    return paramStats;
  }

  exportSnapshot(): StatBaselineSnapshot {
    return {
      version: SNAPSHOT_VERSION,
      totalUpdates: this.totalUpdates,
      toolFrequency: Object.fromEntries(this.toolFrequency.entries()),
      paramStats: this.exportParamStats(),
      hourlyActivity: [...this.hourlyActivity],
    };
  }

  private loadFromStorage(): void {
    try {
      const raw = this.storage.load(this.userId, this.agentId);
      if (raw === null || typeof raw !== 'object') {
        return;
      }
      const record = raw as Record<string, unknown>;
      this.importSnapshot(record as unknown as StatBaselineSnapshot);
      if (this.importMetadata !== undefined) {
        this.importMetadata(record);
      }
    } catch (cause) {
      console.error('[StatBaseline] loadFromStorage failed', cause);
    }
  }

  private importSnapshot(snapshot: StatBaselineSnapshot): void {
    this.totalUpdates =
      snapshot.totalUpdates ??
      Object.values(snapshot.toolFrequency ?? {}).reduce((sum, count) => sum + count, 0);

    this.toolFrequency.clear();
    for (const [tool, count] of Object.entries(snapshot.toolFrequency ?? {})) {
      this.toolFrequency.set(tool, count);
    }

    this.paramStats.clear();
    for (const [dimension, state] of Object.entries(snapshot.paramStats ?? {})) {
      const stats = new BaselineWelford();
      stats.deserialize(state);
      this.paramStats.set(dimension, stats);
    }

    if (
      Array.isArray(snapshot.hourlyActivity) &&
      snapshot.hourlyActivity.length === 24
    ) {
      this.hourlyActivity = [...snapshot.hourlyActivity];
    }
  }

  private getOrCreateParamStats(dimension: string): BaselineWelford {
    const existing = this.paramStats.get(dimension);
    if (existing !== undefined) {
      return existing;
    }
    const created = new BaselineWelford();
    this.paramStats.set(dimension, created);
    return created;
  }
}
