export * from './rule.types.js';
export * from './event.types.js';
export * from './risk.types.js';
export * from './config.types.js';
export * from './proxy.types.js';
export * from './session.types.js';
export * from './api.types.js';
export * from './logging.types.js';
export * from './fusion.types.js';

/** 顶层模块契约 — 显式导出供 tsc/IDE 聚合校验 */
export type {
  BaselineDimensionStats,
  ConfigSet,
  DetectionOrchestratorConfig,
  EngineMetrics,
  EngineStatus,
  IDetectionEngine,
  IConfigManager,
  ILogger,
  IRuleEngine,
  IStatisticalEngine,
  RuleEngineStats,
} from './api.types.js';

export type { IDecisionRouter, FusionResult, CombinationRule } from './fusion.types.js';
