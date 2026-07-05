/**
 * AgentWatch V0 全局常量
 * 契约来源：agentwatch_v0_mvp_tasklist.md / task_l0_engine.md / task_l1_engine.md /
 * task_proxy_config.md / task_router_logger_structure.md / 产品架构完整版.md
 */

// ─── 性能延迟预算 (ms) ───────────────────────────────────────────────────────

/** L0 RuleEngine 单次 match 延迟上限 — task_l0_engine.md L0-ENG-04 */
export const DEFAULT_MAX_MATCH_TIME_MS = 10;

/** L1 StatEngine 单次 processEvent 延迟上限 — task_l1_engine.md L1-ENG-01 */
export const DEFAULT_MAX_PROCESS_TIME_MS = 10;

/** DecisionRouter 单次决策延迟预算 — task_router_logger_structure.md DR-001（与 L0 match 预算对齐） */
export const DEFAULT_DECISION_BUDGET_MS = 10;

/** AsyncLogger 单次同步写入延迟预算 — task_router_logger_structure.md AL-002 */
export const DEFAULT_WRITE_BUDGET_MS = 10;

/** MCP Proxy 端到端检测延迟上限 — agentwatch_v0_mvp_tasklist.md MPC-05 */
export const DEFAULT_MAX_DETECTION_LATENCY_MS = 50;

// ─── 决策 / 融合阈值 ─────────────────────────────────────────────────────────

/** BLOCK 决策分数阈值 — task_router_logger_structure.md DR-001 */
export const DEFAULT_BLOCK_THRESHOLD = 0.8;

/** WARN 决策分数阈值 — task_router_logger_structure.md DR-001 */
export const DEFAULT_WARN_THRESHOLD = 0.5;

/** L0 规则引擎融合权重 — task_router_logger_structure.md DR-001 */
export const DEFAULT_RULE_WEIGHT = 0.6;

/** L1 统计引擎融合权重 — task_router_logger_structure.md DR-001 */
export const DEFAULT_STAT_WEIGHT = 0.4;

/** 基线偏离独立场景融合权重 — 产品架构 §6.10 baseline_deviation */
export const DEFAULT_BASELINE_DEVIATION_WEIGHT = 0.03;

/** L1 高异常等级分数阈值 — DecisionRouter.classifyL1Level */
export const L1_HIGH_SCORE_THRESHOLD = 0.7;

/** L1 中异常等级分数阈值 — DecisionRouter.classifyL1Level */
export const L1_MEDIUM_SCORE_THRESHOLD = 0.4;

// ─── FIFO 双流管道 ───────────────────────────────────────────────────────────

/** FIFO 读端 EOF 后重开间隔 (ms) — 产品架构 §5.1 / bootstrap.ts pumpExternalPipe */
export const FIFO_REOPEN_MS = 10;

/** FIFO 心跳泵重启间隔 (ms) — 产品架构 §5.1 / bootstrap.ts attachExternalPipeReader */
export const FIFO_HEARTBEAT_MS = 250;

/** FIFO 单次 read 缓冲区字节数 — bootstrap.ts pumpExternalPipe */
export const FIFO_READ_BUFFER_BYTES = 65_536;

/** AgentWatch 家目录子路径 — task_proxy_config.md CFG-04 */
export const DEFAULT_AGENTWATCH_HOME_SUBDIR = '.agentwatch';

/** 外部网关 FIFO 文件名 — 产品架构 §5.1 双流管道 */
export const DEFAULT_FIFO_FILENAME = 'gateway.in.fifo';

/** 管道埋点阶段标识 — bootstrap.ts logPipeTrace */
export const PIPE_TRACE_STAGES = [
  'fifo_raw',
  'fifo_open_wait',
  'fifo_open_ready',
  'fifo_eof',
  'enqueue_line',
  'parse_discard',
  'toolcall_line',
] as const;

export type PipeTraceStage = (typeof PIPE_TRACE_STAGES)[number];

// ─── MCP Proxy ─────────────────────────────────────────────────────────────────

/** JSON-RPC 拦截错误码 — agentwatch_v0_mvp_tasklist.md MPC-06 */
export const BLOCK_ERROR_CODE = -32000;

/** 子进程崩溃自动重启上限 — task_proxy_config.md MPC-08 */
export const DEFAULT_MAX_RESTARTS = 3;

/** 客户端/服务端 IO 超时 (ms) — task_proxy_config.md DEFAULT_CONNECTION */
export const DEFAULT_IO_TIMEOUT_MS = 30_000;

/** 优雅关闭 SIGTERM 等待上限 (ms) — task_proxy_config.md MPC-08 */
export const SHUTDOWN_KILL_TIMEOUT_MS = 5_000;

// ─── Async Logger ──────────────────────────────────────────────────────────────

/** 默认 YAML 配置相对路径 — task_proxy_config.md CFG-04 */
export const DEFAULT_CONFIG_RELATIVE = '.agentwatch/config.yaml';

/** 默认日志根目录名（相对 cwd）— task_router_logger_structure.md AL-001 */
export const DEFAULT_LOG_ROOT = 'logs';

/** 异步刷盘定时器间隔 (ms) — task_router_logger_structure.md AL-002 */
export const DEFAULT_FLUSH_INTERVAL_MS = 100;

/** 内存队列最大条目数 — task_router_logger_structure.md AL-002 */
export const DEFAULT_MAX_QUEUE_SIZE = 1000;

/** 默认批量刷盘缓冲条数 — config.types LoggingConfig.bufferSize */
export const DEFAULT_BUFFER_SIZE = 100;

/** 内存持久化预算上限 (bytes) — AsyncLogger 背压保护 / task_router_logger_structure.md AL-002 */
export const MAX_PERSISTED_MEMORY_BYTES = 50 * 1024 * 1024;

/** AL-004 默认敏感字段列表 — task_router_logger_structure.md AL-004 */
export const DEFAULT_SENSITIVE_FIELDS = [
  'apiKey',
  'secret',
  'privateKey',
  'password',
  'mnemonic',
  'token',
  'consecutive_failures',
] as const;

/** logging.mask 默认配置 — config.yaml / DataMasker 共用 */
export const DEFAULT_LOG_MASK_CONFIG = {
  enabled: true,
  level: 1 as const,
  sensitiveFields: [
    'apiKey',
    'secret',
    'privateKey',
    'password',
    'mnemonic',
  ],
};

/** cloud 默认配置 — config.yaml cloud 节点 / ConfigManager 降级回退 */
export const DEFAULT_CLOUD_CONFIG = {
  enabled: true,
  endpoint: 'https://kbjcikgoawxhotwwqtin.supabase.co',
  apiKey: '',
  batch: {
    batchSize: 100,
    flushIntervalMs: 5000,
    maxRetries: 5,
  },
};

/** Markov 相关 L1 分数键 — DataMasker.maskL1Scores 脱敏匹配 */
export const MARKOV_SCORE_KEYS = [
  'markov_anomaly',
  'markov_perplexity',
  'markov_unknown_ratio',
  'markov',
] as const;

// ─── L0 Rule Engine ────────────────────────────────────────────────────────────

/** LRU 正则编译缓存容量 — task_l0_engine.md L0-IDX-04 */
export const REGEX_CACHE_MAX = 1000;

/** 延迟采样窗口大小 — RuleEngine.updateLatencyStats EWMA/P99 */
export const LATENCY_SAMPLE_MAX = 1000;

/** EWMA 平滑系数 — RuleEngine / StatEngine 延迟统计 */
export const EWMA_ALPHA = 0.2;

// ─── L1 Statistical Engine ─────────────────────────────────────────────────────

/** 频率滑动窗口桶数 — task_l1_engine.md L1-004 */
export const DEFAULT_FREQUENCY_BUCKETS = 60;

/** Markov 工具序列最大长度 — task_l1_engine.md L1-005 */
export const MAX_SEQUENCE_LENGTH = 256;

/** 会话级 Markov 追踪器 LRU 上限 — StatEngine 内存保护 / 产品架构 §5 行为基线 */
export const MAX_SESSION_TRACKERS = 512;

/** 单会话 Markov 追踪器估算内存 (bytes) — StatEngine 内存保护 */
export const ESTIMATED_BYTES_PER_SESSION = 96 * 1024;

/** L1 多维融合权重 — task_l1_engine.md L1-007 */
export const FUSION_WEIGHTS = {
  zScore: 0.35,
  frequency: 0.25,
  markov: 0.25,
  cusum: 0.075,
  ewma: 0.075,
} as const;

/** 频率窗口毫秒映射 — task_l1_engine.md L1-004 */
export const FREQUENCY_WINDOW_MS = {
  '1m': 60_000,
  '5m': 300_000,
  '1h': 3_600_000,
  '1d': 86_400_000,
} as const;

/** L1 默认维度权重 — task_l1_engine.md L1-007 */
export const DEFAULT_DIMENSION_WEIGHTS: Record<string, number> = {
  chain_depth: 0.25,
  arg_count: 0.15,
  tool_frequency: 0.2,
  latency: 0.1,
  error_rate: 0.15,
  user_repeat: 0.15,
};

/** L1 冷启动基线种子 — task_l1_engine.md L1-003 Welford 初始化 */
export const DEFAULT_BASELINE_SEED: Record<string, { mean: number; spread: number }> = {
  chain_depth: { mean: 1, spread: 0.5 },
  arg_count: { mean: 2, spread: 0.8 },
  tool_frequency: { mean: 5, spread: 2 },
  latency: { mean: 50, spread: 20 },
  error_rate: { mean: 0, spread: 0.05 },
  user_repeat: { mean: 1, spread: 0.5 },
  transfer_amount: { mean: 1_000, spread: 500 },
};

/** 工具名最大长度 — StatEngine ReDoS 防护 */
export const MAX_TOOL_NAME_LENGTH = 128;

/** 正则模式最大字符数 — StatEngine ReDoS 防护 */
export const REDOS_GUARD_MAX_PATTERN_CHARS = 64;

/** CUSUM 检测器默认 k — task_l1_engine.md L1-006 (V1 预留) */
export const DEFAULT_CUSUM_K = 0.5;

/** CUSUM 检测器默认 h — task_l1_engine.md L1-006 (V1 预留) */
export const DEFAULT_CUSUM_H = 4;

/** EWMA 检测器默认 λ — task_l1_engine.md L1-006 (V1 预留) */
export const DEFAULT_EWMA_LAMBDA = 0.2;

/** EWMA 检测器默认 L — task_l1_engine.md L1-006 (V1 预留) */
export const DEFAULT_EWMA_L = 3;

// ─── Config Manager ────────────────────────────────────────────────────────────

/** 专用环境变量键 — task_proxy_config.md CM-003 */
export const DEDICATED_ENV_KEYS = [
  'OKX_API_KEY',
  'OKX_SECRET_KEY',
  'AGENTWATCH_API_KEY',
  'AGENTWATCH_UPLOAD_SECRET',
  'OKX_PASSPHRASE',
] as const;

// ─── 结构化错误 riskType 标识 ──────────────────────────────────────────────────

/** 各模块结构化异常 riskType — .cursorrules §4 统一异常处理 */
export const RiskType = {
  // MCP Proxy
  SESSION_ALREADY_ACTIVE: 'SESSION_ALREADY_ACTIVE',
  CHILD_STDIO_MISSING: 'CHILD_STDIO_MISSING',
  START_FAILED: 'START_FAILED',
  CLIENT_STREAM_ERROR: 'CLIENT_STREAM_ERROR',
  SERVER_STREAM_ERROR: 'SERVER_STREAM_ERROR',
  SERVER_STDERR_ERROR: 'SERVER_STDERR_ERROR',
  TOOL_CALL_DETECTION_FAILED: 'TOOL_CALL_DETECTION_FAILED',
  TOOL_CALL_DETECTION_TIMEOUT: 'TOOL_CALL_DETECTION_TIMEOUT',
  CLIENT_JSON_PARSE_ERROR: 'CLIENT_JSON_PARSE_ERROR',
  SERVER_JSON_PARSE_ERROR: 'SERVER_JSON_PARSE_ERROR',
  CHILD_SPAWN_ERROR: 'CHILD_SPAWN_ERROR',
  CHILD_CRASH: 'CHILD_CRASH',
  INVALID_TOOL_CALL: 'INVALID_TOOL_CALL',
  PROCESS_TIMEOUT: 'PROCESS_TIMEOUT',

  // L0 Rule Engine
  RULE_ENGINE_MATCH_FAILED: 'RULE_ENGINE_MATCH_FAILED',
  RULE_ENGINE_MATCH_TIMEOUT: 'RULE_ENGINE_MATCH_TIMEOUT',
  RULE_ENGINE_FILE_READ_ERROR: 'RULE_ENGINE_FILE_READ_ERROR',
  RULE_ENGINE_JSON_PARSE_ERROR: 'RULE_ENGINE_JSON_PARSE_ERROR',
  RULE_ENGINE_YAML_PARSE_ERROR: 'RULE_ENGINE_YAML_PARSE_ERROR',
  RULE_ENGINE_INVALID_RULESET: 'RULE_ENGINE_INVALID_RULESET',
  RULE_ENGINE_REGEX_COMPILE_ERROR: 'RULE_ENGINE_REGEX_COMPILE_ERROR',
  RULE_ENGINE_FIELD_VALUE_ERROR: 'RULE_ENGINE_FIELD_VALUE_ERROR',

  // L1 Stat Engine
  STAT_ENGINE_BUILTIN_BASELINE_FAILED: 'STAT_ENGINE_BUILTIN_BASELINE_FAILED',
  STAT_ENGINE_PROCESS_FAILED: 'STAT_ENGINE_PROCESS_FAILED',
  STAT_ENGINE_BASELINE_UPDATE_FAILED: 'STAT_ENGINE_BASELINE_UPDATE_FAILED',
  STAT_ENGINE_PROCESS_TIMEOUT: 'STAT_ENGINE_PROCESS_TIMEOUT',

  // Decision Router
  DECISION_ROUTER_TIMEOUT: 'DECISION_ROUTER_TIMEOUT',
  DECISION_ROUTER_EVAL_FAILED: 'DECISION_ROUTER_EVAL_FAILED',

  // Async Logger
  ASYNC_LOGGER_QUEUE_OVERFLOW: 'ASYNC_LOGGER_QUEUE_OVERFLOW',
  ASYNC_LOGGER_FIELD_PARSE_FAILED: 'ASYNC_LOGGER_FIELD_PARSE_FAILED',
  ASYNC_LOGGER_INIT_FAILED: 'ASYNC_LOGGER_INIT_FAILED',
  ASYNC_LOGGER_WRITE_TIMEOUT: 'ASYNC_LOGGER_WRITE_TIMEOUT',
  ASYNC_LOGGER_WRITE_FAILED: 'ASYNC_LOGGER_WRITE_FAILED',
  ASYNC_LOGGER_HMAC_SIGN_FAILED: 'ASYNC_LOGGER_HMAC_SIGN_FAILED',

  // Cloud Upload
  CLOUD_CLIENT_UPLOAD_FAILED: 'CLOUD_CLIENT_UPLOAD_FAILED',

  // Config Manager
  CONFIG_RELOAD_FAILED: 'CONFIG_RELOAD_FAILED',
  CONFIG_YAML_PARSE_FAILED: 'CONFIG_YAML_PARSE_FAILED',
  CONFIG_VALIDATION_FAILED: 'CONFIG_VALIDATION_FAILED',
} as const;

export type RiskTypeValue = (typeof RiskType)[keyof typeof RiskType];

/** L0 ruleId → 细分场景键 — DecisionRouter 组合增强规则联动 / 产品架构 §6 十大场景 */
export const RULE_ID_SCENARIO_MAP: Record<string, string> = {
  GOAL_HIJACK_001: 'goal_hijacking',
  GOAL_HIJACK_002: 'goal_hijacking',
  PARAM_TAMPER_001: 'parameter_tampering',
  CHAIN_ABUSE_001: 'tool_chain_abuse',
  PERM_PROBE_001: 'permission_probing',
  FREQ_001: 'frequency_anomaly',
  PROMPT_INJ_001: 'prompt_injection',
  SUPPLY_CHAIN_001: 'supply_chain_poisoning',
};
