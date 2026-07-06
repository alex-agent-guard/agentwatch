/**
 * AgentWatch V0 — MCP 检测网关顶层启动入口
 * 组装：ConfigManager → DatabaseManager → RuleEngine → StatEngine → DecisionRouter → AsyncLogger → MCPProxyCore
 */
import { execSync } from 'node:child_process';
import { open } from 'node:fs/promises';
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readSync,
  statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import readline from 'node:readline';
import { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import type { ReadableOptions } from 'node:stream';

import { ConfigManager } from '../config/config-manager.js';
import { DecisionRouter } from '../detection/DecisionRouter.js';
import { A2ARiskDetector } from '../detection/scenarios/A2ARiskDetector.js';
import { BaselineDeviationDetector } from '../detection/scenarios/BaselineDeviationDetector.js';
import { BaselineStorage } from '../baseline/BaselineStorage.js';
import { BaselineService } from '../baseline/BaselineService.js';
import { EventUploader } from '../cloud/EventUploader.js';
import { resolveMcpServiceName } from '../cloud/mcpServiceName.js';
import { AsyncLogger } from '../logging/AsyncLogger.js';
import { MCPProxyCore } from '../proxy/MCPProxyCore.js';
import { V0_BUILTIN_RULES } from '../rule/builtin.js';
import { RuleEngine } from '../rule/RuleEngine.js';
import { DatabaseManager } from '../storage/DatabaseManager.js';
import { HMACChainManager } from '../privacy/HMACChainManager.js';
import { StatEngine } from '../stat/StatEngine.js';

import {
  DEFAULT_AGENTWATCH_HOME_SUBDIR,
  DEFAULT_FIFO_FILENAME,
  FIFO_HEARTBEAT_MS,
  FIFO_READ_BUFFER_BYTES,
  FIFO_REOPEN_MS,
  MAX_PERSISTED_MEMORY_BYTES,
  type PipeTraceStage,
} from '@packages/shared/constants';

import type {
  IConfigManager,
  ProxySession,
  RuleSet,
} from '@packages/shared/types';

const BUILTIN_RULE_SET: RuleSet = {
  id: 'v0-builtin',
  name: 'V0 Built-in Rules',
  description: 'AgentWatch V0 MVP built-in L0 rule set',
  rules: V0_BUILTIN_RULES,
  priority: 0,
  defaultAction: 'ALLOW',
};

interface GatewayRuntime {
  proxy: MCPProxyCore;
  session: ProxySession;
  logger: AsyncLogger;
  baselineService: BaselineService;
  eventUploader: EventUploader | null;
}

let gateway: GatewayRuntime | null = null;
let shuttingDown = false;
const loggerRef: { current: AsyncLogger | null } = { current: null };
let databaseManager: DatabaseManager | null = null;
let baselineServiceRef: BaselineService | null = null;
let eventUploaderRef: EventUploader | null = null;
let globalHandlersInstalled = false;

const DEFAULT_EXTERNAL_PIPE = join(
  homedir(),
  DEFAULT_AGENTWATCH_HOME_SUBDIR,
  DEFAULT_FIFO_FILENAME,
);

let fifoPumpTask: Promise<void> | null = null;
let fifoHeartbeatTimer: ReturnType<typeof setInterval> | null = null;

function logPipeTrace(stage: PipeTraceStage, preview: string): void {
  const compact = preview.replace(/\s+/g, ' ').trim();
  console.info(
    `[AgentWatch][proxy][pipe] stage=${stage} len=${String(compact.length)} preview=${compact.slice(0, 96)}`,
  );
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** 独立可读流：stdin / FIFO 分路 enqueue，避免 PassThrough 背压互斥 — 产品架构 §5.1 双流管道 */
class GatewayClientInput extends Readable {
  private pendingChunks: string[] = [];
  private canPush = true;

  constructor(options?: ReadableOptions) {
    super({ encoding: 'utf8', ...options });
  }

  override resume(): this {
    return super.resume();
  }

  enqueueLine(rawLine: string, source: 'stdin' | 'fifo'): void {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0) {
      return;
    }

    logPipeTrace('enqueue_line', `[${source}] ${trimmed}`);

    const normalized = normalizeGatewayJsonLine(trimmed);
    if (normalized.length === 0) {
      logPipeTrace('parse_discard', trimmed);
      return;
    }

    logPipeTrace('toolcall_line', normalized);
    this.pushLine(`${normalized}\n`);
    setImmediate(() => {
      this.read(0);
    });
  }

  /** 背压缓冲：push 返回 false 时暂存 chunk，drain 后 flush — Node Readable 背压协议 */
  private pushLine(lineWithNewline: string): void {
    if (!this.canPush) {
      this.pendingChunks.push(lineWithNewline);
      return;
    }

    const accepted = this.push(lineWithNewline);
    if (!accepted) {
      this.canPush = false;
      this.once('drain', () => {
        this.canPush = true;
        this.flushPendingChunks();
      });
    }
  }

  private flushPendingChunks(): void {
    while (this.pendingChunks.length > 0 && this.canPush) {
      const next = this.pendingChunks.shift();
      if (next === undefined) {
        break;
      }
      this.pushLine(next);
    }
  }

  override _read(_size: number): void {
    this.flushPendingChunks();
  }
}

function stopExternalPipeReaders(): void {
  if (fifoHeartbeatTimer !== null) {
    clearInterval(fifoHeartbeatTimer);
    fifoHeartbeatTimer = null;
  }
  fifoPumpTask = null;
}

function resolveExternalPipePath(): string {
  const configured = process.env.AGENTWATCH_PIPE_INPUT?.trim();
  return configured !== undefined && configured.length > 0
    ? configured
    : DEFAULT_EXTERNAL_PIPE;
}

function ensureExternalPipe(pipePath: string): void {
  const parentDir = dirname(pipePath);
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }
  if (!existsSync(pipePath)) {
    execSync(`mkfifo "${pipePath}"`, { stdio: 'ignore' });
  }

  try {
    chmodSync(pipePath, fsConstants.S_IRUSR | fsConstants.S_IWUSR | fsConstants.S_IRGRP | fsConstants.S_IWGRP | fsConstants.S_IROTH | fsConstants.S_IWOTH);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    console.warn(`[AgentWatch][proxy][pipe] stage=fifo_chmod_failed reason=${message}`);
  }

  try {
    const stat = statSync(pipePath);
    console.info(
      `[AgentWatch][proxy][pipe] stage=fifo_stat mode=${stat.mode.toString(8)} uid=${String(stat.uid)} gid=${String(stat.gid)} path=${pipePath}`,
    );
  } catch {
    // ignore stat errors
  }

  flushExternalPipeCache(pipePath);
}

/** 启动时清空 FIFO 残留字节，避免旧报文阻塞新读端 */
function flushExternalPipeCache(pipePath: string): void {
  if (!existsSync(pipePath)) {
    return;
  }

  let fd: number | null = null;
  try {
    fd = openSync(pipePath, fsConstants.O_RDWR | fsConstants.O_NONBLOCK);
    const buffer = Buffer.alloc(FIFO_READ_BUFFER_BYTES);
    while (readSync(fd, buffer, 0, buffer.length, null) > 0) {
      // discard stale bytes
    }
  } catch {
    // empty fifo or no reader/writer yet — safe to ignore
  } finally {
    if (fd !== null) {
      closeSync(fd);
    }
  }
}

async function pumpExternalPipe(pipePath: string, input: GatewayClientInput): Promise<void> {
  while (!shuttingDown) {
    let handle: Awaited<ReturnType<typeof open>> | null = null;
    try {
      logPipeTrace('fifo_open_wait', pipePath);
      handle = await open(pipePath, fsConstants.O_RDONLY);
      logPipeTrace('fifo_open_ready', pipePath);

      const buffer = Buffer.alloc(FIFO_READ_BUFFER_BYTES);
      let pending = '';

      while (!shuttingDown) {
        const result = await handle.read(buffer, 0, buffer.length);
        if (result.bytesRead === 0) {
          logPipeTrace('fifo_eof', pipePath);
          break;
        }

        const chunk = buffer.toString('utf8', 0, result.bytesRead);
        logPipeTrace('fifo_raw', chunk);
        pending += chunk;

        let newlineIndex = pending.indexOf('\n');
        while (newlineIndex >= 0) {
          const line = pending.slice(0, newlineIndex);
          pending = pending.slice(newlineIndex + 1);
          input.enqueueLine(line, 'fifo');
          newlineIndex = pending.indexOf('\n');
        }
      }

      if (pending.trim().length > 0) {
        input.enqueueLine(pending, 'fifo');
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      console.warn(`[AgentWatch][proxy][pipe] stage=fifo_error reason=${message}`);
      await sleepMs(100);
    } finally {
      if (handle !== null) {
        await handle.close().catch(() => undefined);
      }
    }

    if (!shuttingDown) {
      // FIFO_REOPEN_MS：EOF 后短暂重开，避免 writer 阻塞 — 产品架构 §5.1
      await sleepMs(FIFO_REOPEN_MS);
    }
  }
}

function launchExternalPipePump(pipePath: string, input: GatewayClientInput): void {
  if (shuttingDown || fifoPumpTask !== null) {
    return;
  }

  fifoPumpTask = pumpExternalPipe(pipePath, input).finally(() => {
    fifoPumpTask = null;
  });
}

function attachExternalPipeReader(pipePath: string, input: GatewayClientInput): void {
  launchExternalPipePump(pipePath, input);

  if (fifoHeartbeatTimer !== null) {
    clearInterval(fifoHeartbeatTimer);
  }

  // FIFO_HEARTBEAT_MS：泵异常退出后定时重挂读端 — 产品架构 §5.1
  fifoHeartbeatTimer = setInterval(() => {
    launchExternalPipePump(pipePath, input);
  }, FIFO_HEARTBEAT_MS);
  fifoHeartbeatTimer.unref?.();
}

function deliverGatewayLine(input: GatewayClientInput, line: string, source: 'stdin' | 'fifo'): void {
  setImmediate(() => {
    input.enqueueLine(line, source);
  });
}

/** 修复常见手写 JSON 笔误，避免落入 clientLinePassthrough — 产品架构 §5.2 JSON 修复层 */
function repairGatewayJsonSyntax(line: string): string {
  let text = line.trim();
  if (text.length === 0) {
    return text;
  }

  text = text.replace(
    /"name"\s*:\s*"([^"]+)"\s*:\s*"([^"]*)"/g,
    '"name":"$1","value":"$2"',
  );
  text = text.replace(
    /"name"\s*:\s*"([^"]+)"\s*:\s*(true|false|-?\d+(?:\.\d+)?)/g,
    '"name":"$1","value":$2',
  );

  while (text.endsWith('}') && text.length > 1) {
    try {
      JSON.parse(text);
      break;
    } catch {
      text = text.slice(0, -1).trimEnd();
    }
  }

  return text;
}

/** 网关输入适配：补齐 jsonrpc/id，兼容 toolName → name */
function normalizeGatewayJsonLine(line: string): string {
  const trimmed = repairGatewayJsonSyntax(line);
  if (trimmed.length === 0) {
    return '';
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return trimmed;
    }

    const method = parsed['method'];
    if (typeof method !== 'string' || method.length === 0) {
      return trimmed;
    }

    const normalized: Record<string, unknown> = { ...parsed };
    if (normalized['jsonrpc'] === undefined) {
      normalized['jsonrpc'] = '2.0';
    }
    if (normalized['id'] === undefined || normalized['id'] === null) {
      normalized['id'] = `gw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }

    const rawParams = normalized['params'];
    if (rawParams !== null && typeof rawParams === 'object' && !Array.isArray(rawParams)) {
      normalized['params'] = normalizeToolCallParams(rawParams as Record<string, unknown>);
    }

    return JSON.stringify(normalized);
  } catch {
    return trimmed;
  }
}

function flattenGatewayArguments(rawArgs: unknown): Record<string, unknown> {
  const flattened: Record<string, unknown> = {};
  if (!Array.isArray(rawArgs)) {
    return flattened;
  }

  for (const entry of rawArgs) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const name = record['name'];
    if (typeof name === 'string' && name.length > 0 && 'value' in record) {
      flattened[name] = record['value'];
    }
  }
  return flattened;
}

function inferDetectionToolName(toolName: string, rawArgs: unknown): string {
  const flattened = flattenGatewayArguments(rawArgs);
  if (toolName === 'file_operate') {
    const op = flattened['opt'] ?? flattened['action'];
    if (op === 'rm' || op === 'delete') {
      return 'delete_file';
    }
  }
  return toolName;
}

function coerceTransferArguments(rawArgs: unknown): unknown {
  if (!Array.isArray(rawArgs)) {
    return rawArgs;
  }

  return rawArgs.map((entry) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      return entry;
    }
    const record = { ...(entry as Record<string, unknown>) };
    if (record['name'] === 'amount' && typeof record['value'] === 'string') {
      const parsed = Number(record['value']);
      if (Number.isFinite(parsed)) {
        record['value'] = parsed;
      }
    }
    return record;
  });
}

function normalizeToolCallParams(params: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...params };

  if (typeof normalized['toolName'] === 'string' && normalized['name'] === undefined) {
    normalized['name'] = normalized['toolName'];
  }

  const resolvedName =
    typeof normalized['name'] === 'string'
      ? normalized['name']
      : typeof normalized['toolName'] === 'string'
        ? normalized['toolName']
        : undefined;

  if (resolvedName !== undefined) {
    normalized['name'] = inferDetectionToolName(resolvedName, normalized['arguments']);
  }

  if (normalized['name'] === 'transfer') {
    normalized['arguments'] = coerceTransferArguments(normalized['arguments']);
  }

  if (normalized['chain_depth'] !== undefined || normalized['chainDepth'] !== undefined) {
    const chainDepth = normalized['chain_depth'] ?? normalized['chainDepth'];
    const rawMeta = normalized['_meta'];
    const meta =
      rawMeta !== null && typeof rawMeta === 'object' && !Array.isArray(rawMeta)
        ? { ...(rawMeta as Record<string, unknown>) }
        : {};
    if (meta['chain_depth'] === undefined && meta['chainDepth'] === undefined) {
      meta['chain_depth'] = chainDepth;
      normalized['_meta'] = meta;
    }
  }

  return normalized;
}

function isPipedStdin(): boolean {
  if (process.stdin.isTTY || !process.stdin.readable) {
    return false;
  }

  try {
    const stat = fstatSync(0);
    return !stat.isCharacterDevice();
  } catch {
    return false;
  }
}

function attachStdinReader(input: GatewayClientInput): void {
  if (process.stdin.isTTY) {
    process.stdin.setEncoding('utf8');
    process.stdin.resume();

    const silentOut = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });

    const rl = readline.createInterface({
      input: process.stdin,
      output: silentOut,
      terminal: true,
    });

    rl.on('line', (line) => {
      deliverGatewayLine(input, line, 'stdin');
    });

    rl.on('close', () => {
      // stdin 关闭后仍可通过外部管道继续写入
    });

    console.info('[AgentWatch][proxy] stdin_ready mode=interactive');
    return;
  }

  if (!process.stdin.readable) {
    return;
  }

  if (!isPipedStdin()) {
    return;
  }

  process.stdin.setEncoding('utf8');
  process.stdin.resume();

  let stdinPending = '';
  process.stdin.on('data', (chunk: string | Buffer) => {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    stdinPending += text;
    let newlineIndex = stdinPending.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = stdinPending.slice(0, newlineIndex);
      stdinPending = stdinPending.slice(newlineIndex + 1);
      deliverGatewayLine(input, line, 'stdin');
      newlineIndex = stdinPending.indexOf('\n');
    }
  });
  process.stdin.on('end', () => {
    if (stdinPending.trim().length > 0) {
      deliverGatewayLine(input, stdinPending, 'stdin');
      stdinPending = '';
    }
  });
  process.stdin.on('error', () => undefined);
  console.info('[AgentWatch][proxy] stdin_ready mode=piped');
}

/** 合并进程 stdin 与外部命名管道，供 MCPProxyCore 按行读取 JSON-RPC */
function createGatewayClientInput(): GatewayClientInput {
  const merged = new GatewayClientInput();
  merged.resume();

  attachStdinReader(merged);

  const pipePath = resolveExternalPipePath();
  try {
    ensureExternalPipe(pipePath);
    attachExternalPipeReader(pipePath, merged);
    console.info(`[AgentWatch][proxy] external_pipe_ready path=${pipePath}`);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    console.warn(
      `[AgentWatch][proxy] external_pipe_unavailable path=${pipePath} reason=${message}`,
    );
  }

  return merged;
}

/** 注册进程退出信号 — 同步关闭 SQLite，避免 WAL/文件锁残留 */
let databaseShutdownHandlersInstalled = false;
export function registerDatabaseShutdownHandlers(db: DatabaseManager): void {
  if (databaseShutdownHandlersInstalled) {
    return;
  }
  databaseShutdownHandlersInstalled = true;

  const onSignal = (): void => {
    db.close();
    databaseManager = null;
    void gracefulShutdown(0);
  };

  // Ctrl+C 终止信号
  process.on('SIGINT', onSignal);
  // 系统停止进程信号
  process.on('SIGTERM', onSignal);
}

function closeDatabaseSync(): void {
  if (databaseManager === null) {
    return;
  }

  try {
    databaseManager.close();
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    console.warn(`[AgentWatch][proxy] database_close_warning: ${message}`);
  } finally {
    databaseManager = null;
    HMACChainManager.reset();
  }
}

async function assembleGateway(): Promise<GatewayRuntime> {
  const perfStart = performance.now();

  const configManager: IConfigManager = new ConfigManager();
  const proxyConfig = configManager.getProxyConfig();
  const thresholds = configManager.getDetectionThresholds();

  // Week 2-3 持久化基础设施 — 配置加载完成后、业务模块初始化前获取 SQLite 单例
  const db = DatabaseManager.getInstance();
  databaseManager = db;
  registerDatabaseShutdownHandlers(db);

  HMACChainManager.initializeFromDatabase(db.getDb(), (message, cause) => {
    const detail = cause instanceof Error ? cause.message : String(cause ?? '');
    console.error(`[AgentWatch][proxy][hmac] ${message}${detail.length > 0 ? `: ${detail}` : ''}`);
  });

  const ruleEngine = new RuleEngine({
    maxMatchTimeMs: thresholds.ruleEngine.maxMatchTimeMs,
  });
  const loadedRuleCount = loadRuleEngineRules(ruleEngine, thresholds.ruleEngine.rulesPath);

  const statEngine = new StatEngine(proxyConfig);
  const baselineService = new BaselineService({
    userId: proxyConfig.agentWatch.userId ?? 'default',
    agentId: proxyConfig.agentWatch.agentId ?? 'default',
    monthlyDecay: proxyConfig.agentWatch.scenarios?.baselineDeviation?.monthlyDecay ?? false,
  });
  baselineServiceRef = baselineService;

  const persistedBaseline = baselineService.hydrateFromStorage();
  if (persistedBaseline !== null) {
    statEngine.updateBaseline(persistedBaseline);
  } else {
    statEngine.loadBuiltinBaseline();
  }
  statEngine.setBaselineService(baselineService);

  const decisionRouter = new DecisionRouter({
    ...(thresholds.decisionRouter.enabled !== undefined
      ? { enabled: thresholds.decisionRouter.enabled }
      : {}),
    blockThreshold: thresholds.decisionRouter.blockThreshold,
    warnThreshold: thresholds.decisionRouter.warnThreshold,
    ruleWeight: thresholds.decisionRouter.ruleWeight,
    statWeight: thresholds.decisionRouter.statWeight,
    decisionBudgetMs: thresholds.ruleEngine.maxMatchTimeMs,
  });

  const cloudConfig = configManager.getCloudConfig();
  const mcpServiceName = resolveMcpServiceName(proxyConfig.server);
  const logger = new AsyncLogger(
    proxyConfig.agentWatch.logging,
    false,
    MAX_PERSISTED_MEMORY_BYTES,
    { config: cloudConfig, mcpServiceName },
  );
  BaselineStorage.setLogger(logger);
  loggerRef.current = logger;

  const eventUploader = cloudConfig.enabled ? logger.getEventUploader() : null;
  if (eventUploader !== null) {
    eventUploaderRef = eventUploader;
  }

  const clientIn = createGatewayClientInput();

  const a2aEnabled = proxyConfig.agentWatch.detection.a2aRisk ?? false;
  const a2aDetector = a2aEnabled
    ? new A2ARiskDetector({
        enabled: true,
        localAgentId: proxyConfig.agentWatch.agentId ?? 'default',
        ...(proxyConfig.agentWatch.detection.registeredAgentIds !== undefined
          ? { registeredAgentIds: proxyConfig.agentWatch.detection.registeredAgentIds }
          : {}),
      })
    : null;

  const baselineDeviationEnabled =
    proxyConfig.agentWatch.detection.baselineDeviation ?? true;
  const baselineDeviationDetector = baselineDeviationEnabled
    ? new BaselineDeviationDetector({
        enabled: true,
        baselineService,
      })
    : null;

  const proxy = new MCPProxyCore(
    proxyConfig,
    ruleEngine,
    statEngine,
    logger,
    decisionRouter,
    clientIn,
    process.stdout,
    a2aDetector,
    baselineDeviationDetector,
  );

  const session = await proxy.start();

  const durationMs = performance.now() - perfStart;
  console.info(
    `[AgentWatch][proxy] gateway_ready durationMs=${durationMs.toFixed(3)} rules=${String(loadedRuleCount)}`,
  );

  return { proxy, session, logger, baselineService, eventUploader };
}

function loadRuleEngineRules(ruleEngine: RuleEngine, rulesPath: string): number {
  if (rulesPath.length > 0 && existsSync(rulesPath)) {
    try {
      ruleEngine.loadRuleSetFromFile(rulesPath);
      return ruleEngine.getStats().enabledRules;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      console.warn(
        `[AgentWatch][proxy] rulesPath load failed path=${rulesPath} fallback=builtin reason=${message}`,
      );
    }
  }

  ruleEngine.loadRuleSet(BUILTIN_RULE_SET);
  return ruleEngine.getStats().enabledRules;
}

async function logBootstrapAlert(
  logger: AsyncLogger | null,
  scenario: string,
  message: string,
  severity: string = 'CRITICAL',
): Promise<void> {
  if (logger === null) {
    console.error(`[AgentWatch][proxy] ${scenario}: ${message}`);
    return;
  }

  await logger.logAlert({
    alertId: `bootstrap-${Date.now()}`,
    timestamp: Date.now(),
    severity,
    scenario,
    message,
    score: 1,
  });
  await logger.flush();
}

async function gracefulShutdown(exitCode = 0): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  stopExternalPipeReaders();

  const runtime = gateway;
  gateway = null;

  try {
    if (runtime !== null) {
      await runtime.proxy.gracefulShutdown(runtime.session);
      runtime.baselineService.persist();
      runtime.eventUploader?.stop();
      await runtime.logger.shutdown();
    }
  } catch (cause) {
    const message =
      cause instanceof Error ? cause.message : JSON.stringify(cause);
    console.error(`[AgentWatch][proxy] shutdown_error: ${message}`);
  } finally {
    eventUploaderRef?.stop();
    eventUploaderRef = null;
    baselineServiceRef?.persist();
    baselineServiceRef = null;
    closeDatabaseSync();
    process.exit(exitCode);
  }
}

async function handleFatalProcessError(
  label: string,
  reason: unknown,
  logger: AsyncLogger | null,
): Promise<void> {
  syncFatalLogFlush(logger);
  const message = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : undefined;
  const detail = stack === undefined ? message : `${message}\n${stack}`;

  await logBootstrapAlert(logger, label, detail);
  await gracefulShutdown(1);
}

function syncFatalLogFlush(logger: AsyncLogger | null): void {
  if (logger === null) {
    return;
  }
  logger.beforeExit();
}

function installGlobalHandlers(): void {
  if (globalHandlersInstalled) {
    return;
  }
  globalHandlersInstalled = true;

  process.on('beforeExit', () => {
    syncFatalLogFlush(loggerRef.current);
  });

  process.on('unhandledRejection', (reason: unknown) => {
    void (async () => {
      syncFatalLogFlush(loggerRef.current);
      await handleFatalProcessError(
        'bootstrap.unhandledRejection',
        reason,
        loggerRef.current,
      );
    })();
  });

  process.on('uncaughtException', (error: Error) => {
    console.error(
      `[AgentWatch][proxy] uncaughtException: ${error.message}`,
    );
    syncFatalLogFlush(loggerRef.current);
    void handleFatalProcessError(
      'bootstrap.uncaughtException',
      error,
      loggerRef.current,
    );
  });
}

export { loadRuleEngineRules };

/** CLI proxy 子命令选项 */
export interface ProxyCommandOptions {
  config?: string;
}

/** CLI `agentwatch proxy` — 启动 MCP 检测网关 */
export async function proxyCommand(
  args: string[] = [],
  options: ProxyCommandOptions = {},
): Promise<void> {
  if (options.config !== undefined && options.config.length > 0) {
    process.env['AGENTWATCH_CONFIG_PATH'] = options.config;
  }
  if (args.length > 0) {
    process.env['AGENTWATCH_OVERRIDE_SERVER'] = JSON.stringify({
      command: args[0],
      args: args.slice(1),
    });
  }
  await bootstrap();
}

export async function bootstrap(): Promise<GatewayRuntime> {
  installGlobalHandlers();

  try {
    const runtime = await assembleGateway();
    gateway = runtime;
    loggerRef.current = runtime.logger;
    return runtime;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    const stack = cause instanceof Error ? cause.stack : undefined;
    const detail = stack === undefined ? message : `${message}\n${stack}`;

    await logBootstrapAlert(loggerRef.current, 'bootstrap.startup_failed', detail);
    await gracefulShutdown(1);
    throw cause;
  }
}

async function main(): Promise<void> {
  await bootstrap();
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : '';
const modulePath = fileURLToPath(import.meta.url);
if (entryPath === modulePath) {
  main().catch(async (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[AgentWatch][proxy] fatal: ${message}`);
    await gracefulShutdown(1);
  });
}
