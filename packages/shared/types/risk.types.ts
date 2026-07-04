/**
 * L1 统计引擎风险与基线类型定义
 * 适配文档：task_l1_engine.md (§4.2-§4.3) + agentwatch_v0_mvp_tasklist.md (§3 L1)
 * 事件来源：packages/shared/types/event.types.ts — DetectionEvent
 */
import type { DetectionEvent } from './event.types.js';

// ─── 枚举 / 类型别名 ───────────────────────────────────────────
/** 多粒度频率窗口 — MultiGranularityFrequency.getFrequency(window) 四档粒度 */
export type FrequencyGranularityWindow = '1m' | '5m' | '1h' | '1d';
/** Markov 链时序工具名序列 — train() / scoreSequence() 输入 */
export type ToolSequence = string[];
/** Z-score 多维度观测值 — ZScoreDetector.detect(dimensions) 入参 */
export type L1BehaviorDimensions = Record<string, number>;

// ─── 检测器配置（§4.3 内联 options）────────────────────────────
/** CUSUM 累积和检测器构造选项 — V1 Deferred，代码可直接用 */
export interface CUSUMDetectorOptions {
  k?: number;
  h?: number;
  baselineMean?: number;
  baselineStd?: number;
}

/** EWMA 指数加权移动平均检测器构造选项 — V1 Deferred，代码可直接用 */
export interface EWMADetectorOptions {
  lambda?: number;
  l?: number;
  baselineMean?: number;
  baselineStd?: number;
}

/** L1 统计引擎运行阈值配置 — 对齐文档测试验收与部署默认值 */
export interface L1StatEngineConfig {
  /** Z-score 异常阈值 — 正常值 [-3, 3]，超出报警 */
  zScoreThreshold: number;
  /** 冷启动最小样本数 — 前 30 次调用仅采集不报警 */
  coldStartMinSamples: number;
  /** 综合得分异常阈值 — combinedScore > 0.7 触发 isAnomaly */
  combinedScoreThreshold: number;
  /** 单维度最大 Z-score 阈值 — maxZScore > 4 触发 isAnomaly */
  maxZScoreThreshold: number;
  /** Markov 异常评分阈值 — anomalyScore > 0.7 触发 isAnomaly */
  markovAnomalyThreshold: number;
  /** Markov 未知转移占比阈值 — unknownRatio > 0.5 触发 isAnomaly */
  markovUnknownRatioThreshold: number;
  /** Markov Laplace 平滑系数 — alpha = 0.1 */
  markovSmoothingAlpha: number;
  /** 滑动窗口大小 (ms) — 默认 300000 (5min) */
  windowSizeMs: number;
  /** CUSUM 阈值 — V1 Deferred */
  cusumThreshold?: number;
  /** EWMA lambda — V1 Deferred */
  ewmaLambda?: number;
  /** Markov 链阶数 — 默认 2 (2-gram) */
  markovOrder?: number;
}

// ─── 基线 / 状态结构（频次基线 + Welford 在线统计）──────────────
/**
 * Welford 在线统计持久化状态
 * WelfordStats.serialize() / deserialize() — 支撑 zScore / anomalyScore 计算
 */
export interface WelfordStatsState {
  count: number;
  mean: number;
  m2: number;
}

/**
 * 用户行为 Z-score 基线缓存
 * ZScoreDetector.updateBaseline(dimension, value) 各维度 Welford 累积状态
 */
export interface BaselineCache {
  /** 各统计维度 → Welford 在线状态（6 维行为画像基线） */
  dimensions: Record<string, WelfordStatsState>;
}

/**
 * 滑动窗口频次基线快照
 * SlidingWindowFrequency — Uint32Array 桶计数序列化状态
 */
export interface SlidingWindowFrequencyState {
  /** 工具名 → 桶计数数组 (Uint32Array 序列化) */
  toolBuckets: Record<string, number[]>;
  currentBucketIndex: number;
  lastRecordTimestamp: number;
}

/**
 * 多粒度频次基线快照
 * MultiGranularityFrequency — 四窗口独立 SlidingWindow 状态
 */
export interface MultiGranularityFrequencyState {
  windows: Record<FrequencyGranularityWindow, SlidingWindowFrequencyState>;
}

// ─── 引擎输入（绑定 DetectionEvent，不重复定义事件）────────────
/**
 * L1 统计引擎单事件输入
 * processEvent() 入口 — 从 DetectionEvent 提取 tool / timestamp / chain_depth 等维度
 */
export interface L1StatisticalInput {
  event: DetectionEvent;
}

/**
 * L1 统计引擎完整处理上下文
 * 聚合 Z-score 维度、Markov 时序与当前检测事件
 */
export interface L1StatisticalProcessContext {
  event: DetectionEvent;
  /** 从 DetectionEvent 映射的多维度数值 — detect(dimensions) */
  dimensions: L1BehaviorDimensions;
  /** 会话内工具调用时序 — scoreSequence() / train() */
  toolSequence: ToolSequence;
}

// ─── 算法输出结果（§4.2 严格对齐）──────────────────────────────
/**
 * 单维度 Z-score 评分
 * ZScoreDetector 对每个维度的独立评估结果
 */
export interface DimensionScore {
  value: number;
  mean: number;
  stdDev: number;
  zScore: number;
  anomalyScore: number;
  isAnomaly: boolean;
  note?: string;
}

/**
 * 多维度 Z-score 综合检测结果
 * ZScoreDetector.detect() 输出 — 加权融合风险打分
 */
export interface ZScoreResult {
  combinedScore: number;
  maxZScore: number;
  maxDimension: string;
  dimensionScores: Record<string, DimensionScore>;
  isAnomaly: boolean;
  confidence: number;
}

/**
 * CUSUM 累积和检测结果
 * CUSUMDetector.update() 输出 — V1 Deferred
 */
export interface CUSUMResult {
  value: number;
  normalized: number;
  positiveSum: number;
  negativeSum: number;
  score: number;
  isAlarm: boolean;
  alarmCount: number;
}

/**
 * EWMA 指数加权移动平均检测结果
 * EWMADetector.update() 输出 — V1 Deferred
 */
export interface EWMAResult {
  value: number;
  ewma: number;
  ucl: number;
  lcl: number;
  score: number;
  isAnomaly: boolean;
}

/**
 * Markov 链时序异常评分结果
 * MarkovChainDetector.scoreSequence() 输出 — 工具转移序列风险
 */
export interface MarkovResult {
  logProbability: number;
  perplexity: number;
  unknownTransitions?: number;
  unknownRatio?: number;
  anomalyScore: number;
  isAnomaly: boolean;
}

/**
 * 多粒度频率分析结果
 * MultiGranularityFrequency 各窗口 getFrequency() 聚合输出
 */
export interface FrequencyResult {
  toolName: string;
  frequencies: Record<FrequencyGranularityWindow, number>;
  anomalyScore: number;
  isAnomaly: boolean;
}

/**
 * L1 统计引擎综合检测输出
 * IStatisticalEngine.processEvent() 最终返回结构
 *
 * V0 启用：zScore + frequency + markov
 * V1 Deferred：cusum + ewma（字段保留，运行时可选填充）
 */
export interface L1DetectionResult {
  zScore: ZScoreResult;
  /** V1 Deferred — 按维度索引的 CUSUM 结果 */
  cusum?: Record<string, CUSUMResult>;
  /** V1 Deferred — 按维度索引的 EWMA 结果 */
  ewma?: Record<string, EWMAResult>;
  frequency: FrequencyResult;
  markov: MarkovResult;
  /** 加权融合综合风险分 [0, 1] */
  combinedScore: number;
  isAnomaly: boolean;
  /** 行为基线偏离分 — BaselineService 融合 */
  baselineDeviation?: number;
  /** 单次检测耗时 (ms)，硬性指标 < 50ms */
  latencyMs: number;
}

/** 6维行为画像基线维度键 — 对齐架构文档 §3004-3300 */
export type L1BehaviorDimensionKey =
  | 'chain_depth'
  | 'arg_count'
  | 'tool_frequency'
  | 'latency'
  | 'error_rate'
  | 'user_repeat';