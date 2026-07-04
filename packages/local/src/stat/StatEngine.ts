/**
 * L1 Statistical Engine — Z-score + 多粒度频率 + Markov 链时序异常检测
 * 契约：IStatisticalEngine (api.types.ts) + risk.types.ts / event.types.ts
 */
import { V0_BUILTIN_BASELINE } from './baseline.js';

import {
  BaselineService,
  toStatEngineOverrides,
} from '../baseline/BaselineService.js';

import {
  DEFAULT_BASELINE_SEED,
  DEFAULT_BLOCK_THRESHOLD,
  DEFAULT_CUSUM_H,
  DEFAULT_CUSUM_K,
  DEFAULT_DIMENSION_WEIGHTS,
  DEFAULT_EWMA_L,
  DEFAULT_EWMA_LAMBDA,
  DEFAULT_FREQUENCY_BUCKETS,
  DEFAULT_MAX_PROCESS_TIME_MS,
  DEFAULT_WARN_THRESHOLD,
  ESTIMATED_BYTES_PER_SESSION,
  EWMA_ALPHA,
  FREQUENCY_WINDOW_MS,
  FUSION_WEIGHTS,
  LATENCY_SAMPLE_MAX,
  MAX_PERSISTED_MEMORY_BYTES,
  MAX_SEQUENCE_LENGTH,
  MAX_SESSION_TRACKERS,
  MAX_TOOL_NAME_LENGTH,
  REDOS_GUARD_MAX_PATTERN_CHARS,
  RiskType,
} from '@packages/shared/constants';

import type {
  BaselineCache,
  CUSUMDetectorOptions,
  CUSUMResult,
  DetectionEvent,
  DimensionScore,
  EWMADetectorOptions,
  EWMAResult,
  FrequencyGranularityWindow,
  FrequencyResult,
  IStatisticalEngine,
  L1BehaviorDimensions,
  L1DetectionResult,
  L1StatEngineConfig,
  MarkovResult,
  ProxyConfig,
  ToolSequence,
  WelfordStatsState,
  ZScoreResult,
} from '@packages/shared/types';

const DEFAULT_L1_CONFIG: L1StatEngineConfig = {
  zScoreThreshold: 3,
  coldStartMinSamples: 30,
  combinedScoreThreshold: 0.7,
  maxZScoreThreshold: 4,
  markovAnomalyThreshold: 0.7,
  markovUnknownRatioThreshold: 0.5,
  markovSmoothingAlpha: 0.1,
  windowSizeMs: 300_000,
  markovOrder: 2,
};

type StatEngineLegacyOptions = {
  config?: Partial<L1StatEngineConfig>;
  maxProcessTimeMs?: number;
};

type ResolvedStatEngineSettings = {
  config: L1StatEngineConfig;
  maxProcessTimeMs: number;
  minAnomalyScore: number;
  blockThreshold: number;
  warnThreshold: number;
  frequencyBucketCount: number;
};

// ─── Welford Online Statistics ───────────────────────────────────────────────

class WelfordStats {
  private count = 0;
  private mean = 0;
  private m2 = 0;

  getCount(): number {
    return this.count;
  }

  update(value: number): void {
    this.count += 1;
    const delta = value - this.mean;
    this.mean += delta / this.count;
    const delta2 = value - this.mean;
    this.m2 += delta * delta2;
  }

  getMean(): number {
    return this.count === 0 ? 0 : this.mean;
  }

  getVariance(): number {
    if (this.count < 2) {
      return 0;
    }
    return this.m2 / (this.count - 1);
  }

  getStdDev(): number {
    return Math.sqrt(this.getVariance());
  }

  zScore(value: number): number {
    const std = this.getStdDev();
    if (std === 0) {
      return 0;
    }
    return (value - this.getMean()) / std;
  }

  anomalyScore(value: number): number {
    const magnitude = Math.abs(this.zScore(value));
    return 1 / (1 + Math.exp(6 - magnitude * 2));
  }

  serialize(): WelfordStatsState {
    return {
      count: this.count,
      mean: this.mean,
      m2: this.m2,
    };
  }

  deserialize(state: WelfordStatsState): void {
    this.count = state.count;
    this.mean = state.mean;
    this.m2 = state.m2;
  }

  reset(): void {
    this.count = 0;
    this.mean = 0;
    this.m2 = 0;
  }
}

// ─── Z-Score Detector ────────────────────────────────────────────────────────

class ZScoreDetector {
  private readonly baselines = new Map<string, WelfordStats>();

  constructor(
    private readonly config: L1StatEngineConfig,
    private readonly dimensionWeights: Record<string, number> = DEFAULT_DIMENSION_WEIGHTS,
  ) {}

  updateBaseline(dimension: string, value: number): void {
    this.getOrCreateStats(dimension).update(value);
  }

  loadDimensionStates(states: Record<string, WelfordStatsState>): void {
    for (const [dimension, state] of Object.entries(states)) {
      const stats = this.getOrCreateStats(dimension);
      stats.deserialize(state);
    }
  }

  exportDimensionStates(): Record<string, WelfordStatsState> {
    const states: Record<string, WelfordStatsState> = {};
    for (const [dimension, stats] of this.baselines.entries()) {
      states[dimension] = stats.serialize();
    }
    return states;
  }

  detect(
    dimensions: L1BehaviorDimensions,
    overrides?: Pick<L1StatEngineConfig, 'zScoreThreshold' | 'coldStartMinSamples'>,
  ): ZScoreResult {
    const zScoreThreshold = overrides?.zScoreThreshold ?? this.config.zScoreThreshold;
    const coldStartMinSamples =
      overrides?.coldStartMinSamples ?? this.config.coldStartMinSamples;

    const dimensionScores: Record<string, DimensionScore> = {};
    let weightedSum = 0;
    let totalWeight = 0;
    let maxZScore = 0;
    let maxDimension = '';
    let maxSignedZScore = 0;

    for (const [dimension, rawValue] of Object.entries(dimensions)) {
      const value = Number.isFinite(rawValue) ? rawValue : 0;
      const stats = this.getOrCreateStats(dimension);
      const weight = this.dimensionWeights[dimension] ?? 0.1;

      if (stats.getCount() < coldStartMinSamples) {
        const coldScore = this.coldStartScore(value);
        const signedEstimate = value > stats.getMean() ? 1 : value < stats.getMean() ? -1 : 0;
        dimensionScores[dimension] = {
          value,
          mean: stats.getMean(),
          stdDev: stats.getStdDev(),
          zScore: signedEstimate,
          anomalyScore: coldScore,
          isAnomaly: coldScore >= this.config.combinedScoreThreshold,
          note: 'cold_start',
        };
        weightedSum += coldScore * weight;
        totalWeight += weight;
        continue;
      }

      const signedZ = stats.zScore(value);
      const anomalyScore = stats.anomalyScore(value);
      const isAnomaly =
        Math.abs(signedZ) > zScoreThreshold ||
        anomalyScore >= this.config.combinedScoreThreshold;

      dimensionScores[dimension] = {
        value,
        mean: stats.getMean(),
        stdDev: stats.getStdDev(),
        zScore: signedZ,
        anomalyScore,
        isAnomaly,
      };

      weightedSum += anomalyScore * weight;
      totalWeight += weight;

      if (Math.abs(signedZ) > Math.abs(maxSignedZScore)) {
        maxSignedZScore = signedZ;
        maxZScore = Math.abs(signedZ);
        maxDimension = dimension;
      }
    }

    const combinedScore = totalWeight > 0 ? weightedSum / totalWeight : 0;
    const isAnomaly =
      combinedScore >= this.config.combinedScoreThreshold ||
      maxZScore > this.config.maxZScoreThreshold ||
      Object.values(dimensionScores).some((score) => score.isAnomaly);

    return {
      combinedScore,
      maxZScore,
      maxDimension: maxDimension.length > 0 ? maxDimension : 'chain_depth',
      dimensionScores,
      isAnomaly,
      confidence: Math.min(1, combinedScore + (maxZScore > 0 ? maxZScore / 10 : 0)),
    };
  }

  private coldStartScore(value: number): number {
    return value > 5 ? 0.8 : 0.1;
  }

  private getOrCreateStats(dimension: string): WelfordStats {
    const existing = this.baselines.get(dimension);
    if (existing !== undefined) {
      return existing;
    }

    const seeded = new WelfordStats();
    const seed = DEFAULT_BASELINE_SEED[dimension];
    if (seed !== undefined) {
      for (let i = 0; i < 5; i += 1) {
        seeded.update(seed.mean + (i - 2) * seed.spread);
      }
    }
    this.baselines.set(dimension, seeded);
    return seeded;
  }
}

// ─── Sliding Window Frequency ────────────────────────────────────────────────

class SlidingWindowFrequency {
  private readonly toolBuckets = new Map<string, Uint32Array>();
  private currentBucketIndex = 0;
  private lastRecordTimestamp = 0;

  constructor(
    private readonly windowSizeMs: number,
    private readonly numBuckets: number = DEFAULT_FREQUENCY_BUCKETS,
  ) {}

  record(toolName: string, timestamp: number): void {
    if (this.lastRecordTimestamp > 0 && timestamp > this.lastRecordTimestamp) {
      this.advanceBuckets(timestamp);
    }
    if (this.lastRecordTimestamp === 0 || timestamp >= this.lastRecordTimestamp) {
      this.lastRecordTimestamp = timestamp;
    }

    let buckets = this.toolBuckets.get(toolName);
    if (buckets === undefined) {
      buckets = new Uint32Array(this.numBuckets);
      this.toolBuckets.set(toolName, buckets);
    }
    buckets[this.currentBucketIndex] = (buckets[this.currentBucketIndex] ?? 0) + 1;
  }

  getFrequency(toolName: string): number {
    const buckets = this.toolBuckets.get(toolName);
    if (buckets === undefined) {
      return 0;
    }
    let sum = 0;
    for (let i = 0; i < buckets.length; i += 1) {
      sum += buckets[i] ?? 0;
    }
    return sum;
  }

  reset(): void {
    this.toolBuckets.clear();
    this.currentBucketIndex = 0;
    this.lastRecordTimestamp = 0;
  }

  private advanceBuckets(timestamp: number): void {
    if (this.lastRecordTimestamp <= 0 || timestamp <= this.lastRecordTimestamp) {
      return;
    }

    const bucketMs = this.windowSizeMs / this.numBuckets;
    const bucketsToAdvance = Math.floor((timestamp - this.lastRecordTimestamp) / bucketMs);
    if (bucketsToAdvance <= 0) {
      return;
    }

    if (bucketsToAdvance >= this.numBuckets) {
      for (const buckets of this.toolBuckets.values()) {
        buckets.fill(0);
      }
      this.currentBucketIndex = 0;
      this.lastRecordTimestamp = timestamp;
      return;
    }

    for (let step = 0; step < bucketsToAdvance; step += 1) {
      this.currentBucketIndex = (this.currentBucketIndex + 1) % this.numBuckets;
      for (const buckets of this.toolBuckets.values()) {
        buckets[this.currentBucketIndex] = 0;
      }
    }
    this.lastRecordTimestamp = timestamp;
  }
}

// ─── Multi-Granularity Frequency ─────────────────────────────────────────────

class MultiGranularityFrequency {
  private readonly windows: Record<FrequencyGranularityWindow, SlidingWindowFrequency>;

  constructor(numBuckets: number = DEFAULT_FREQUENCY_BUCKETS) {
    this.windows = {
      '1m': new SlidingWindowFrequency(FREQUENCY_WINDOW_MS['1m'], numBuckets),
      '5m': new SlidingWindowFrequency(FREQUENCY_WINDOW_MS['5m'], numBuckets),
      '1h': new SlidingWindowFrequency(FREQUENCY_WINDOW_MS['1h'], numBuckets),
      '1d': new SlidingWindowFrequency(FREQUENCY_WINDOW_MS['1d'], numBuckets),
    };
  }

  record(toolName: string, timestamp: number): void {
    this.windows['1m'].record(toolName, timestamp);
    this.windows['5m'].record(toolName, timestamp);
    this.windows['1h'].record(toolName, timestamp);
    this.windows['1d'].record(toolName, timestamp);
  }

  getFrequency(toolName: string, window: FrequencyGranularityWindow): number {
    return this.windows[window].getFrequency(toolName);
  }

  reset(): void {
    for (const tracker of Object.values(this.windows)) {
      tracker.reset();
    }
  }
}

// ─── Markov Chain Detector ───────────────────────────────────────────────────

class MarkovChainDetector {
  private readonly unigram = new Map<string, number>();
  private readonly bigram = new Map<string, Map<string, number>>();
  private readonly prevTotals = new Map<string, number>();

  constructor(
    private readonly order: number,
    private readonly smoothingAlpha: number,
    private readonly markovAnomalyThreshold: number,
    private readonly markovUnknownRatioThreshold: number,
  ) {}

  train(sequence: ToolSequence): void {
    if (sequence.length === 0) {
      return;
    }

    for (const tool of sequence) {
      this.unigram.set(tool, (this.unigram.get(tool) ?? 0) + 1);
    }

    if (this.order < 2) {
      return;
    }

    for (let index = 1; index < sequence.length; index += 1) {
      const previous = sequence[index - 1]!;
      const current = sequence[index]!;
      if (!this.bigram.has(previous)) {
        this.bigram.set(previous, new Map());
      }
      const transitions = this.bigram.get(previous)!;
      transitions.set(current, (transitions.get(current) ?? 0) + 1);
      this.prevTotals.set(previous, (this.prevTotals.get(previous) ?? 0) + 1);
    }
  }

  scoreTransition(previousTool: string, currentTool: string): number {
    const vocabularySize = Math.max(1, this.unigram.size);

    if (this.order >= 2) {
      const total = this.prevTotals.get(previousTool) ?? 0;
      if (total === 0) {
        return 0.01;
      }
      const transitions = this.bigram.get(previousTool);
      const count = transitions?.get(currentTool) ?? 0;
      return (count + this.smoothingAlpha) / (total + this.smoothingAlpha * vocabularySize);
    }

    const total = this.getUnigramTotal();
    const count = this.unigram.get(currentTool) ?? 0;
    return (count + this.smoothingAlpha) / (total + this.smoothingAlpha * vocabularySize);
  }

  scoreSequence(sequence: ToolSequence): MarkovResult {
    if (sequence.length === 0) {
      return {
        logProbability: 0,
        perplexity: 1,
        anomalyScore: 0,
        isAnomaly: false,
      };
    }

    if (sequence.length === 1) {
      if (this.getUnigramTotal() === 0) {
        return {
          logProbability: Math.log(0.01),
          perplexity: 1,
          unknownTransitions: 0,
          unknownRatio: 0,
          anomalyScore: 0.1,
          isAnomaly: false,
        };
      }

      const probability = this.scoreUnigram(sequence[0]!);
      const logProbability = Math.log(Math.max(probability, 0.01));
      const anomalyScore = probability <= 0.01 ? 0.85 : 0.1;
      return {
        logProbability,
        perplexity: Math.exp(-logProbability),
        unknownTransitions: probability <= 0.01 ? 1 : 0,
        unknownRatio: probability <= 0.01 ? 1 : 0,
        anomalyScore,
        isAnomaly:
          anomalyScore > this.markovAnomalyThreshold ||
          (probability <= 0.01 ? 1 : 0) > this.markovUnknownRatioThreshold,
      };
    }

    let logProbabilitySum = 0;
    let unknownTransitions = 0;
    const transitionCount = sequence.length - 1;

    for (let index = 1; index < sequence.length; index += 1) {
      const previous = sequence[index - 1]!;
      const current = sequence[index]!;
      const probability = this.scoreTransition(previous, current);
      const isUnknown =
        probability <= 0.01 ||
        (this.bigram.get(previous)?.get(current) ?? 0) === 0;
      if (isUnknown) {
        unknownTransitions += 1;
      }
      logProbabilitySum += Math.log(Math.max(probability, 0.01));
    }

    const logProbability = logProbabilitySum / transitionCount;
    const perplexity = Math.exp(-logProbability);
    const unknownRatio = unknownTransitions / transitionCount;
    const anomalyScore = Math.min(
      1,
      Math.max(perplexity / 10, unknownRatio, unknownTransitions > 0 ? 0.35 : 0),
    );
    const isAnomaly =
      anomalyScore > this.markovAnomalyThreshold ||
      unknownRatio > this.markovUnknownRatioThreshold;

    return {
      logProbability,
      perplexity,
      unknownTransitions,
      unknownRatio,
      anomalyScore,
      isAnomaly,
    };
  }

  reset(): void {
    this.unigram.clear();
    this.bigram.clear();
    this.prevTotals.clear();
  }

  private scoreUnigram(tool: string): number {
    const total = this.getUnigramTotal();
    if (total === 0) {
      return 0.01;
    }
    const count = this.unigram.get(tool) ?? 0;
    const vocabularySize = Math.max(1, this.unigram.size);
    return (count + this.smoothingAlpha) / (total + this.smoothingAlpha * vocabularySize);
  }

  private getUnigramTotal(): number {
    let total = 0;
    for (const count of this.unigram.values()) {
      total += count;
    }
    return total;
  }
}

// ─── CUSUM Detector ──────────────────────────────────────────────────────────

class CUSUMDetector {
  private positiveSum = 0;
  private negativeSum = 0;
  private alarmCount = 0;
  private baselineMean: number;
  private baselineStd: number;
  private readonly k: number;
  private readonly h: number;

  constructor(options?: CUSUMDetectorOptions) {
    this.k = options?.k ?? DEFAULT_CUSUM_K;
    this.h = options?.h ?? DEFAULT_CUSUM_H;
    this.baselineMean = options?.baselineMean ?? 0;
    this.baselineStd = options?.baselineStd ?? 1;
  }

  setBaseline(mean: number, std: number): void {
    this.baselineMean = mean;
    this.baselineStd = std > 0 ? std : 1;
  }

  update(value: number): CUSUMResult {
    const std = this.baselineStd > 0 ? this.baselineStd : 1;
    const normalized = (value - this.baselineMean) / std;
    this.positiveSum = Math.max(0, this.positiveSum + normalized - this.k);
    this.negativeSum = Math.max(0, this.negativeSum - normalized - this.k);
    const isAlarm = this.positiveSum > this.h || this.negativeSum > this.h;
    if (isAlarm) {
      this.alarmCount += 1;
    }
    const score = Math.min(1, Math.max(this.positiveSum, this.negativeSum) / this.h);
    return {
      value,
      normalized,
      positiveSum: this.positiveSum,
      negativeSum: this.negativeSum,
      score,
      isAlarm,
      alarmCount: this.alarmCount,
    };
  }

  reset(): void {
    this.positiveSum = 0;
    this.negativeSum = 0;
    this.alarmCount = 0;
  }

  /** V1 持久化预留 — 导出 CUSUM 累积状态 */
  serialize(): {
    positiveSum: number;
    negativeSum: number;
    alarmCount: number;
    baselineMean: number;
    baselineStd: number;
    k: number;
    h: number;
  } {
    return {
      positiveSum: this.positiveSum,
      negativeSum: this.negativeSum,
      alarmCount: this.alarmCount,
      baselineMean: this.baselineMean,
      baselineStd: this.baselineStd,
      k: this.k,
      h: this.h,
    };
  }

  deserialize(state: {
    positiveSum: number;
    negativeSum: number;
    alarmCount: number;
    baselineMean: number;
    baselineStd: number;
  }): void {
    this.positiveSum = state.positiveSum;
    this.negativeSum = state.negativeSum;
    this.alarmCount = state.alarmCount;
    this.baselineMean = state.baselineMean;
    this.baselineStd = state.baselineStd > 0 ? state.baselineStd : 1;
  }
}

// ─── EWMA Detector ───────────────────────────────────────────────────────────

class EWMADetector {
  private ewma: number | null = null;
  private varianceZ = 0;
  private readonly lambda: number;
  private readonly l: number;
  private readonly baselineMean: number;
  private readonly baselineStd: number;

  constructor(options?: EWMADetectorOptions) {
    this.lambda = options?.lambda ?? DEFAULT_EWMA_LAMBDA;
    this.l = options?.l ?? DEFAULT_EWMA_L;
    this.baselineMean = options?.baselineMean ?? 0;
    this.baselineStd = options?.baselineStd ?? 1;
  }

  update(value: number): EWMAResult {
    if (this.ewma === null) {
      this.ewma = value;
      return {
        value,
        ewma: value,
        ucl: value,
        lcl: value,
        score: 0,
        isAnomaly: false,
      };
    }

    const previous = this.ewma;
    this.ewma = this.lambda * value + (1 - this.lambda) * previous;
    this.varianceZ =
      this.lambda * (value - this.ewma) ** 2 + (1 - this.lambda) * this.varianceZ;
    const stdZ = Math.sqrt(this.varianceZ);
    const safeStd = stdZ > 0 ? stdZ : this.baselineStd > 0 ? this.baselineStd : 1;
    const ucl = this.ewma + this.l * safeStd;
    const lcl = this.ewma - this.l * safeStd;
    const deviation = Math.max(Math.abs(value - ucl), Math.abs(lcl - value));
    const score = Math.min(1, deviation / (this.l * safeStd));
    const isAnomaly = value > ucl || value < lcl;

    return {
      value,
      ewma: this.ewma,
      ucl,
      lcl,
      score,
      isAnomaly,
    };
  }

  reset(): void {
    this.ewma = null;
    this.varianceZ = 0;
  }

  /** V1 持久化预留 — 导出 EWMA 在线状态 */
  serialize(): {
    ewma: number | null;
    varianceZ: number;
    baselineMean: number;
    baselineStd: number;
    lambda: number;
    l: number;
  } {
    return {
      ewma: this.ewma,
      varianceZ: this.varianceZ,
      baselineMean: this.baselineMean,
      baselineStd: this.baselineStd,
      lambda: this.lambda,
      l: this.l,
    };
  }

  deserialize(state: {
    ewma: number | null;
    varianceZ: number;
  }): void {
    this.ewma = state.ewma;
    this.varianceZ = state.varianceZ;
  }
}

// ─── Config / Safety Helpers ─────────────────────────────────────────────────

function isProxyConfig(value: unknown): value is ProxyConfig {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as ProxyConfig;
  return (
    typeof candidate.server === 'object' &&
    candidate.server !== null &&
    typeof candidate.agentWatch === 'object' &&
    candidate.agentWatch !== null
  );
}

function resolveSettings(
  proxyConfigOrOptions?: ProxyConfig | StatEngineLegacyOptions,
): ResolvedStatEngineSettings {
  if (isProxyConfig(proxyConfigOrOptions)) {
    const stat = proxyConfigOrOptions.agentWatch.detection.statisticalEngine;
    const rule = proxyConfigOrOptions.agentWatch.detection.ruleEngine;
    const router = proxyConfigOrOptions.agentWatch.detection.decisionRouter;
    const config: L1StatEngineConfig = {
      zScoreThreshold: stat.zScoreThreshold,
      coldStartMinSamples: stat.coldStartMinSamples,
      combinedScoreThreshold: stat.combinedScoreThreshold,
      maxZScoreThreshold: stat.maxZScoreThreshold,
      markovAnomalyThreshold: stat.markovAnomalyThreshold,
      markovUnknownRatioThreshold: stat.markovUnknownRatioThreshold,
      markovSmoothingAlpha: stat.markovSmoothingAlpha,
      windowSizeMs: stat.windowSizeMs,
      ...(stat.markovOrder !== undefined ? { markovOrder: stat.markovOrder } : {}),
      ...(stat.cusumThreshold !== undefined ? { cusumThreshold: stat.cusumThreshold } : {}),
      ...(stat.ewmaLambda !== undefined ? { ewmaLambda: stat.ewmaLambda } : {}),
    };
    const bucketMs = Math.max(1_000, Math.floor(stat.windowSizeMs / DEFAULT_FREQUENCY_BUCKETS));
    const bucketCount = Math.max(
      10,
      Math.min(DEFAULT_FREQUENCY_BUCKETS, Math.floor(stat.windowSizeMs / bucketMs)),
    );
    return {
      config,
      maxProcessTimeMs: rule.maxMatchTimeMs,
      minAnomalyScore: stat.combinedScoreThreshold,
      blockThreshold: router.blockThreshold,
      warnThreshold: router.warnThreshold,
      frequencyBucketCount: bucketCount,
    };
  }

  const legacy = proxyConfigOrOptions ?? {};
  return {
    config: { ...DEFAULT_L1_CONFIG, ...(legacy.config ?? {}) },
    maxProcessTimeMs: legacy.maxProcessTimeMs ?? DEFAULT_MAX_PROCESS_TIME_MS,
    minAnomalyScore: legacy.config?.combinedScoreThreshold ?? DEFAULT_L1_CONFIG.combinedScoreThreshold,
    blockThreshold: DEFAULT_BLOCK_THRESHOLD,
    warnThreshold: DEFAULT_WARN_THRESHOLD,
    frequencyBucketCount: DEFAULT_FREQUENCY_BUCKETS,
  };
}

function sanitizeToolName(rawName: string): string {
  const withoutNulls = rawName.replaceAll('\u0000', '');
  const trimmed = withoutNulls.trim();
  if (trimmed.length <= MAX_TOOL_NAME_LENGTH) {
    return isPotentiallyCatastrophicPattern(trimmed)
      ? trimmed.slice(0, REDOS_GUARD_MAX_PATTERN_CHARS)
      : trimmed;
  }
  return trimmed.slice(0, MAX_TOOL_NAME_LENGTH);
}

function isPotentiallyCatastrophicPattern(value: string): boolean {
  return /(\(\?\=|\(\?\!|\(\?\<\=|\(\?\<\!|\(\?\:|\+\)|\{\d+,\}|\[\^.*\+.*\])/.test(value);
}

function isBaselineEffective(
  effectiveFrom: number | undefined,
  effectiveTo: number | undefined,
  timestamp: number,
): boolean {
  if (effectiveFrom !== undefined && timestamp < effectiveFrom) {
    return false;
  }
  if (effectiveTo !== undefined && timestamp > effectiveTo) {
    return false;
  }
  return true;
}

// ─── Stat Engine ─────────────────────────────────────────────────────────────

/**
 * L1 统计引擎 — Z-score + 多粒度频率 + Markov 链时序异常检测
 * 契约：task_l1_engine.md L1-ENG-01 / IStatisticalEngine (api.types.ts)
 */
export class StatEngine implements IStatisticalEngine {
  private readonly settings: ResolvedStatEngineSettings;
  private readonly config: L1StatEngineConfig;
  private readonly maxProcessTimeMs: number;
  private readonly minAnomalyScore: number;
  private readonly blockThreshold: number;
  private readonly warnThreshold: number;
  private readonly frequencyBucketCount: number;
  private readonly zScoreDetector: ZScoreDetector;
  private readonly sessionFrequencies = new Map<string, MultiGranularityFrequency>();
  private readonly sessionSequences = new Map<string, ToolSequence>();
  private readonly cusumDetectors = new Map<string, CUSUMDetector>();
  private readonly ewmaDetectors = new Map<string, EWMADetector>();
  private readonly globalMarkov = new MarkovChainDetector(
    DEFAULT_L1_CONFIG.markovOrder ?? 2,
    DEFAULT_L1_CONFIG.markovSmoothingAlpha,
    DEFAULT_L1_CONFIG.markovAnomalyThreshold,
    DEFAULT_L1_CONFIG.markovUnknownRatioThreshold,
  );

  private baselineService: BaselineService | null = null;

  private totalEvents = 0;
  private avgLatencyMs = 0;
  private p99LatencyMs = 0;
  private readonly latencySamples: number[] = [];

  // V1: SQLite 持久化基线 — loadBaseline()/updateBaseline() 对接磁盘快照
  // V1: generateULID() — session_id 生成替换标准 ulid 第三方库（对齐 MCPProxyCore MPC-12）

  constructor(proxyConfigOrOptions?: ProxyConfig | StatEngineLegacyOptions) {
    this.settings = resolveSettings(proxyConfigOrOptions);
    this.config = this.settings.config;
    this.maxProcessTimeMs = this.settings.maxProcessTimeMs;
    this.minAnomalyScore = this.settings.minAnomalyScore;
    this.blockThreshold = this.settings.blockThreshold;
    this.warnThreshold = this.settings.warnThreshold;
    this.frequencyBucketCount = this.settings.frequencyBucketCount;
    this.zScoreDetector = new ZScoreDetector(this.config);
  }

  /** 注入 BaselineService — 冷启动策略 + 基线偏离融合 */
  setBaselineService(service: BaselineService | null): void {
    this.baselineService = service;
  }

  loadBuiltinBaseline(timestamp: number = Date.now()): void {
    const perfStart = performance.now();
    try {
      for (const record of V0_BUILTIN_BASELINE) {
        if (
          !isBaselineEffective(record.effectiveFrom, record.effectiveTo, timestamp)
        ) {
          continue;
        }
        this.updateBaseline({ dimensions: record.dimensions });
        this.globalMarkov.train(record.markovSeedSequence);
      }
      this.logPerformance('loadBuiltinBaseline', perfStart, this.maxProcessTimeMs);
    } catch (cause) {
      throw this.createStructuredError(
        'Failed to load built-in statistical baseline',
        null,
        RiskType.STAT_ENGINE_BUILTIN_BASELINE_FAILED,
        cause,
      );
    }
  }

  /** L1 核心事件处理 — Z-score + 频率 + Markov 融合，P99 < DEFAULT_MAX_PROCESS_TIME_MS */
  processEvent(event: DetectionEvent): L1DetectionResult {
    const perfStart = performance.now();
    const eventId = this.resolveEventId(event);

    try {
      this.assertProcessBudget(perfStart, eventId, 'process_start');

      const sessionKey = event.request.session_id ?? 'global';
      const timestamp = event.request.timestamp;
      const toolName = sanitizeToolName(event.tool.name);

      const frequencyTracker = this.getSessionFrequency(sessionKey);
      frequencyTracker.record(toolName, timestamp);
      this.assertProcessBudget(perfStart, eventId, 'frequency_record');

      const frequencies: Record<FrequencyGranularityWindow, number> = {
        '1m': frequencyTracker.getFrequency(toolName, '1m'),
        '5m': frequencyTracker.getFrequency(toolName, '5m'),
        '1h': frequencyTracker.getFrequency(toolName, '1h'),
        '1d': frequencyTracker.getFrequency(toolName, '1d'),
      };

      const dimensions = this.extractDimensions(event, frequencies);
      this.assertProcessBudget(perfStart, eventId, 'extract_dimensions');

      const detectionOverrides =
        this.baselineService !== null
          ? toStatEngineOverrides(
              this.baselineService.getDetectionPolicy(this.config.zScoreThreshold),
            )
          : undefined;

      const zScoreResult = this.zScoreDetector.detect(dimensions, detectionOverrides);
      this.assertProcessBudget(perfStart, eventId, 'zscore_detect');

      const frequencyResult = this.buildFrequencyResult(toolName, frequencies);
      this.assertProcessBudget(perfStart, eventId, 'frequency_score');

      const priorSequence = this.sessionSequences.get(sessionKey) ?? [];
      const sequenceForScore: ToolSequence = [...priorSequence, toolName];
      const markovResult = this.globalMarkov.scoreSequence(sequenceForScore);
      this.appendSessionSequence(sessionKey, toolName);
      this.globalMarkov.train(this.buildTransitionSlice(sequenceForScore));
      this.assertProcessBudget(perfStart, eventId, 'markov_score');

      const cusumResults = this.runCusumDetectors(dimensions);
      this.assertProcessBudget(perfStart, eventId, 'cusum_branch');

      const ewmaResults = this.runEwmaDetectors(dimensions);
      this.assertProcessBudget(perfStart, eventId, 'ewma_branch');

      const combinedScore = this.fuseScores(
        zScoreResult.combinedScore,
        frequencyResult.anomalyScore,
        markovResult.anomalyScore,
        cusumResults,
        ewmaResults,
      );

      const isAnomaly =
        combinedScore >= this.minAnomalyScore ||
        zScoreResult.isAnomaly ||
        frequencyResult.isAnomaly ||
        markovResult.isAnomaly ||
        this.hasCusumAlarm(cusumResults) ||
        this.hasEwmaAnomaly(ewmaResults);

      if (this.baselineService !== null) {
        this.baselineService.recordObservation({
          event,
          dimensions,
          isAnomaly,
          baseZScoreThreshold: this.config.zScoreThreshold,
        });
      } else {
        this.updateOnlineBaselines(dimensions);
      }
      this.totalEvents += 1;

      const latencyMs = performance.now() - perfStart;
      this.updateLatencyStats(latencyMs);
      this.logPerformance('processEvent', perfStart, this.maxProcessTimeMs);

      const result: L1DetectionResult = {
        zScore: zScoreResult,
        frequency: frequencyResult,
        markov: markovResult,
        combinedScore,
        isAnomaly,
        latencyMs,
        cusum: cusumResults,
        ewma: ewmaResults,
      };

      return result;
    } catch (cause) {
      if (cause instanceof Error && 'riskType' in cause) {
        throw cause;
      }
      throw this.createStructuredError(
        'Statistical engine processEvent failed',
        eventId,
        RiskType.STAT_ENGINE_PROCESS_FAILED,
        cause,
      );
    }
  }

  updateBaseline(cache: BaselineCache): void {
    const perfStart = performance.now();
    try {
      this.zScoreDetector.loadDimensionStates(cache.dimensions);
      this.logPerformance('updateBaseline', perfStart, this.maxProcessTimeMs);
    } catch (cause) {
      throw this.createStructuredError(
        'Failed to update statistical baseline cache',
        null,
        RiskType.STAT_ENGINE_BASELINE_UPDATE_FAILED,
        cause,
      );
    }
  }

  loadBaseline(): BaselineCache {
    return {
      dimensions: this.zScoreDetector.exportDimensionStates(),
    };
  }

  /** 内部辅助：读取各维度均值/方差/样本量，供决策路由或测试 introspection */
  getBaselineStats(): Record<
    string,
    { mean: number; variance: number; count: number }
  > {
    const cache = this.loadBaseline();
    const summary: Record<string, { mean: number; variance: number; count: number }> =
      {};

    for (const [dimension, state] of Object.entries(cache.dimensions)) {
      const variance = state.count < 2 ? 0 : state.m2 / (state.count - 1);
      summary[dimension] = {
        mean: state.mean,
        variance,
        count: state.count,
      };
    }

    return summary;
  }

  private runCusumDetectors(
    dimensions: L1BehaviorDimensions,
  ): Record<string, CUSUMResult> {
    const results: Record<string, CUSUMResult> = {};
    const threshold = this.config.cusumThreshold ?? DEFAULT_CUSUM_H;

    for (const [dimension, rawValue] of Object.entries(dimensions)) {
      if (!Number.isFinite(rawValue)) {
        continue;
      }
      const stats = this.zScoreDetector.exportDimensionStates()[dimension];
      let detector = this.cusumDetectors.get(dimension);
      if (detector === undefined) {
        const mean = stats?.mean ?? 0;
        const variance = stats !== undefined && stats.count >= 2 ? stats.m2 / (stats.count - 1) : 1;
        detector = new CUSUMDetector({
          k: DEFAULT_CUSUM_K,
          h: threshold,
          baselineMean: mean,
          baselineStd: Math.sqrt(variance) || 1,
        });
        this.cusumDetectors.set(dimension, detector);
      }
      results[dimension] = detector.update(rawValue);
    }

    return results;
  }

  private runEwmaDetectors(
    dimensions: L1BehaviorDimensions,
  ): Record<string, EWMAResult> {
    const results: Record<string, EWMAResult> = {};
    const lambda = this.config.ewmaLambda ?? DEFAULT_EWMA_LAMBDA;

    for (const [dimension, rawValue] of Object.entries(dimensions)) {
      if (!Number.isFinite(rawValue)) {
        continue;
      }
      const stats = this.zScoreDetector.exportDimensionStates()[dimension];
      let detector = this.ewmaDetectors.get(dimension);
      if (detector === undefined) {
        const mean = stats?.mean ?? 0;
        const variance = stats !== undefined && stats.count >= 2 ? stats.m2 / (stats.count - 1) : 1;
        detector = new EWMADetector({
          lambda,
          l: DEFAULT_EWMA_L,
          baselineMean: mean,
          baselineStd: Math.sqrt(variance) || 1,
        });
        this.ewmaDetectors.set(dimension, detector);
      }
      results[dimension] = detector.update(rawValue);
    }

    return results;
  }

  private hasCusumAlarm(results: Record<string, CUSUMResult>): boolean {
    return Object.values(results).some((result) => result.isAlarm);
  }

  private hasEwmaAnomaly(results: Record<string, EWMAResult>): boolean {
    return Object.values(results).some((result) => result.isAnomaly);
  }

  /** effectiveFrom / effectiveTo 双重校验 — 判断内置基线在给定时间戳是否有效 */
  isBuiltinBaselineEffective(timestamp: number = Date.now()): boolean {
    return V0_BUILTIN_BASELINE.some((record) =>
      isBaselineEffective(record.effectiveFrom, record.effectiveTo, timestamp),
    );
  }

  private extractDimensions(
    event: DetectionEvent,
    frequencies: Record<FrequencyGranularityWindow, number>,
  ): L1BehaviorDimensions {
    return {
      chain_depth: event.context?.chain_depth ?? 0,
      arg_count: this.countArguments(event.argument.value),
      tool_frequency: frequencies['1m'],
      latency: event.metadata?.duration_ms ?? 0,
      error_rate: 0,
      user_repeat: 1,
      transfer_amount: this.extractTransferAmount(event),
      metadata_frequency_1m: event.metadata?.frequency_1m ?? frequencies['1m'],
      metadata_frequency_5m: event.metadata?.frequency_5m ?? frequencies['5m'],
      metadata_consecutive_failures: event.metadata?.consecutive_failures ?? 0,
    };
  }

  private extractTransferAmount(event: DetectionEvent): number {
    if (event.tool.name !== 'transfer') {
      return 0;
    }

    const amountKeys = ['amount', 'value', 'sum', 'sz', 'quantity'];
    const sources: unknown[] = [event.argument.value];
    if (event.arguments !== undefined) {
      for (const entry of event.arguments) {
        if (amountKeys.includes(entry.name.toLowerCase())) {
          sources.push(entry.value);
        }
      }
    }

    for (const candidate of sources) {
      const parsed = this.parseNumericAmount(candidate);
      if (parsed !== null) {
        return parsed;
      }
    }

    return 0;
  }

  private parseNumericAmount(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      for (const key of ['amount', 'value', 'sum']) {
        const nested = (value as Record<string, unknown>)[key];
        const parsed = this.parseNumericAmount(nested);
        if (parsed !== null) {
          return parsed;
        }
      }
    }
    return null;
  }

  private countArguments(value: unknown): number {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return Object.keys(value as Record<string, unknown>).length;
    }
    if (value === undefined || value === null || value === '') {
      return 0;
    }
    return 1;
  }

  private buildFrequencyResult(
    toolName: string,
    frequencies: Record<FrequencyGranularityWindow, number>,
  ): FrequencyResult {
    const freq1m = frequencies['1m'];
    const baseline = DEFAULT_BASELINE_SEED.tool_frequency?.mean ?? 5;
    const anomalyScore = Math.min(1, freq1m / Math.max(baseline * 4, 20));
    const isAnomaly = freq1m >= 100 || anomalyScore >= this.minAnomalyScore;

    return {
      toolName,
      frequencies,
      anomalyScore,
      isAnomaly,
    };
  }

  private fuseScores(
    zScore: number,
    frequencyScore: number,
    markovScore: number,
    cusumResults: Record<string, CUSUMResult>,
    ewmaResults: Record<string, EWMAResult>,
  ): number {
    const cusumScore = Object.values(cusumResults).reduce(
      (max, result) => Math.max(max, result.score),
      0,
    );
    const ewmaScore = Object.values(ewmaResults).reduce(
      (max, result) => Math.max(max, result.score),
      0,
    );
    return (
      zScore * FUSION_WEIGHTS.zScore +
      frequencyScore * FUSION_WEIGHTS.frequency +
      markovScore * FUSION_WEIGHTS.markov +
      cusumScore * FUSION_WEIGHTS.cusum +
      ewmaScore * FUSION_WEIGHTS.ewma
    );
  }

  private appendSessionSequence(sessionKey: string, toolName: string): ToolSequence {
    // MAX_SEQUENCE_LENGTH：单会话 Markov 滑动窗口 — task_l1_engine.md L1-005
    const existing = this.sessionSequences.get(sessionKey) ?? [];
    existing.push(toolName);
    if (existing.length > MAX_SEQUENCE_LENGTH) {
      existing.shift();
    }
    this.sessionSequences.set(sessionKey, existing);
    return existing;
  }

  private buildTransitionSlice(sequence: ToolSequence): ToolSequence {
    if (sequence.length < 2) {
      return sequence.slice();
    }
    return sequence.slice(-2);
  }

  private getSessionFrequency(sessionKey: string): MultiGranularityFrequency {
    this.evictSessionTrackersIfNeeded(sessionKey);
    const existing = this.sessionFrequencies.get(sessionKey);
    if (existing !== undefined) {
      return existing;
    }
    const created = new MultiGranularityFrequency(this.frequencyBucketCount);
    this.sessionFrequencies.set(sessionKey, created);
    return created;
  }

  /** 会话 tracker LRU + 内存预算 — task_l1_engine.md L1-005 / 产品架构 §5 行为基线 Markov 缓存 */
  private evictSessionTrackersIfNeeded(incomingSessionKey: string): void {
    const estimatedBytes =
      this.sessionFrequencies.size * ESTIMATED_BYTES_PER_SESSION;
    const overMemoryBudget = estimatedBytes >= MAX_PERSISTED_MEMORY_BYTES;
    const overCountBudget =
      this.sessionFrequencies.size >= MAX_SESSION_TRACKERS &&
      !this.sessionFrequencies.has(incomingSessionKey);

    if (!overMemoryBudget && !overCountBudget) {
      return;
    }

    const oldestKey = this.sessionFrequencies.keys().next().value as
      | string
      | undefined;
    if (oldestKey === undefined || oldestKey === incomingSessionKey) {
      return;
    }

    this.sessionFrequencies.delete(oldestKey);
    this.sessionSequences.delete(oldestKey);
  }

  private updateOnlineBaselines(dimensions: L1BehaviorDimensions): void {
    for (const [dimension, value] of Object.entries(dimensions)) {
      if (Number.isFinite(value)) {
        this.zScoreDetector.updateBaseline(dimension, value);
      }
    }
  }

  private assertProcessBudget(
    perfStart: number,
    eventId: string,
    phase: string,
  ): void {
    const elapsed = performance.now() - perfStart;
    if (elapsed > this.maxProcessTimeMs) {
      throw this.createStructuredError(
        `Stat engine process timeout at phase=${phase} elapsedMs=${elapsed.toFixed(3)}`,
        eventId,
        RiskType.STAT_ENGINE_PROCESS_TIMEOUT,
        new Error(`Exceeded maxProcessTimeMs=${String(this.maxProcessTimeMs)}`),
      );
    }
  }

  private updateLatencyStats(latencyMs: number): void {
    this.avgLatencyMs =
      this.avgLatencyMs === 0
        ? latencyMs
        : EWMA_ALPHA * latencyMs + (1 - EWMA_ALPHA) * this.avgLatencyMs;

    this.latencySamples.push(latencyMs);
    if (this.latencySamples.length > LATENCY_SAMPLE_MAX) {
      this.latencySamples.shift();
    }

    const sorted = [...this.latencySamples].sort((left, right) => left - right);
    const p99Index = Math.ceil(sorted.length * 0.99) - 1;
    this.p99LatencyMs = sorted[Math.max(0, p99Index)] ?? latencyMs;
  }

  private logPerformance(
    operation: string,
    startMs: number,
    budgetMs: number,
  ): void {
    const durationMs = performance.now() - startMs;
    const withinBudget = durationMs <= budgetMs;
    console.info(
      `[StatEngine][perf] op=${operation} durationMs=${durationMs.toFixed(3)} budgetMs=${String(budgetMs)} withinBudget=${String(withinBudget)}`,
    );
  }

  private resolveEventId(event: DetectionEvent): string {
    return event.request.session_id ?? String(event.request.timestamp);
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

export type AnomalyLevel = 'HIGH' | 'MEDIUM' | 'LOW';
export type AlertAction = 'BLOCK' | 'WARN' | 'ALLOW';

/** L1 异常等级分类 — task_l1_engine.md L1-007 与 DecisionRouter 对齐 */
export function classifyAnomalyLevel(result: L1DetectionResult): AnomalyLevel {
  if (result.combinedScore >= 0.7 || result.isAnomaly) {
    return 'HIGH';
  }
  if (result.combinedScore >= 0.4) {
    return 'MEDIUM';
  }
  return 'LOW';
}

/** L1 告警动作分类 — block/warn/allow 阈值判定 */
export function classifyAlertAction(
  result: L1DetectionResult,
  thresholds?: { blockThreshold?: number; warnThreshold?: number },
): AlertAction {
  const blockThreshold = thresholds?.blockThreshold ?? DEFAULT_BLOCK_THRESHOLD;
  const warnThreshold = thresholds?.warnThreshold ?? DEFAULT_WARN_THRESHOLD;
  if (result.combinedScore >= blockThreshold || (result.isAnomaly && result.combinedScore >= 0.7)) {
    return 'BLOCK';
  }
  if (result.combinedScore >= warnThreshold || result.isAnomaly) {
    return 'WARN';
  }
  return 'ALLOW';
}
