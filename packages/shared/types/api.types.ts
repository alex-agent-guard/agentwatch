/**
 * 模块间顶层抽象接口
 * 适配文档：task_proxy_config.md (§3.2 L5006-L5075)
 */
import type { DetectionEvent } from './event.types.js';
import type { RuleMatchResult, RuleSet } from './rule.types.js';
import type { BaselineCache, L1DetectionResult } from './risk.types.js';
import type {
  DetectionResult,
  JSONRPCRequest,
  ToolCallEvent,
} from './proxy.types.js';
import type { AlertRecord, BehaviorLogEntry, LogFilter } from './logging.types.js';
import type {
  AgentWatchConfig,
  CloudConfig,
  DecisionRouterConfig,
  DetectionConfig,
  LoggingConfig,
  ProxyConfig,
  RuleEngineConfig,
  StatisticalEngineConfig,
} from './config.types.js';
import type { L1StatEngineConfig } from './risk.types.js';

/** 引擎运行状态 — IDetectionEngine.getStatus() */
export type EngineStatus =
  | 'idle'
  | 'running'
  | 'degraded'
  | 'error'
  | 'reloading';

/** 引擎性能指标 — IDetectionEngine.getMetrics() */
export interface EngineMetrics {
  eventsProcessed: number;
  anomaliesDetected: number;
  avgLatencyMs: number;
  p99LatencyMs: number;
  uptimeMs: number;
  lastEventAt?: number;
}

/** L0 规则引擎统计 — IRuleEngine.getStats() */
export interface RuleEngineStats {
  totalRules: number;
  enabledRules: number;
  totalMatches: number;
  avgLatencyMs: number;
  p99LatencyMs: number;
}

/** L1 基线维度统计快照 — IStatisticalEngine.getBaselineStats() */
export interface BaselineDimensionStats {
  mean: number;
  variance: number;
  count: number;
}

/** 规则引擎统一接口 — IRuleEngine L5026-L5035 */
export interface IRuleEngine {
  match(event: DetectionEvent): RuleMatchResult[];
  loadRuleSet(ruleSet: RuleSet): void | Promise<void>;
  /** 从外部 YAML/JSON 规则文件加载并编译规则集 */
  loadRuleSetFromFile(filePath: string): RuleSet;
  getStats(): RuleEngineStats;
}

/** 统计引擎统一接口 — IStatisticalEngine L5038-L5047 */
export interface IStatisticalEngine {
  processEvent(event: DetectionEvent): L1DetectionResult;
  updateBaseline(cache: BaselineCache): void;
  loadBaseline(): BaselineCache;
  /** 加载 V0 内置 L1 时序基线静态数据集 */
  loadBuiltinBaseline(timestamp?: number): void;
  /** 导出各维度 Welford 在线基线统计快照 */
  getBaselineStats(): Record<string, BaselineDimensionStats>;
}

/**
 * 检测引擎顶层聚合接口 — IDetectionEngine L5011-L5023
 * V0 由 MCPProxyCore + RuleEngine + StatEngine + DecisionRouter 协同实现
 */
export interface IDetectionEngine {
  detect(event: ToolCallEvent): DetectionResult | Promise<DetectionResult>;
  getStatus(): EngineStatus;
  reloadRules(): void | Promise<void>;
  getMetrics(): EngineMetrics;
  /** 热重载 L0 规则集（V0 预留 reloadRules 别名契约） */
  reloadRuleSet?(): void | Promise<void>;
  /** 热重载 L1 基线缓存（V1 预留） */
  reloadBaseline?(): void | Promise<void>;
  /** 优雅关闭检测引擎子组件（V1 预留） */
  shutdown?(): void | Promise<void>;
}

/** 日志记录器接口 — ILogger L5050-L5062 */
export interface ILogger {
  logBlocked(
    request: JSONRPCRequest,
    result: DetectionResult,
  ): void | Promise<void>;
  logAllowed(
    request: JSONRPCRequest,
    result: DetectionResult,
  ): void | Promise<void>;
  logWarn(
    request: JSONRPCRequest,
    result: DetectionResult,
  ): void | Promise<void>;
  logRaw(
    request: JSONRPCRequest,
    result?: DetectionResult,
  ): void | Promise<void>;
  logAlert(alert: AlertRecord): void | Promise<void>;
  queryLogs(filter: LogFilter): BehaviorLogEntry[];
  flush(): void | Promise<void>;
  /** 同步写入刷盘 — 与 flush 等价，供 bootstrap 崩溃兜底调用 */
  writeFlush(): void | Promise<void>;
  /** process.beforeExit 同步落盘 — 致命/退出阶段不抛错 */
  beforeExit(): void;
  shutdown(): void | Promise<void>;
}

/** 完整配置集 — ConfigManager.loadYamlConfig() 输出 */
export interface ConfigSet {
  proxy: ProxyConfig;
  rule: RuleEngineConfig;
  stat: StatisticalEngineConfig;
  detection: DetectionConfig;
  agentWatch: AgentWatchConfig;
  env: Record<string, string>;
}

/** L0/L1/决策路由性能与阈值 — getDetectionThresholds() 输出 */
export interface DetectionOrchestratorConfig {
  maxDetectionLatencyMs: number;
  ruleEngine: Pick<RuleEngineConfig, 'enabled' | 'maxMatchTimeMs' | 'rulesPath'>;
  statisticalEngine: L1StatEngineConfig & { enabled: boolean };
  decisionRouter: Pick<
    DecisionRouterConfig,
    'enabled' | 'blockThreshold' | 'warnThreshold' | 'ruleWeight' | 'statWeight'
  >;
}

/** 配置管理器接口 — IConfigManager L5065-L5074 */
export interface IConfigManager {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
  reload(): void | Promise<void>;
  loadYamlConfig(filePath: string): ConfigSet;
  readEnv(prefix?: string): Record<string, string>;
  getProxyConfig(): ProxyConfig;
  getLoggingConfig(): LoggingConfig;
  getCloudConfig(): CloudConfig;
  getDetectionThresholds(): DetectionOrchestratorConfig;
}
