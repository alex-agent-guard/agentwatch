/**
 * Config Manager — YAML 加载、环境变量解析、Schema 校验
 * 契约：IConfigManager + loadYamlConfig / readEnv / getProxyConfig / getDetectionThresholds
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

import {
  DEFAULT_BLOCK_THRESHOLD,
  DEFAULT_CONFIG_RELATIVE,
  DEFAULT_IO_TIMEOUT_MS,
  DEFAULT_LOG_MASK_CONFIG,
  DEFAULT_MAX_DETECTION_LATENCY_MS,
  DEFAULT_MAX_MATCH_TIME_MS,
  DEFAULT_MAX_RESTARTS,
  DEFAULT_RULE_WEIGHT,
  DEFAULT_STAT_WEIGHT,
  DEFAULT_WARN_THRESHOLD,
  DEDICATED_ENV_KEYS,
  RiskType,
} from '@packages/shared/constants';

import { parseCloudConfig } from './cloud-config.js';

import type { IConfigManager } from '@packages/shared/types';
import type {
  AgentWatchConfig,
  CloudConfig,
  ConfigLoaderOptions,
  DecisionRouterConfig,
  DetectionConfig,
  GlobalPerformanceConfig,
  LoggingConfig,
  LogLevel,
  LogFormat,
  LogMaskConfig,
  MaskLevel,
  ProxyConfig,
  ProxyConnectionConfig,
  ProxyServerConfig,
  RuleEngineConfig,
  ScenariosConfig,
  StatisticalEngineConfig,
  BaselineDeviationScenarioConfig,
} from '@packages/shared/types';
import type { L1StatEngineConfig } from '@packages/shared/types';

/** 完整配置集 — proxy / rule / stat / detection 四段校验后输出 */
export interface ConfigSet {
  proxy: ProxyConfig;
  rule: RuleEngineConfig;
  stat: StatisticalEngineConfig;
  detection: DetectionConfig;
  agentWatch: AgentWatchConfig;
  env: Record<string, string>;
}

/** L0/L1/决策路由性能与阈值 — 供 DetectionOrchestrator / MCPProxyCore 注入 */
export interface DetectionOrchestratorConfig {
  maxDetectionLatencyMs: number;
  ruleEngine: Pick<RuleEngineConfig, 'enabled' | 'maxMatchTimeMs' | 'rulesPath'>;
  statisticalEngine: L1StatEngineConfig & { enabled: boolean };
  decisionRouter: Pick<
    DecisionRouterConfig,
    'enabled' | 'blockThreshold' | 'warnThreshold' | 'ruleWeight' | 'statWeight'
  >;
}

type YamlValue =
  | string
  | number
  | boolean
  | null
  | YamlValue[]
  | { [key: string]: YamlValue };

type StructuredConfigError = Error & {
  eventId: string | null;
  riskType: string;
  originalStack: string;
};

const DEFAULT_RULE_ENGINE: RuleEngineConfig = {
  enabled: true,
  rulesPath: join(homedir(), '.agentwatch', 'rules', 'builtin.json'),
  maxMatchTimeMs: DEFAULT_MAX_MATCH_TIME_MS,
};

const DEFAULT_STAT_ENGINE: StatisticalEngineConfig = {
  enabled: true,
  zScoreThreshold: 3,
  coldStartMinSamples: 30,
  combinedScoreThreshold: 0.7,
  maxZScoreThreshold: 4,
  markovAnomalyThreshold: 0.7,
  markovUnknownRatioThreshold: 0.5,
  markovSmoothingAlpha: 0.1,
  windowSizeMs: 300_000,
};

const DEFAULT_DECISION_ROUTER: DecisionRouterConfig = {
  enabled: true,
  blockThreshold: DEFAULT_BLOCK_THRESHOLD,
  warnThreshold: DEFAULT_WARN_THRESHOLD,
  ruleWeight: DEFAULT_RULE_WEIGHT,
  statWeight: DEFAULT_STAT_WEIGHT,
};

const DEFAULT_DETECTION: DetectionConfig = {
  enabled: true,
  baselineDeviation: true,
  ruleEngine: DEFAULT_RULE_ENGINE,
  statisticalEngine: DEFAULT_STAT_ENGINE,
  decisionRouter: DEFAULT_DECISION_ROUTER,
};

const DEFAULT_PERFORMANCE: GlobalPerformanceConfig = {
  maxDetectionLatencyMs: DEFAULT_MAX_DETECTION_LATENCY_MS,
};

const DEFAULT_LOGGING: LoggingConfig = {
  level: 'info',
  format: 'json',
  output: join(homedir(), '.agentwatch', 'log.jsonl'),
  bufferSize: 100,
  mask: {
    enabled: DEFAULT_LOG_MASK_CONFIG.enabled,
    level: DEFAULT_LOG_MASK_CONFIG.level,
    sensitiveFields: [...DEFAULT_LOG_MASK_CONFIG.sensitiveFields],
  },
  rotation: {
    maxSizeMB: 100,
    maxFiles: 7,
    compress: true,
  },
};

const DEFAULT_SERVER: ProxyServerConfig = {
  command: 'node',
  args: [],
};

const DEFAULT_CONNECTION: ProxyConnectionConfig = {
  timeoutMs: DEFAULT_IO_TIMEOUT_MS,
  autoRestart: true,
  maxRestarts: DEFAULT_MAX_RESTARTS,
};

/**
 * 配置管理器 — YAML 加载、环境变量解析、Schema 校验
 * 契约：task_proxy_config.md CM-001~005 / IConfigManager (api.types.ts)
 */
export class ConfigManager implements IConfigManager {
  private configSet: ConfigSet;
  private readonly loaderOptions: ConfigLoaderOptions;

  // TODO(DR-V1): 云端配置同步 — pull remote config revision and merge
  // TODO(DR-V1): 多环境切换 — dev/staging/prod profile selector
  // TODO(DR-V1): 配置热重载 — fs.watch debounced reload with subscriber notify

  constructor(options?: Partial<ConfigLoaderOptions>) {
    const configPath = expandTilde(
      options?.configPath
        ?? process.env['AGENTWATCH_CONFIG_PATH']
        ?? join(homedir(), DEFAULT_CONFIG_RELATIVE),
    );
    this.loaderOptions = {
      configPath,
      envSubstitution: options?.envSubstitution ?? true,
      expandTilde: options?.expandTilde ?? true,
    };
    this.configSet = this.bootstrapFromDisk();
  }

  /** 点号路径读取 — task_proxy_config.md CFG-01 */
  get<T>(key: string): T | undefined {
    return getByDotPath(this.configSet.agentWatch as unknown as Record<string, unknown>, key) as
      | T
      | undefined;
  }

  /** 运行时内存写入（V0 不自动落盘）— task_proxy_config.md CFG-02 */
  set<T>(key: string, value: T): void {
    setByDotPath(
      this.configSet.agentWatch as unknown as Record<string, unknown>,
      key,
      value as unknown,
    );
    this.syncDerivedSections();
  }

  /** 从磁盘重载 YAML，失败保留旧配置 — task_proxy_config.md CFG-03 */
  reload(): void {
    const perfStart = performance.now();
    try {
      this.configSet = this.bootstrapFromDisk();
    } catch (error) {
      throw createStructuredConfigError(
        'Config reload failed; previous in-memory config retained',
        null,
        RiskType.CONFIG_RELOAD_FAILED,
        error,
      );
    }
    logConfigPerformance('reload', perfStart, 50);
  }

  loadYamlConfig(filePath: string): ConfigSet {
    const perfStart = performance.now();
    const resolvedPath = this.loaderOptions.expandTilde
      ? expandTilde(filePath)
      : filePath;

    let raw: Record<string, unknown>;
    try {
      if (!existsSync(resolvedPath)) {
        ensureParentDir(resolvedPath);
        writeFileSync(resolvedPath, buildDefaultYamlTemplate(), 'utf8');
      }
      const content = readFileSync(resolvedPath, 'utf8');
      raw = parseYaml(content) as Record<string, unknown>;
    } catch (error) {
      throw createStructuredConfigError(
        `Failed to read or parse YAML config at ${resolvedPath}`,
        null,
        RiskType.CONFIG_YAML_PARSE_FAILED,
        error,
      );
    }

    const env = this.readDedicatedEnv();
    const merged = mergeEnvIntoRaw(raw, env, this.loaderOptions.envSubstitution);
    const configSet = buildConfigSet(merged, env);
    logConfigPerformance('loadYamlConfig', perfStart, 50);
    return configSet;
  }

  readEnv(prefix?: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value === undefined) {
        continue;
      }
      if (prefix === undefined || key.startsWith(prefix)) {
        result[key] = value;
      }
    }
    if (prefix === undefined) {
      for (const key of DEDICATED_ENV_KEYS) {
        const value = process.env[key];
        if (value !== undefined) {
          result[key] = value;
        }
      }
    } else {
      for (const key of DEDICATED_ENV_KEYS) {
        if (!key.startsWith(prefix)) {
          continue;
        }
        const value = process.env[key];
        if (value !== undefined) {
          result[key] = value;
        }
      }
    }
    return result;
  }

  getProxyConfig(): ProxyConfig {
    const proxyConfig = this.configSet.proxy;
    const override = process.env['AGENTWATCH_OVERRIDE_SERVER'];
    if (override) {
      try {
        const parsed = JSON.parse(override) as {
          command?: string;
          args?: string[];
        };
        return {
          ...proxyConfig,
          server: {
            ...proxyConfig.server,
            command: parsed.command || proxyConfig.server.command,
            ...(parsed.args !== undefined
              ? { args: parsed.args }
              : proxyConfig.server.args !== undefined
                ? { args: proxyConfig.server.args }
                : {}),
            ...(proxyConfig.server.env !== undefined ? { env: proxyConfig.server.env } : {}),
            ...(proxyConfig.server.cwd !== undefined ? { cwd: proxyConfig.server.cwd } : {}),
          },
        };
      } catch {
        // ignore malformed AGENTWATCH_OVERRIDE_SERVER
      }
    }
    return proxyConfig;
  }

  getLoggingConfig(): LoggingConfig {
    return this.configSet.agentWatch.logging;
  }

  getCloudConfig(): CloudConfig {
    return (
      this.configSet.agentWatch.cloud ?? parseCloudConfig({}, this.configSet.env, {
        readOptionalBoolean,
        readOptionalString,
        readOptionalPositiveNumber,
        readRecord,
      })
    );
  }

  getDetectionThresholds(): DetectionOrchestratorConfig {
    const { detection, proxy } = this.configSet;
    return {
      maxDetectionLatencyMs: proxy.performance.maxDetectionLatencyMs,
      ruleEngine: {
        enabled: detection.ruleEngine.enabled,
        maxMatchTimeMs: detection.ruleEngine.maxMatchTimeMs,
        rulesPath: detection.ruleEngine.rulesPath,
      },
      statisticalEngine: {
        enabled: detection.statisticalEngine.enabled,
        zScoreThreshold: detection.statisticalEngine.zScoreThreshold,
        coldStartMinSamples: detection.statisticalEngine.coldStartMinSamples,
        combinedScoreThreshold: detection.statisticalEngine.combinedScoreThreshold,
        maxZScoreThreshold: detection.statisticalEngine.maxZScoreThreshold,
        markovAnomalyThreshold: detection.statisticalEngine.markovAnomalyThreshold,
        markovUnknownRatioThreshold:
          detection.statisticalEngine.markovUnknownRatioThreshold,
        markovSmoothingAlpha: detection.statisticalEngine.markovSmoothingAlpha,
        windowSizeMs: detection.statisticalEngine.windowSizeMs,
        ...(detection.statisticalEngine.cusumThreshold !== undefined
          ? { cusumThreshold: detection.statisticalEngine.cusumThreshold }
          : {}),
        ...(detection.statisticalEngine.ewmaLambda !== undefined
          ? { ewmaLambda: detection.statisticalEngine.ewmaLambda }
          : {}),
        ...(detection.statisticalEngine.markovOrder !== undefined
          ? { markovOrder: detection.statisticalEngine.markovOrder }
          : {}),
      },
      decisionRouter: {
        enabled: detection.decisionRouter.enabled ?? true,
        blockThreshold: detection.decisionRouter.blockThreshold,
        warnThreshold: detection.decisionRouter.warnThreshold,
        ruleWeight: detection.decisionRouter.ruleWeight,
        statWeight: detection.decisionRouter.statWeight,
      },
    };
  }

  private bootstrapFromDisk(): ConfigSet {
    return this.loadYamlConfig(this.loaderOptions.configPath);
  }

  private readDedicatedEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const key of DEDICATED_ENV_KEYS) {
      const value = process.env[key];
      if (value !== undefined) {
        env[key] = value;
      }
    }
    return env;
  }

  private syncDerivedSections(): void {
    const agentWatch = this.configSet.agentWatch;
    this.configSet = {
      ...this.configSet,
      rule: agentWatch.detection.ruleEngine,
      stat: agentWatch.detection.statisticalEngine,
      detection: agentWatch.detection,
      proxy: {
        ...this.configSet.proxy,
        agentWatch,
        performance: agentWatch.performance,
      },
    };
  }
}

function buildConfigSet(
  raw: Record<string, unknown>,
  env: Record<string, string>,
): ConfigSet {
  const server = validateProxyServer(readRecord(raw, 'server', {}));
  const connection = validateConnection(readRecord(raw, 'connection', {}));
  const agentWatch = validateAgentWatch(
    readRecord(raw, 'agentWatch', raw),
    env,
  );
  const topPerformance = validatePerformance(
    readRecord(raw, 'performance', {}),
    'performance',
  );

  const performance: GlobalPerformanceConfig = {
    maxDetectionLatencyMs:
      topPerformance.maxDetectionLatencyMs ??
      agentWatch.performance.maxDetectionLatencyMs,
  };

  const proxy: ProxyConfig = {
    server,
    agentWatch: {
      ...agentWatch,
      performance: {
        maxDetectionLatencyMs: performance.maxDetectionLatencyMs,
      },
    },
    performance,
    ...(connection !== undefined ? { connection } : {}),
  };

  return {
    proxy,
    rule: agentWatch.detection.ruleEngine,
    stat: agentWatch.detection.statisticalEngine,
    detection: agentWatch.detection,
    agentWatch,
    env,
  };
}

function validateAgentWatch(
  raw: Record<string, unknown>,
  env: Record<string, string>,
): AgentWatchConfig {
  const detectionRaw = readRecord(raw, 'detection', {});
  const loggingRaw = readRecord(raw, 'logging', {});
  const cloudRaw = readRecord(raw, 'cloud', {});

  const performance = validatePerformance(
    readRecord(raw, 'performance', {}),
    'agentWatch.performance',
  );
  const ruleEngine = validateRuleEngine(
    readRecord(detectionRaw, 'ruleEngine', {}),
  );
  const statisticalEngine = validateStatEngine(
    readRecord(detectionRaw, 'statisticalEngine', {}),
  );
  const decisionRouter = validateDecisionRouter(
    readRecord(detectionRaw, 'decisionRouter', {}),
  );

  const detection: DetectionConfig = {
    ruleEngine,
    statisticalEngine,
    decisionRouter,
    ...(readOptionalBoolean(detectionRaw, 'enabled') !== undefined
      ? { enabled: readOptionalBoolean(detectionRaw, 'enabled')! }
      : DEFAULT_DETECTION.enabled !== undefined
        ? { enabled: DEFAULT_DETECTION.enabled }
        : {}),
    ...(readOptionalBoolean(detectionRaw, 'a2aRisk') !== undefined
      ? { a2aRisk: readOptionalBoolean(detectionRaw, 'a2aRisk')! }
      : {}),
    ...(readOptionalBoolean(detectionRaw, 'baselineDeviation') !== undefined
      ? { baselineDeviation: readOptionalBoolean(detectionRaw, 'baselineDeviation')! }
      : DEFAULT_DETECTION.baselineDeviation !== undefined
        ? { baselineDeviation: DEFAULT_DETECTION.baselineDeviation }
        : {}),
    ...(readOptionalStringArray(detectionRaw, 'registeredAgentIds') !== undefined
      ? {
          registeredAgentIds: readOptionalStringArray(detectionRaw, 'registeredAgentIds')!,
        }
      : {}),
  };

  const logging = validateLogging(loggingRaw);
  const cloud = parseCloudConfig(cloudRaw, env, {
    readOptionalBoolean,
    readOptionalString,
    readOptionalPositiveNumber,
    readRecord,
  });
  const scenarios = validateScenarios(readRecord(raw, 'scenarios', {}));

  const agentWatch: AgentWatchConfig = {
    performance,
    detection,
    logging,
    cloud,
    ...(scenarios !== undefined ? { scenarios } : {}),
    ...(readOptionalString(raw, 'agentId') !== undefined
      ? { agentId: readOptionalString(raw, 'agentId')! }
      : {}),
    ...(readOptionalString(raw, 'userId') !== undefined
      ? { userId: readOptionalString(raw, 'userId')! }
      : {}),
    ...(readRecord(raw, 'proxy', {})['injectSecurityMarkers'] !== undefined
      ? {
          proxy: {
            injectSecurityMarkers: readRequiredBoolean(
              readRecord(raw, 'proxy', {}),
              'injectSecurityMarkers',
              'agentWatch.proxy.injectSecurityMarkers',
            ),
          },
        }
      : { proxy: { injectSecurityMarkers: true } }),
  };

  return agentWatch;
}

function validateScenarios(raw: Record<string, unknown>): ScenariosConfig | undefined {
  if (Object.keys(raw).length === 0) {
    return undefined;
  }

  const scenarios: ScenariosConfig = {};
  const weightsRaw = readRecord(raw, 'weights', {});

  if (Object.keys(weightsRaw).length > 0) {
    const weights: Record<string, number> = {};
    for (const [key, value] of Object.entries(weightsRaw)) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        weights[key] = value;
      }
    }
    if (Object.keys(weights).length > 0) {
      scenarios.weights = weights;
    }
  }

  const baselineDeviationRaw = readRecord(raw, 'baselineDeviation', {});
  const monthlyDecay = readOptionalBoolean(baselineDeviationRaw, 'monthlyDecay');
  if (monthlyDecay !== undefined) {
    const baselineDeviation: BaselineDeviationScenarioConfig = { monthlyDecay };
    scenarios.baselineDeviation = baselineDeviation;
  }

  return Object.keys(scenarios).length > 0 ? scenarios : undefined;
}

function validateProxyServer(raw: Record<string, unknown>): ProxyServerConfig {
  const command = readOptionalString(raw, 'command') ?? DEFAULT_SERVER.command;
  if (command.length === 0) {
    throwFieldError('server.command', 'must be a non-empty string');
  }

  const rawArgs = raw['args'];
  let args: string[];
  const isEmptyArgs =
    rawArgs === undefined ||
    rawArgs === null ||
    (typeof rawArgs === 'string' &&
      (rawArgs.trim().length === 0 || rawArgs.trim() === '[]')) ||
    (Array.isArray(rawArgs) && rawArgs.length === 0) ||
    (typeof rawArgs === 'object' &&
      !Array.isArray(rawArgs) &&
      Object.keys(rawArgs as Record<string, unknown>).length === 0);
  if (isEmptyArgs) {
    args = DEFAULT_SERVER.args ?? [];
  } else {
    args = readOptionalStringArray(raw, 'args') ?? DEFAULT_SERVER.args ?? [];
  }
  const cwd = readOptionalString(raw, 'cwd');
  const env = readOptionalStringRecord(raw, 'env');

  return {
    command,
    args,
    ...(cwd !== undefined ? { cwd } : {}),
    ...(env !== undefined ? { env } : {}),
  };
}

function validateConnection(
  raw: Record<string, unknown>,
): ProxyConnectionConfig | undefined {
  if (Object.keys(raw).length === 0) {
    return DEFAULT_CONNECTION;
  }

  const timeoutMs =
    readOptionalPositiveNumber(raw, 'timeoutMs', 'connection.timeoutMs') ??
    DEFAULT_CONNECTION.timeoutMs;
  const autoRestart =
    readOptionalBoolean(raw, 'autoRestart') ?? DEFAULT_CONNECTION.autoRestart;
  const maxRestarts =
    readOptionalPositiveNumber(raw, 'maxRestarts', 'connection.maxRestarts') ??
    DEFAULT_CONNECTION.maxRestarts;

  return {
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(autoRestart !== undefined ? { autoRestart } : {}),
    ...(maxRestarts !== undefined ? { maxRestarts } : {}),
  };
}

function validatePerformance(
  raw: Record<string, unknown>,
  fieldPath: string,
): GlobalPerformanceConfig {
  const maxDetectionLatencyMs =
    readOptionalPositiveNumber(raw, 'maxDetectionLatencyMs', `${fieldPath}.maxDetectionLatencyMs`) ??
    DEFAULT_PERFORMANCE.maxDetectionLatencyMs;

  return { maxDetectionLatencyMs };
}

function validateRuleEngine(raw: Record<string, unknown>): RuleEngineConfig {
  const enabled = readOptionalBoolean(raw, 'enabled') ?? DEFAULT_RULE_ENGINE.enabled;
  const rulesPath =
    readOptionalString(raw, 'rulesPath') ?? DEFAULT_RULE_ENGINE.rulesPath;
  const maxMatchTimeMs =
    readOptionalPositiveNumber(raw, 'maxMatchTimeMs', 'detection.ruleEngine.maxMatchTimeMs') ??
    DEFAULT_RULE_ENGINE.maxMatchTimeMs;

  if (rulesPath.length === 0) {
    throwFieldError('detection.ruleEngine.rulesPath', 'must be a non-empty string');
  }

  return { enabled, rulesPath, maxMatchTimeMs };
}

function validateStatEngine(raw: Record<string, unknown>): StatisticalEngineConfig {
  const enabled =
    readOptionalBoolean(raw, 'enabled') ?? DEFAULT_STAT_ENGINE.enabled;

  const zScoreThreshold =
    readOptionalNumber(raw, 'zScoreThreshold', 'detection.statisticalEngine.zScoreThreshold') ??
    DEFAULT_STAT_ENGINE.zScoreThreshold;
  const coldStartMinSamples =
    readOptionalPositiveNumber(
      raw,
      'coldStartMinSamples',
      'detection.statisticalEngine.coldStartMinSamples',
    ) ?? DEFAULT_STAT_ENGINE.coldStartMinSamples;
  const combinedScoreThreshold =
    readOptionalNumber(
      raw,
      'combinedScoreThreshold',
      'detection.statisticalEngine.combinedScoreThreshold',
    ) ?? DEFAULT_STAT_ENGINE.combinedScoreThreshold;
  const maxZScoreThreshold =
    readOptionalNumber(
      raw,
      'maxZScoreThreshold',
      'detection.statisticalEngine.maxZScoreThreshold',
    ) ?? DEFAULT_STAT_ENGINE.maxZScoreThreshold;
  const markovAnomalyThreshold =
    readOptionalNumber(
      raw,
      'markovAnomalyThreshold',
      'detection.statisticalEngine.markovAnomalyThreshold',
    ) ?? DEFAULT_STAT_ENGINE.markovAnomalyThreshold;
  const markovUnknownRatioThreshold =
    readOptionalNumber(
      raw,
      'markovUnknownRatioThreshold',
      'detection.statisticalEngine.markovUnknownRatioThreshold',
    ) ?? DEFAULT_STAT_ENGINE.markovUnknownRatioThreshold;
  const markovSmoothingAlpha =
    readOptionalNumber(
      raw,
      'markovSmoothingAlpha',
      'detection.statisticalEngine.markovSmoothingAlpha',
    ) ?? DEFAULT_STAT_ENGINE.markovSmoothingAlpha;
  const windowSizeMs =
    readOptionalPositiveNumber(
      raw,
      'windowSizeMs',
      'detection.statisticalEngine.windowSizeMs',
    ) ?? DEFAULT_STAT_ENGINE.windowSizeMs;

  return {
    enabled,
    zScoreThreshold,
    coldStartMinSamples,
    combinedScoreThreshold,
    maxZScoreThreshold,
    markovAnomalyThreshold,
    markovUnknownRatioThreshold,
    markovSmoothingAlpha,
    windowSizeMs,
    ...(readOptionalNumber(raw, 'cusumThreshold', 'detection.statisticalEngine.cusumThreshold') !==
    undefined
      ? {
          cusumThreshold: readOptionalNumber(
            raw,
            'cusumThreshold',
            'detection.statisticalEngine.cusumThreshold',
          )!,
        }
      : {}),
    ...(readOptionalNumber(raw, 'ewmaLambda', 'detection.statisticalEngine.ewmaLambda') !== undefined
      ? {
          ewmaLambda: readOptionalNumber(
            raw,
            'ewmaLambda',
            'detection.statisticalEngine.ewmaLambda',
          )!,
        }
      : {}),
    ...(readOptionalPositiveNumber(raw, 'markovOrder', 'detection.statisticalEngine.markovOrder') !==
    undefined
      ? {
          markovOrder: readOptionalPositiveNumber(
            raw,
            'markovOrder',
            'detection.statisticalEngine.markovOrder',
          )!,
        }
      : {}),
  };
}

function validateDecisionRouter(raw: Record<string, unknown>): DecisionRouterConfig {
  const blockThreshold =
    readOptionalNumber(raw, 'blockThreshold', 'detection.decisionRouter.blockThreshold') ??
    DEFAULT_DECISION_ROUTER.blockThreshold;
  const warnThreshold =
    readOptionalNumber(raw, 'warnThreshold', 'detection.decisionRouter.warnThreshold') ??
    DEFAULT_DECISION_ROUTER.warnThreshold;
  const ruleWeight =
    readOptionalNumber(raw, 'ruleWeight', 'detection.decisionRouter.ruleWeight') ??
    DEFAULT_DECISION_ROUTER.ruleWeight;
  const statWeight =
    readOptionalNumber(raw, 'statWeight', 'detection.decisionRouter.statWeight') ??
    DEFAULT_DECISION_ROUTER.statWeight;

  if (blockThreshold < 0 || blockThreshold > 1) {
    throwFieldError('detection.decisionRouter.blockThreshold', 'must be between 0 and 1');
  }
  if (warnThreshold < 0 || warnThreshold > 1) {
    throwFieldError('detection.decisionRouter.warnThreshold', 'must be between 0 and 1');
  }
  if (ruleWeight < 0 || ruleWeight > 1) {
    throwFieldError('detection.decisionRouter.ruleWeight', 'must be between 0 and 1');
  }
  if (statWeight < 0 || statWeight > 1) {
    throwFieldError('detection.decisionRouter.statWeight', 'must be between 0 and 1');
  }

  const enabledFlag = readOptionalBoolean(raw, 'enabled') ?? DEFAULT_DECISION_ROUTER.enabled;

  return {
    ...(enabledFlag !== undefined ? { enabled: enabledFlag } : {}),
    blockThreshold,
    warnThreshold,
    ruleWeight,
    statWeight,
  };
}

function validateLogging(raw: Record<string, unknown>): LoggingConfig {
  const level = (readOptionalString(raw, 'level') ?? DEFAULT_LOGGING.level) as LogLevel;
  const format = (readOptionalString(raw, 'format') ?? DEFAULT_LOGGING.format) as LogFormat;
  const output = normalizeLogOutput(
    readOptionalString(raw, 'output') ?? DEFAULT_LOGGING.output,
  );
  const bufferSize =
    readOptionalPositiveNumber(raw, 'bufferSize', 'logging.bufferSize') ??
    DEFAULT_LOGGING.bufferSize;

  if (!['debug', 'info', 'warn', 'error'].includes(level)) {
    throwFieldError('logging.level', 'must be one of debug|info|warn|error');
  }
  if (!['json', 'text'].includes(format)) {
    throwFieldError('logging.format', 'must be one of json|text');
  }

  const maskRaw = readRecord(raw, 'mask', {});

  const rotationRaw = readRecord(raw, 'rotation', {});
  const maxSizeMB =
    readOptionalPositiveNumber(rotationRaw, 'maxSizeMB', 'logging.rotation.maxSizeMB') ??
    DEFAULT_LOGGING.rotation.maxSizeMB;
  const maxFiles =
    readOptionalPositiveNumber(rotationRaw, 'maxFiles', 'logging.rotation.maxFiles') ??
    DEFAULT_LOGGING.rotation.maxFiles;

  const compress =
    readOptionalBoolean(rotationRaw, 'compress') ?? DEFAULT_LOGGING.rotation.compress;

  return {
    level,
    format,
    output,
    ...(bufferSize !== undefined ? { bufferSize } : {}),
    mask: parseMaskConfig(maskRaw),
    rotation: {
      maxSizeMB: maxSizeMB ?? DEFAULT_LOGGING.rotation.maxSizeMB,
      maxFiles: maxFiles ?? DEFAULT_LOGGING.rotation.maxFiles,
      ...(compress !== undefined ? { compress } : {}),
    },
  };
}

function parseMaskConfig(maskRaw: unknown): LogMaskConfig {
  try {
    const record =
      maskRaw !== null && typeof maskRaw === 'object' && !Array.isArray(maskRaw)
        ? (maskRaw as Record<string, unknown>)
        : {};

    let maskLevel =
      readOptionalNumber(record, 'level', 'logging.mask.level') ??
      DEFAULT_LOGGING.mask.level;
    if (![0, 1, 2, 3].includes(maskLevel)) {
      console.warn(
        `[ConfigManager] invalid logging.mask.level=${String(maskLevel)}, using default=${String(DEFAULT_LOGGING.mask.level)}`,
      );
      maskLevel = DEFAULT_LOGGING.mask.level;
    }

    const sensitiveFields =
      readOptionalStringArray(record, 'sensitiveFields') ??
      DEFAULT_LOGGING.mask.sensitiveFields;

    return {
      enabled: readOptionalBoolean(record, 'enabled') ?? DEFAULT_LOGGING.mask.enabled,
      level: maskLevel as MaskLevel,
      sensitiveFields,
    };
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    console.error(
      `[ConfigManager] failed to parse logging.mask, using defaults: ${detail}`,
    );
    return {
      enabled: DEFAULT_LOGGING.mask.enabled,
      level: DEFAULT_LOGGING.mask.level,
      sensitiveFields: [...DEFAULT_LOGGING.mask.sensitiveFields],
    };
  }
}

function mergeEnvIntoRaw(
  raw: Record<string, unknown>,
  env: Record<string, string>,
  substitute: boolean,
): Record<string, unknown> {
  const cloned = deepClone(raw) as Record<string, unknown>;
  if (substitute) {
    substituteEnvPlaceholders(cloned, process.env);
  }

  const cloud = readRecord(cloned, 'cloud', {});
  if (env.AGENTWATCH_API_KEY !== undefined) {
    cloud['apiKey'] = env.AGENTWATCH_API_KEY;
    cloned['cloud'] = cloud;
  }
  if (env.AGENTWATCH_UPLOAD_SECRET !== undefined) {
    cloud['uploadSecret'] = env.AGENTWATCH_UPLOAD_SECRET;
    cloned['cloud'] = cloud;
  }

  const serverEnv = readRecord(readRecord(cloned, 'server', {}), 'env', {});
  if (env.OKX_API_KEY !== undefined) {
    serverEnv['OKX_API_KEY'] = env.OKX_API_KEY;
  }
  if (env.OKX_SECRET_KEY !== undefined) {
    serverEnv['OKX_SECRET_KEY'] = env.OKX_SECRET_KEY;
  }
  if (env.OKX_PASSPHRASE !== undefined) {
    serverEnv['OKX_PASSPHRASE'] = env.OKX_PASSPHRASE;
  }
  if (env.OKX_PROJECT_ID !== undefined) {
    serverEnv['OKX_PROJECT_ID'] = env.OKX_PROJECT_ID;
  }
  if (Object.keys(serverEnv).length > 0) {
    const server = readRecord(cloned, 'server', {});
    server['env'] = serverEnv;
    cloned['server'] = server;
  }

  return cloned;
}

function substituteEnvPlaceholders(
  value: unknown,
  env: NodeJS.ProcessEnv,
): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      substituteEnvPlaceholders(item, env);
    }
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (typeof nested === 'string') {
        (value as Record<string, unknown>)[key] = resolveEnvString(nested, env);
      } else {
        substituteEnvPlaceholders(nested, env);
      }
    }
  }
}

function resolveEnvString(input: string, env: NodeJS.ProcessEnv): string {
  return input.replace(/\$\{([A-Z0-9_]+)\}/g, (_match, name: string) => {
    const value = env[name];
    if (value === undefined) {
      throwFieldError(`env.${name}`, `environment variable ${name} is not set`);
    }
    return value;
  });
}

function readRecord(
  raw: Record<string, unknown>,
  key: string,
  fallback: Record<string, unknown>,
): Record<string, unknown> {
  const value = raw[key];
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throwFieldError(key, 'must be an object');
  }
  return value as Record<string, unknown>;
}

function readRequiredString(
  raw: Record<string, unknown>,
  key: string,
  fieldPath: string,
): string {
  const value = raw[key];
  if (typeof value !== 'string' || value.length === 0) {
    throwFieldError(fieldPath, 'required non-empty string');
  }
  return value;
}

function readOptionalString(
  raw: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = raw[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throwFieldError(key, 'must be a string');
  }
  return value;
}

function readRequiredBoolean(
  raw: Record<string, unknown>,
  key: string,
  fieldPath: string,
): boolean {
  const value = raw[key];
  if (typeof value !== 'boolean') {
    throwFieldError(fieldPath, 'required boolean');
  }
  return value;
}

function readOptionalBoolean(
  raw: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const value = raw[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'boolean') {
    throwFieldError(key, 'must be a boolean');
  }
  return value;
}

function readOptionalNumber(
  raw: Record<string, unknown>,
  key: string,
  fieldPath: string,
): number | undefined {
  const value = raw[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throwFieldError(fieldPath, 'must be a number');
  }
  return value;
}

function readOptionalPositiveNumber(
  raw: Record<string, unknown>,
  key: string,
  fieldPath: string,
): number | undefined {
  const value = readOptionalNumber(raw, key, fieldPath);
  if (value === undefined) {
    return undefined;
  }
  if (value <= 0) {
    throwFieldError(fieldPath, 'must be a positive number');
  }
  return value;
}

function readOptionalStringArray(
  raw: Record<string, unknown>,
  key: string,
): string[] | undefined {
  const value = raw[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throwFieldError(key, 'must be a string array');
  }
  return value as string[];
}

function readOptionalStringRecord(
  raw: Record<string, unknown>,
  key: string,
): Record<string, string> | undefined {
  const value = raw[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throwFieldError(key, 'must be an object of string values');
  }
  for (const [entryKey, entryValue] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entryValue !== 'string') {
      throwFieldError(`${key}.${entryKey}`, 'must be a string');
    }
  }
  return value as Record<string, string>;
}

function throwFieldError(fieldPath: string, message: string): never {
  throw createStructuredConfigError(
    `Invalid config field ${fieldPath}: ${message}`,
    null,
    RiskType.CONFIG_VALIDATION_FAILED,
    new Error(`${fieldPath}: ${message}`),
  );
}

function createStructuredConfigError(
  message: string,
  eventId: string | null,
  riskType: string,
  cause: unknown,
): StructuredConfigError {
  const base =
    cause instanceof Error
      ? cause
      : new Error(typeof cause === 'string' ? cause : JSON.stringify(cause));

  const err = new Error(message, { cause: base }) as StructuredConfigError;
  err.eventId = eventId;
  err.riskType = riskType;
  err.originalStack = base.stack ?? String(cause);
  return err;
}

function getByDotPath(
  root: Record<string, unknown>,
  path: string,
): unknown {
  const segments = path.split('.').filter((segment) => segment.length > 0);
  let current: unknown = root;
  for (const segment of segments) {
    if (current === null || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function setByDotPath(
  root: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const segments = path.split('.').filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return;
  }
  let current: Record<string, unknown> = root;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index]!;
    const next = current[segment];
    if (next === undefined || next === null || typeof next !== 'object' || Array.isArray(next)) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }
  current[segments[segments.length - 1]!] = value;
}

function expandTilde(input: string): string {
  if (input.startsWith('~/')) {
    return join(homedir(), input.slice(2));
  }
  if (input === '~') {
    return homedir();
  }
  return input;
}

/** 归一化日志输出路径：.jsonl 保留单文件路径，目录按 cwd 解析 */
function normalizeLogOutput(output: string): string {
  const expanded = expandTilde(output.trim());

  if (expanded.endsWith('.jsonl')) {
    if (!expanded.startsWith('/')) {
      return resolve(process.cwd(), expanded);
    }
    return expanded;
  }

  if (!expanded.startsWith('/')) {
    return resolve(process.cwd(), expanded);
  }

  return expanded;
}

function ensureParentDir(filePath: string): void {
  const parent = dirname(filePath);
  if (!existsSync(parent)) {
    mkdirSync(parent, { recursive: true });
  }
}

function deepClone<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => deepClone(item)) as T;
  }
  if (value !== null && typeof value === 'object') {
    const cloned: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      cloned[key] = deepClone(nested);
    }
    return cloned as T;
  }
  return value;
}

function logConfigPerformance(
  operation: string,
  startMs: number,
  budgetMs: number,
): void {
  const durationMs = performance.now() - startMs;
  const withinBudget = durationMs <= budgetMs;
  console.info(
    `[ConfigManager][perf] op=${operation} durationMs=${durationMs.toFixed(3)} budgetMs=${String(budgetMs)} withinBudget=${String(withinBudget)}`,
  );
}

function buildDefaultYamlTemplate(): string {
  const rulesPath = join(homedir(), '.agentwatch', 'rules', 'builtin.yaml');
  const logOutput = '~/.agentwatch/log.jsonl';
  return [
    '# AgentWatch V0 default configuration',
    'server:',
    '  command: node',
    '  args: []',
    'performance:',
    '  maxDetectionLatencyMs: 50',
    'connection:',
    '  timeoutMs: 30000',
    '  autoRestart: true',
    '  maxRestarts: 3',
    'agentWatch:',
    '  performance:',
    '    maxDetectionLatencyMs: 50',
    '  detection:',
    '    enabled: true',
    '    ruleEngine:',
    '      enabled: true',
    `      rulesPath: ${rulesPath}`,
    '      maxMatchTimeMs: 10',
    '    statisticalEngine:',
    '      enabled: true',
    '      zScoreThreshold: 3',
    '      coldStartMinSamples: 30',
    '      combinedScoreThreshold: 0.7',
    '      maxZScoreThreshold: 4',
    '      markovAnomalyThreshold: 0.7',
    '      markovUnknownRatioThreshold: 0.5',
    '      markovSmoothingAlpha: 0.1',
    '      windowSizeMs: 300000',
    '    decisionRouter:',
    '      enabled: true',
    '      blockThreshold: 0.8',
    '      warnThreshold: 0.5',
    '      ruleWeight: 0.6',
    '      statWeight: 0.4',
    '    a2aRisk: false',
    '  logging:',
    '    level: info',
    '    format: json',
    `    output: ${logOutput}`,
    '    bufferSize: 100',
    '    mask:',
    '      enabled: true',
    '      level: 1',
    '      sensitiveFields:',
    '        - apiKey',
    '        - secret',
    '        - privateKey',
    '        - password',
    '        - mnemonic',
    '    rotation:',
    '      maxSizeMB: 100',
    '      maxFiles: 7',
    '      compress: true',
    '  proxy:',
    '    injectSecurityMarkers: true',
    '  cloud:',
    '    enabled: true',
    '    endpoint: https://kbjcikgoawxhotwwqtin.supabase.co/rest/v1/',
    '    apiKey: ${AGENTWATCH_API_KEY}',
    '    batch:',
    '      batchSize: 100',
    '      flushIntervalMs: 5000',
    '      maxRetries: 3',
    '  scenarios:',
    '    baselineDeviation:',
    '      monthlyDecay: false',
    '',
  ].join('\n');
}

function parseYaml(content: string): YamlValue {
  const lines = content
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !trimmed.startsWith('#');
    });

  const { value } = parseYamlBlock(lines, 0, 0);
  return value ?? {};
}

function parseYamlBlock(
  lines: string[],
  startIndex: number,
  indent: number,
): { value: YamlValue; nextIndex: number } {
  if (startIndex >= lines.length) {
    return { value: {}, nextIndex: startIndex };
  }

  const firstLine = lines[startIndex]!;
  const firstIndent = measureIndent(firstLine);
  if (firstIndent < indent) {
    return { value: {}, nextIndex: startIndex };
  }

  if (firstLine.trimStart().startsWith('- ')) {
    return parseYamlArray(lines, startIndex, indent);
  }

  const objectValue: Record<string, YamlValue> = {};
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index]!;
    const lineIndent = measureIndent(line);
    if (lineIndent < indent) {
      break;
    }
    if (lineIndent > indent) {
      throw new Error(`Invalid YAML indentation at line ${index + 1}`);
    }

    const trimmed = line.trim();
    if (trimmed.startsWith('- ')) {
      break;
    }

    const separatorIndex = trimmed.indexOf(':');
    if (separatorIndex <= 0) {
      throw new Error(`Invalid YAML mapping at line ${index + 1}`);
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const remainder = trimmed.slice(separatorIndex + 1).trim();

    if (remainder.length > 0) {
      objectValue[key] = parseYamlScalar(remainder);
      index += 1;
      continue;
    }

    const childStart = index + 1;
    if (childStart >= lines.length) {
      objectValue[key] = {};
      index = childStart;
      continue;
    }

    const childLine = lines[childStart]!;
    const childIndent = measureIndent(childLine);
    if (childIndent <= indent) {
      objectValue[key] = {};
      index = childStart;
      continue;
    }

    if (childLine.trimStart().startsWith('- ')) {
      const parsedArray = parseYamlArray(lines, childStart, childIndent);
      objectValue[key] = parsedArray.value;
      index = parsedArray.nextIndex;
      continue;
    }

    const parsedChild = parseYamlBlock(lines, childStart, childIndent);
    objectValue[key] = parsedChild.value;
    index = parsedChild.nextIndex;
  }

  return { value: objectValue, nextIndex: index };
}

function parseYamlArray(
  lines: string[],
  startIndex: number,
  indent: number,
): { value: YamlValue[]; nextIndex: number } {
  const items: YamlValue[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index]!;
    const lineIndent = measureIndent(line);
    if (lineIndent < indent) {
      break;
    }
    if (lineIndent !== indent || !line.trimStart().startsWith('- ')) {
      break;
    }

    const itemText = line.trimStart().slice(2).trim();
    if (itemText.length === 0) {
      const childStart = index + 1;
      if (childStart < lines.length && measureIndent(lines[childStart]!) > indent) {
        const parsedChild = parseYamlBlock(lines, childStart, indent + 2);
        items.push(parsedChild.value);
        index = parsedChild.nextIndex;
        continue;
      }
      items.push(null);
      index += 1;
      continue;
    }

    const inlineSeparator = itemText.indexOf(':');
    if (inlineSeparator > 0 && !itemText.startsWith('"') && !itemText.startsWith("'")) {
      const childStart = index + 1;
      if (childStart < lines.length && measureIndent(lines[childStart]!) > indent) {
        const objectLine = `${' '.repeat(indent + 2)}${itemText}`;
        const patched = [...lines];
        patched[index] = objectLine;
        const parsedChild = parseYamlBlock(patched, index, indent + 2);
        items.push(parsedChild.value);
        index = parsedChild.nextIndex;
        continue;
      }
    }

    items.push(parseYamlScalar(itemText));
    index += 1;
  }

  return { value: items, nextIndex: index };
}

function measureIndent(line: string): number {
  const match = line.match(/^ */);
  return match?.[0].length ?? 0;
}

function parseYamlScalar(raw: string): YamlValue {
  const value = raw.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  if (value === 'null' || value === '~') {
    return null;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  return value;
}
