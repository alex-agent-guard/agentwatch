/**
 * AgentWatch 配置类型定义
 * 适配文档：task_proxy_config.md (§2 Config Manager, §3.1 ProxyConfig, YAML L6020-L6129)
 * 依赖：risk.types.ts — L1StatEngineConfig（统计阈值，不重复定义）
 * 规范：仅允许 type / interface / import type，无运行时值导出
 */
import type { L1StatEngineConfig } from './risk.types.js';

// 仅保留纯类型，移除所有export const运行时常量，规避TS1287编译错误
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFormat = 'json' | 'text';
export type MaskLevel = 0 | 1 | 2 | 3;

// ═══════════════════════════════════════════════════════════════
// 一、进程配置 — MCP Proxy 子进程启动、连接与 CLI
// ═══════════════════════════════════════════════════════════════
export interface ProxyServerConfig {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface ProxyConnectionConfig {
  /** 子进程 I/O 超时 (ms) */
  timeoutMs?: number;
  /** Server 崩溃后自动重启 — 架构测试要求「子进程崩溃后优雅恢复」 */
  autoRestart?: boolean;
  /** 最大连续重启次数 */
  maxRestarts?: number;
}

export interface ProxyRuntimeConfig {
  /** 是否在响应中注入安全审计标记 — MPC-07 injectSecurityMarkers() */
  injectSecurityMarkers?: boolean;
}

export interface CliConfig {
  /** 配置文件绝对路径，默认 ~/.agentwatch/config.yaml */
  configPath?: string;
  /** `--` 之后的被代理 MCP Server 命令行参数 */
  serverArgs?: string[];
}

export interface ConfigLoaderOptions {
  /** 配置文件路径，支持 `~` 家目录展开 */
  configPath: string;
  /** 是否展开 ${ENV_VAR} 环境变量 — CFG-04 */
  envSubstitution: boolean;
  /** 是否展开 `~` 路径前缀 */
  expandTilde: boolean;
}

export interface HotReloadConfig {
  enabled: boolean;
  /** 文件变更防抖间隔 (ms) — 默认 500 */
  debounceMs: number;
}

export interface McpServersIntegrationConfig {
  mcpServers: Record<
    string,
    {
      command: string;
      args?: string[];
      env?: Record<string, string>;
    }
  >;
}

export interface ProxyConfig {
  server: ProxyServerConfig;
  agentWatch: AgentWatchConfig;
  performance: GlobalPerformanceConfig;
  connection?: ProxyConnectionConfig;
}

// ═══════════════════════════════════════════════════════════════
// 二、规则配置 — L0 规则引擎加载与开关
// ═══════════════════════════════════════════════════════════════
export interface RuleEngineConfig {
  /** 规则引擎开关 — get('detection.ruleEngine.enabled') */
  enabled: boolean;
  /** 规则集加载路径（YAML/JSON）— loadRules() */
  rulesPath: string;
  /** 全量规则匹配延迟上限 (ms) — P99 < 10ms 硬性指标 */
  maxMatchTimeMs: number;
}

// ═══════════════════════════════════════════════════════════════
// 三、引擎配置 — 检测总开关、L1 统计、决策融合、基线、场景
// ═══════════════════════════════════════════════════════════════
export interface StatisticalEngineConfig extends L1StatEngineConfig {
  /** 统计引擎开关 */
  enabled: boolean;
}

export interface DecisionRouterConfig {
  /** 决策路由开关 */
  enabled?: boolean;
  /** BLOCK 阈值 — score >= blockThreshold，默认 0.8 */
  blockThreshold: number;
  /** WARN 阈值 — score >= warnThreshold，默认 0.5 */
  warnThreshold: number;
  /** L0 规则得分融合权重 — 默认 0.6 */
  ruleWeight: number;
  /** L1 统计得分融合权重 — 默认 0.4 */
  statWeight: number;
}

export interface BaselineConfig {
  /** 基线系统开关 */
  enabled?: boolean;
  /** 基线缓存持久化路径 */
  cachePath?: string;
}

export interface BaselineDeviationScenarioConfig {
  /**
   * 基线遗忘衰减粒度 — false（默认）跨 UTC 日触发 0.95；
   * true 跨 UTC 月触发 0.95
   */
  monthlyDecay?: boolean;
}

export interface ScenariosConfig {
  /** 场景名 → 权重，默认权重之和 = 1.0 */
  weights?: Record<string, number>;
  /** 场景10 基线偏离 — 衰减与检测外围配置 */
  baselineDeviation?: BaselineDeviationScenarioConfig;
}

export interface DetectionConfig {
  /** 检测总开关（可选，各子引擎另有独立 enabled） */
  enabled?: boolean;
  /** A2A 跨代理场景检测 — 默认 false */
  a2aRisk?: boolean;
  /** A2A 已登记 Agent ID 白名单 */
  registeredAgentIds?: string[];
  /** 基线偏离独立场景检测 — 默认 true */
  baselineDeviation?: boolean;
  ruleEngine: RuleEngineConfig;
  statisticalEngine: StatisticalEngineConfig;
  decisionRouter: DecisionRouterConfig;
}

export interface GlobalPerformanceConfig {
  /** 含 L0+L1 的检测总延迟上限 (ms) — DR-007 延迟预算 */
  maxDetectionLatencyMs: number;
}

// ═══════════════════════════════════════════════════════════════
// 四、日志配置 — 本地输出、脱敏、轮转与云端上报
// ═══════════════════════════════════════════════════════════════
export interface LogMaskConfig {
  /** 是否启用参数脱敏 */
  enabled: boolean;
  /** 默认脱敏级别 */
  level: MaskLevel;
  /**
   * 敏感字段列表 — 默认：
   * apiKey, secret, privateKey, password, mnemonic
   */
  sensitiveFields: string[];
}

export interface LogRotationConfig {
  /** 单文件大小上限 (MB) — 默认 100，超出触发额外轮转 */
  maxSizeMB: number;
  /** 保留文件数 / 天数 — 默认 7 */
  maxFiles: number;
  /** 超期文件 gzip 压缩 */
  compress?: boolean;
}

export interface CloudBatchConfig {
  /** 单批最大条数 — 默认 100 */
  batchSize: number;
  /** flush 间隔 (ms) — 默认 5000 */
  flushIntervalMs: number;
  /** 失败退避最大重试次数 — 默认 3 */
  maxRetries?: number;
}

export interface CloudConfig {
  enabled: boolean;
  /** 上报 endpoint 基址 — Supabase 项目 URL 或 legacy REST 基址 */
  endpoint: string;
  /**
   * Edge Function 网关 anon key（仅调用 /functions/v1/upload-events，禁止直连 INSERT events）
   * 支持 ${AGENTWATCH_API_KEY} 环境变量替换
   */
  apiKey: string;
  /** CLI 侧 upload_secret 明文 — 支持 ${AGENTWATCH_UPLOAD_SECRET} 环境变量替换 */
  uploadSecret?: string;
  batch: CloudBatchConfig;
}

export interface LoggingConfig {
  level: LogLevel;
  format: LogFormat;
  /** 本地日志文件路径 — 默认 ~/.agentwatch/log.jsonl */
  output: string;
  /** 内存缓冲区大小 — 默认 100 条 */
  bufferSize?: number;
  mask: LogMaskConfig;
  rotation: LogRotationConfig;
}

// ═══════════════════════════════════════════════════════════════
// 根配置 — ~/.agentwatch/config.yaml 完整对象
// ═══════════════════════════════════════════════════════════════
export interface AgentWatchConfig {
  agentId?: string;
  userId?: string;
  proxy?: ProxyRuntimeConfig;
  performance: GlobalPerformanceConfig;
  detection: DetectionConfig;
  baseline?: BaselineConfig;
  logging: LoggingConfig;
  /** 云端上报配置 — ConfigManager 加载后始终填充 */
  cloud?: CloudConfig;
  scenarios?: ScenariosConfig;
  hotReload?: HotReloadConfig;
}

// 阈值总配置，放置文件末尾消除前向引用报错
export interface ThresholdConfig {
  ruleEngine: Pick<RuleEngineConfig, 'maxMatchTimeMs'>;
  statisticalEngine: L1StatEngineConfig;
  decisionRouter: Pick<
    DecisionRouterConfig,
    'blockThreshold' | 'warnThreshold' | 'ruleWeight' | 'statWeight'
  >;
}