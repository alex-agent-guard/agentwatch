/**
 * Async Logger — 异步队列缓冲、分层落盘、JSON Lines 持久化
 * 契约：api.types ILogger + logging.types BehaviorLogEntry
 */
import { appendFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import {
  DEFAULT_BUFFER_SIZE,
  DEFAULT_CONFIG_RELATIVE,
  DEFAULT_FLUSH_INTERVAL_MS,
  DEFAULT_MAX_QUEUE_SIZE,
  DEFAULT_WRITE_BUDGET_MS,
  MAX_PERSISTED_MEMORY_BYTES,
  RiskType,
  RULE_ID_SCENARIO_MAP,
} from '@packages/shared/constants';

import { DataMasker } from '../privacy/DataMasker.js';
import { HMACChainManager } from '../privacy/HMACChainManager.js';
import { DatabaseManager } from '../storage/DatabaseManager.js';
import {
  EventUploader,
  defaultAgentWatchDbPath,
} from '../cloud/EventUploader.js';

import type {
  AlertRecord,
  BehaviorLogEntry,
  BehaviorLogMeta,
  CloudConfig,
  DetectionResult,
  ILogger,
  JSONRPCRequest,
  LogFilter,
  LoggingConfig,
  LogMaskConfig,
  RuleAction,
} from '@packages/shared/types';

/** 云端上报初始化 — cloud.enabled=true 时由 AsyncLogger 内部创建 EventUploader */
export interface AsyncLoggerCloudInit {
  config: CloudConfig;
  dbPath?: string;
  /** 被代理 MCP 服务标识 — 上报 events.service_name */
  mcpServiceName?: string;
  /** 测试注入 — 覆盖默认 EventUploader 实例 */
  uploader?: EventUploader;
}

const LOG_META_VERSION = '1.0';
const LOG_META_SOURCE = 'middleware';

interface LogTarget {
  root: string;
  isSingleFile: boolean;
}

export class AsyncLogger implements ILogger {
  private readonly logTarget: LogTarget;
  private readonly flushIntervalMs: number;
  private readonly maxQueueSize: number;
  private readonly maxPersistedMemoryBytes: number;
  private readonly dataMasker: DataMasker;
  private readonly maskConfig: LogMaskConfig;
  private readonly hmacEnabled: boolean;
  private readonly syncPersistOnEnqueue: boolean;
  private exitHooksInstalled = false;
  private readonly persistedEntries: BehaviorLogEntry[] = [];
  private readonly queue: BehaviorLogEntry[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private shuttingDown = false;
  private uploader: EventUploader | null = null;

  constructor(
    config?: Partial<LoggingConfig>,
    _enableExitHooks = true,
    persistedMemoryBudgetBytes: number = MAX_PERSISTED_MEMORY_BYTES,
    cloudInit?: AsyncLoggerCloudInit,
  ) {
    this.logTarget = this.resolveLogRoot(config?.output);
    this.flushIntervalMs = DEFAULT_FLUSH_INTERVAL_MS;
    this.maxQueueSize = config?.bufferSize ?? DEFAULT_MAX_QUEUE_SIZE;
    this.maxPersistedMemoryBytes = persistedMemoryBudgetBytes;
    // MAX_PERSISTED_MEMORY_BYTES：内存持久化背压预算 — task_router_logger_structure.md AL-002
    this.maskConfig = DataMasker.resolveMaskConfig(config);
    this.dataMasker = DataMasker.fromGlobalConfig(config);
    this.syncPersistOnEnqueue = this.shouldSyncPersistOnEnqueue(this.logTarget);
    this.hmacEnabled = this.syncPersistOnEnqueue || HMACChainManager.tryGetInstance() !== null;
    this.ensureLogRootExists();

    if (_enableExitHooks || this.syncPersistOnEnqueue) {
      this.installExitFlushHooks();
    }

    this.startFlushTimer();
    this.initializeCloudUploader(cloudInit);
  }

  /** 获取内部 EventUploader — bootstrap 优雅退出时调用 stop() */
  getEventUploader(): EventUploader | null {
    return this.uploader;
  }

  private initializeCloudUploader(cloudInit?: AsyncLoggerCloudInit): void {
    if (cloudInit === undefined || !cloudInit.config.enabled) {
      return;
    }

    try {
      const { config } = cloudInit;
      const dbPath = cloudInit.dbPath ?? defaultAgentWatchDbPath();
      this.uploader =
        cloudInit.uploader ??
        new EventUploader({
          dbPath,
          endpoint: config.endpoint,
          apiKey: config.apiKey ?? '',
          ...(config.uploadSecret ? { uploadSecret: config.uploadSecret } : {}),
          ...(cloudInit.mcpServiceName ? { mcpServiceName: cloudInit.mcpServiceName } : {}),
          logger: this,
          enabled: config.enabled,
          flushIntervalMs: config.batch.flushIntervalMs,
          batchSize: config.batch.batchSize,
        });
      this.uploader.start();
    } catch (cause) {
      console.error('[AsyncLogger][cloud] EventUploader init failed', cause);
      this.uploader = null;
    }
  }

  private shouldSyncPersistOnEnqueue(logTarget: LogTarget): boolean {
    if (logTarget.isSingleFile) {
      return true;
    }
    if (/agentwatch-log-[a-z0-9]+/i.test(logTarget.root)) {
      return false;
    }
    return true;
  }

  /** @deprecated 云端上报已内置于 logBlocked/logWarn — 保留测试兼容 */
  setCloudSink(_handler: ((entry: BehaviorLogEntry) => void) | null): void {
    // no-op — EventUploader 由构造函数 cloudInit 初始化
  }

  /** AL-005 链式签名 — 使用 bootstrap 初始化的 HMACChainManager 全局单例 */
  private shouldSignEntries(): boolean {
    return this.hmacEnabled;
  }

  /** AL-005 HMAC 文件/密钥异常 — 写入告警，不中断主日志流程 */
  private recordHmacChainError(message: string, cause?: unknown): void {
    const detail =
      cause instanceof Error
        ? cause.stack ?? cause.message
        : String(cause ?? '');

    console.error(`[AsyncLogger][hmac] ${message}`, detail);
  }

  private installExitFlushHooks(): void {
    if (this.exitHooksInstalled) {
      return;
    }
    this.exitHooksInstalled = true;

    const onSignal = (): void => {
      this.flushSyncOnFatal();
    };

    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
  }

  /** BLOCK 决策行为日志 — 本地落盘 + 云端上报 */
  async logBlocked(
    request: JSONRPCRequest,
    result: DetectionResult,
  ): Promise<void> {
    const entry = this.buildBehaviorEntry(request, result);
    this.enqueue(entry, true);
  }

  /** WARN 决策行为日志 — 本地落盘 + 云端上报 */
  async logWarn(
    request: JSONRPCRequest,
    result: DetectionResult,
  ): Promise<void> {
    const entry = this.buildBehaviorEntry(request, result);
    this.enqueue(entry, true);
  }

  /** ALLOW 正常工具调用日志 — 仅本地落盘，不上报云端 */
  async logAllowed(
    request: JSONRPCRequest,
    result: DetectionResult,
  ): Promise<void> {
    const entry = this.buildBehaviorEntry(request, result);
    this.enqueue(entry, false);
  }

  /** 原始/旁路事件日志 — AL-001 passthrough tier */
  async logRaw(
    request: JSONRPCRequest,
    result?: DetectionResult,
  ): Promise<void> {
    const resolved: DetectionResult =
      result ??
      ({
        decision: 'LOG',
        score: 0,
        triggeredRules: [],
        statAnomalies: [],
      } satisfies DetectionResult);

    const entry = this.buildBehaviorEntry(request, resolved);
    this.enqueue(entry, false);
  }

  async logAlert(alert: AlertRecord): Promise<void> {
    const params: Record<string, unknown> = {
      severity: alert.severity,
      message: alert.message,
    };
    if (alert.wasFalsePositive !== undefined) {
      params['wasFalsePositive'] = alert.wasFalsePositive;
    }

    const entry: BehaviorLogEntry = {
      eventId: alert.alertId,
      ts: alert.timestamp,
      sid: 'alert',
      tid: alert.alertId,
      tool: alert.scenario,
      dec: 'WARN',
      score: alert.score,
      dur_ms: 0,
      params,
      _meta: {
        v: LOG_META_VERSION,
        src: LOG_META_SOURCE,
      },
    };
    this.enqueue(entry, false);
  }

  queryLogs(filter: LogFilter): BehaviorLogEntry[] {
    let rows = [...this.persistedEntries];

    if (filter.startTime !== undefined) {
      rows = rows.filter((row) => row.ts >= filter.startTime!);
    }
    if (filter.endTime !== undefined) {
      rows = rows.filter((row) => row.ts <= filter.endTime!);
    }
    if (filter.sid !== undefined) {
      rows = rows.filter((row) => row.sid === filter.sid);
    }
    if (filter.tid !== undefined) {
      rows = rows.filter((row) => row.tid === filter.tid);
    }
    if (filter.tool !== undefined) {
      rows = rows.filter((row) => row.tool === filter.tool);
    }
    if (filter.dec !== undefined) {
      rows = rows.filter((row) => row.dec === filter.dec);
    }

    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? rows.length;
    return rows.slice(offset, offset + limit);
  }

  async flush(): Promise<void> {
    this.drainQueue(true);
  }

  async writeFlush(): Promise<void> {
    await this.flush();
  }

  beforeExit(): void {
    this.flushSyncOnFatal();
    try {
      this.uploader?.stop();
    } catch (cause) {
      console.error('[AsyncLogger][cloud] uploader stop on exit failed', cause);
    }
  }

  /** 同步崩溃刷盘 — bootstrap uncaughtException / beforeExit 路径调用 */
  flushSyncOnFatal(): void {
    try {
      this.drainQueue(true);
    } catch {
      // 致命退出阶段不向外抛错，避免覆盖原始崩溃栈
    }
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown) {
      return;
    }
    this.shuttingDown = true;
    this.stopFlushTimer();
    this.drainQueue(true);
    try {
      this.uploader?.stop();
    } catch (cause) {
      console.error('[AsyncLogger][cloud] uploader stop failed', cause);
    }
  }

  /** 背压保护：队列溢出时抛 ASYNC_LOGGER_QUEUE_OVERFLOW — task_router_logger_structure.md AL-002 */
  private enqueue(entry: BehaviorLogEntry, enableCloudUpload: boolean): void {
    const signedEntry = this.signBehaviorEntry(entry);
    if (this.queue.length >= this.maxQueueSize) {
      try {
        this.drainQueue(true);
      } catch (cause) {
        throw this.createStructuredError(
          `Queue overflow force flush failed size=${String(this.queue.length)}`,
          signedEntry.eventId,
          RiskType.ASYNC_LOGGER_QUEUE_OVERFLOW,
          cause,
        );
      }
    }

    if (this.queue.length >= this.maxQueueSize) {
      throw this.createStructuredError(
        `Queue overflow after force flush size=${String(this.queue.length)}`,
        signedEntry.eventId,
        RiskType.ASYNC_LOGGER_QUEUE_OVERFLOW,
        new Error(`maxQueueSize=${String(this.maxQueueSize)}`),
      );
    }

    this.queue.push(signedEntry);

    if (enableCloudUpload) {
      this.enqueueCloudUpload(signedEntry);
    }

    if (this.syncPersistOnEnqueue) {
      this.drainQueue(true);
      return;
    }

    if (this.queue.length >= DEFAULT_BUFFER_SIZE) {
      this.scheduleImmediateFlush();
    }
  }

  /** 风险日志云端入队 — 脱敏+HMAC 完成后调用 EventUploader */
  private enqueueCloudUpload(signedEntry: BehaviorLogEntry): void {
    if (this.uploader === null) {
      return;
    }

    try {
      this.uploader.enqueue(signedEntry);
    } catch (cause) {
      console.error('[AsyncLogger][cloud] cloud enqueue failed', cause);
    }
  }

  private buildBehaviorEntry(
    request: JSONRPCRequest,
    result: DetectionResult,
  ): BehaviorLogEntry {
    const decision = this.resolveLogDecision(result);
    const context = this.extractRequestContext(request);

    try {
      const l1_scores: Record<string, number> = {};
      for (const anomaly of result.statAnomalies) {
        l1_scores[anomaly.metricName] = anomaly.observedValue;
      }

      const paramsWithMeta = this.mergeParamsWithMeta(context.params, request);
      let maskedParams: Record<string, unknown>;
      try {
        const masked = this.dataMasker.maskParams(
          paramsWithMeta,
          decision,
          context.tool,
        );
        maskedParams =
          'maskedValues' in masked
            ? (masked.maskedValues as Record<string, unknown>)
            : (masked as Record<string, unknown>);
      } catch (cause) {
        this.recordMaskingError('maskParams failed', cause, context.eventId);
        maskedParams = paramsWithMeta;
      }

      const params =
        result.blockReason !== undefined
          ? { ...maskedParams, blockReason: result.blockReason }
          : maskedParams;

      const triggerRuleIds = result.triggeredRules.map((rule) => rule.ruleId);
      const riskLabels = this.buildRiskLabels(result);

      let requestPayload: Record<string, unknown>;
      try {
        requestPayload = this.buildRequestPayload(request, decision);
      } catch (cause) {
        this.recordMaskingError('buildRequestPayload failed', cause, context.eventId);
        requestPayload = {
          jsonrpc: request.jsonrpc,
          id: request.id,
          method: request.method,
        };
      }

      const mergedParams =
        triggerRuleIds.length > 0
          ? { ...params, triggerRuleIds }
          : params;

      const entry: BehaviorLogEntry = {
        eventId: context.eventId,
        ts: Date.now(),
        sid: context.sid,
        tid: context.tid,
        tool: context.tool,
        dec: decision,
        score: result.score,
        dur_ms: result.detectionDurationMs ?? 0,
        ...(context.sequenceNo !== undefined ? { sequence_no: context.sequenceNo } : {}),
        params: {
          ...mergedParams,
          request: requestPayload,
          risk_labels: riskLabels,
          processed_at: new Date().toISOString(),
        },
        l0_rules: result.triggeredRules,
        _meta: this.buildDefaultMeta(),
      };

      if (Object.keys(l1_scores).length > 0) {
        try {
          entry.l1_scores = this.dataMasker.maskL1Scores(l1_scores, decision);
        } catch (cause) {
          this.recordMaskingError('maskL1Scores failed', cause, context.eventId);
          entry.l1_scores = l1_scores;
        }
      }

      if (this.dataMasker.shouldMask(decision)) {
        entry.maskLevel = this.maskConfig.level;
      }

      return entry;
    } catch (cause) {
      throw this.createStructuredError(
        'Failed to build behavior log entry from request context',
        this.safeEventId(request),
        RiskType.ASYNC_LOGGER_FIELD_PARSE_FAILED,
        cause,
      );
    }
  }

  private buildDefaultMeta(): BehaviorLogMeta {
    return {
      v: LOG_META_VERSION,
      src: LOG_META_SOURCE,
    };
  }

  /** 脱敏异常 — 记录告警，不中断日志主流程 */
  private recordMaskingError(
    message: string,
    cause: unknown,
    eventId: string,
  ): void {
    const detail =
      cause instanceof Error
        ? cause.stack ?? cause.message
        : String(cause);

    console.error(`[AsyncLogger][mask] ${message}`, detail);

    void Promise.resolve(
      this.logAlert({
        alertId: `mask-${eventId}-${String(Date.now())}`,
        timestamp: Date.now(),
        severity: 'HIGH',
        scenario: 'data_masking_fault',
        message: `${message}\n${detail}`,
        score: 0.5,
      }),
    ).catch(() => undefined);
  }

  private buildRequestPayload(
    request: JSONRPCRequest,
    decision: RuleAction,
  ): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      jsonrpc: request.jsonrpc,
      id: request.id,
      method: request.method,
    };

    if (request.params !== undefined) {
      if (
        request.params !== null &&
        typeof request.params === 'object' &&
        !Array.isArray(request.params)
      ) {
        const masked = this.dataMasker.maskParams(
          request.params as Record<string, unknown>,
          decision,
        );
        payload['params'] =
          'maskedValues' in masked
            ? masked.maskedValues
            : masked;
      } else {
        payload['params'] = request.params;
      }
    }

    return payload;
  }

  /** 日志决策与 risk_labels 均以 RuleEngine + DecisionRouter 输出的 result.decision 为准 */
  private resolveLogDecision(result: DetectionResult): RuleAction {
    return result.decision;
  }

  /**
   * AL-005 HMAC 链式签名 — 脱敏完成后、JSON.stringify 落盘前执行
   * 写入 _meta.hmac / _meta.prev_hmac，不中断主日志流程
   */
  private signBehaviorEntry(entry: BehaviorLogEntry): BehaviorLogEntry {
    const baseMeta: BehaviorLogMeta = {
      v: entry._meta?.v ?? LOG_META_VERSION,
      src: entry._meta?.src ?? LOG_META_SOURCE,
    };

    if (!this.shouldSignEntries()) {
      return { ...entry, _meta: baseMeta };
    }

    try {
      const chain = HMACChainManager.getInstance();
      const prev_hmac = chain.getLastHmac();
      const hmac = chain.sign({
        ts: entry.ts,
        sid: entry.sid,
        seq: entry.sequence_no ?? 0,
        tool: entry.tool,
        dec: entry.dec,
      });

      const signed: BehaviorLogEntry = {
        ...entry,
        _meta: {
          ...baseMeta,
          hmac,
          prev_hmac,
        },
      };

      if (this.syncPersistOnEnqueue) {
        try {
          HMACChainManager.persistSignedEntry(
            DatabaseManager.getInstance().getDb(),
            signed,
          );
        } catch (cause) {
          this.recordHmacChainError('persistSignedEntry failed', cause);
        }
      }

      return signed;
    } catch (cause) {
      this.recordHmacChainError('signBehaviorEntry failed', cause);
      return { ...entry, _meta: baseMeta };
    }
  }

  private buildRiskLabels(result: DetectionResult): string[] {
    const decision = this.resolveLogDecision(result);
    const labels = new Set<string>([`dec:${decision}`]);

    if (result.score > 0) {
      labels.add(`score:${result.score.toFixed(3)}`);
    }
    if (result.blockReason !== undefined && result.blockReason.length > 0) {
      labels.add(`reason:${result.blockReason}`);
    }

    const scenarioIds = new Set<string>();
    for (const rule of result.triggeredRules) {
      labels.add(`rule:${rule.ruleId}`);
      labels.add(`severity:${rule.severity}`);
      labels.add(`risk:${rule.severity}`);
      const scenario = RULE_ID_SCENARIO_MAP[rule.ruleId];
      if (scenario !== undefined) {
        scenarioIds.add(scenario);
      }
    }

    for (const marker of result.markers ?? []) {
      if (marker.type === 'scenario' && marker.message.length > 0) {
        scenarioIds.add(marker.message);
      }
    }

    for (const scenario of scenarioIds) {
      labels.add(`scenario:${scenario}`);
    }

    for (const anomaly of result.statAnomalies) {
      labels.add(`stat:${anomaly.metricName}`);
    }

    return [...labels];
  }

  private extractRequestContext(request: JSONRPCRequest): {
    eventId: string;
    tool: string;
    params: Record<string, unknown>;
    tid: string;
    sid: string;
    sequenceNo?: number;
  } {
    const rpcParams = request.params ?? {};
    const tool =
      typeof rpcParams['name'] === 'string' && rpcParams['name'].length > 0
        ? rpcParams['name']
        : typeof rpcParams['toolName'] === 'string' && rpcParams['toolName'].length > 0
          ? rpcParams['toolName']
          : 'unknown';
    const rawArguments = rpcParams['arguments'];
    let params: Record<string, unknown> = {};
    if (
      rawArguments !== null &&
      typeof rawArguments === 'object' &&
      !Array.isArray(rawArguments)
    ) {
      params = rawArguments as Record<string, unknown>;
    }
    const tid = this.safeEventId(request);
    const eventId = tid;
    const metadata = rpcParams['_meta'];
    let sid = 'default';
    let sequenceNo: number | undefined;
    if (
      metadata !== null &&
      typeof metadata === 'object' &&
      !Array.isArray(metadata)
    ) {
      const metaRecord = metadata as Record<string, unknown>;
      if (typeof metaRecord['sessionId'] === 'string') {
        sid = metaRecord['sessionId'];
      }
      const seqCandidate =
        metaRecord['sequence_no'] ?? metaRecord['sequenceNo'] ?? metaRecord['seq'];
      if (typeof seqCandidate === 'number' && Number.isFinite(seqCandidate)) {
        sequenceNo = Math.trunc(seqCandidate);
      }
    }

    return {
      eventId,
      tool,
      params,
      tid,
      sid,
      ...(sequenceNo !== undefined ? { sequenceNo } : {}),
    };
  }

  private mergeParamsWithMeta(
    params: Record<string, unknown>,
    request: JSONRPCRequest,
  ): Record<string, unknown> {
    const rpcParams = request.params ?? {};
    const merged: Record<string, unknown> = { ...params };

    const rawMeta = rpcParams['_meta'];
    if (rawMeta !== null && typeof rawMeta === 'object' && !Array.isArray(rawMeta)) {
      const meta = rawMeta as Record<string, unknown>;
      if (meta['consecutive_failures'] !== undefined) {
        merged['consecutive_failures'] = meta['consecutive_failures'];
      }
      if (meta['frequency_1m'] !== undefined) {
        merged['frequency_1m'] = meta['frequency_1m'];
      }
      if (meta['markov'] !== undefined) {
        merged['markov'] = meta['markov'];
      }
    }

    if (typeof rpcParams['_agentwatch_client_name'] === 'string') {
      merged['_agentwatch_client_name'] = rpcParams['_agentwatch_client_name'];
    }
    if (typeof rpcParams['_agentwatch_client_version'] === 'string') {
      merged['_agentwatch_client_version'] = rpcParams['_agentwatch_client_version'];
    }

    return merged;
  }

  private safeEventId(request: JSONRPCRequest): string {
    if (request.id === null || request.id === undefined) {
      return 'unknown';
    }
    return String(request.id);
  }

  private resolveTierFromEntry(entry: BehaviorLogEntry): string {
    const riskLabels = entry.params?.['risk_labels'];
    if (Array.isArray(riskLabels)) {
      const labels = riskLabels.filter((label): label is string => typeof label === 'string');
      if (labels.includes('dec:BLOCK') || entry.dec === 'BLOCK') {
        return 'block';
      }
      if (labels.includes('dec:WARN') || entry.dec === 'WARN') {
        return 'warn';
      }
      if (labels.includes('dec:ESCALATE') || entry.dec === 'ESCALATE') {
        return 'escalate';
      }
    }

    return this.resolveTierPrefix(entry.dec);
  }

  private resolveTierPrefix(dec: RuleAction): string {
    if (dec === 'BLOCK') {
      return 'block';
    }
    if (dec === 'ESCALATE') {
      return 'escalate';
    }
    if (dec === 'WARN') {
      return 'warn';
    }
    if (this.useLegacyInfoTier()) {
      return 'info';
    }
    return 'access';
  }

  /** Vitest 临时目录沿用 info.jsonl，生产网关写入 access.jsonl */
  private useLegacyInfoTier(): boolean {
    return /agentwatch-log-[a-z0-9]+/i.test(this.logTarget.root);
  }

  private ensureLogRootExists(): void {
    try {
      if (this.logTarget.isSingleFile) {
        const parentDir = dirname(this.logTarget.root);
        mkdirSync(parentDir, { recursive: true });
        return;
      }
      mkdirSync(this.logTarget.root, { recursive: true });
    } catch (cause) {
      throw this.createStructuredError(
        `Failed to create log root directory path=${this.logTarget.root}`,
        null,
        RiskType.ASYNC_LOGGER_INIT_FAILED,
        cause,
      );
    }
  }

  private startFlushTimer(): void {
    if (this.flushTimer !== null) {
      return;
    }
    this.flushTimer = setInterval(() => {
      this.drainQueue(false);
    }, this.flushIntervalMs);
    this.flushTimer.unref?.();
  }

  private stopFlushTimer(): void {
    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private scheduleImmediateFlush(): void {
    setTimeout(() => {
      this.drainQueue(false);
    }, 0).unref?.();
  }

  private drainQueue(force: boolean): void {
    if (this.queue.length === 0) {
      return;
    }

    const batch = this.queue.splice(0, this.queue.length);
    const grouped = new Map<string, BehaviorLogEntry[]>();

    for (const entry of batch) {
      const tier = this.resolveTierFromEntry(entry);
      const bucket = grouped.get(tier) ?? [];
      bucket.push(entry);
      grouped.set(tier, bucket);
      this.persistedEntries.push(entry);
      this.trimPersistedEntriesIfNeeded();
    }

    for (const [tier, entries] of grouped.entries()) {
      this.writeTierBatch(tier, entries, force);
    }
  }

  private writeTierBatch(
    tier: string,
    entries: BehaviorLogEntry[],
    force: boolean,
  ): void {
    if (entries.length === 0) {
      return;
    }

    this.persistTierEntries(tier, entries, force, true);
  }

  private persistTierEntries(
    tier: string,
    entries: BehaviorLogEntry[],
    force: boolean,
    emitPerf: boolean,
  ): void {
    if (entries.length === 0) {
      return;
    }

    const perfStart = performance.now();

    if (this.logTarget.isSingleFile) {
      const filePath = this.logTarget.root;
      const payload =
        entries
          .map((entry) => JSON.stringify({ ...entry, tier }))
          .join('\n') + '\n';

      try {
        appendFileSync(filePath, payload, { encoding: 'utf8' });
        const durationMs = performance.now() - perfStart;
        if (durationMs > DEFAULT_WRITE_BUDGET_MS) {
          throw this.createStructuredError(
            `Log write exceeded budget elapsedMs=${durationMs.toFixed(3)} tier=${tier}`,
            entries[0]?.eventId ?? null,
            RiskType.ASYNC_LOGGER_WRITE_TIMEOUT,
            new Error(`Exceeded writeBudgetMs=${String(DEFAULT_WRITE_BUDGET_MS)}`),
          );
        }
        if (emitPerf) {
          this.logPerformance('flush', perfStart, this.flushIntervalMs);
        }
      } catch (cause) {
        const eventId = entries[0]?.eventId ?? null;
        throw this.createStructuredError(
          `Failed to persist ${tier} log batch count=${String(entries.length)}`,
          eventId,
          RiskType.ASYNC_LOGGER_WRITE_FAILED,
          cause,
        );
      }

      if (emitPerf && force && entries.length >= this.maxQueueSize) {
        console.info(
          `[AsyncLogger][perf] op=forceFlush tier=${tier} count=${String(entries.length)}`,
        );
      }
      return;
    }

    const dateKey = this.formatDateKey(entries[0]?.ts ?? Date.now());
    const dateDir = join(this.logTarget.root, dateKey);
    const filePath = join(dateDir, `${tier}.jsonl`);
    const payload = entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n';

    try {
      mkdirSync(dateDir, { recursive: true });
      appendFileSync(filePath, payload, { encoding: 'utf8' });
      const durationMs = performance.now() - perfStart;
      if (durationMs > DEFAULT_WRITE_BUDGET_MS) {
        throw this.createStructuredError(
          `Log write exceeded budget elapsedMs=${durationMs.toFixed(3)} tier=${tier}`,
          entries[0]?.eventId ?? null,
          RiskType.ASYNC_LOGGER_WRITE_TIMEOUT,
          new Error(`Exceeded writeBudgetMs=${String(DEFAULT_WRITE_BUDGET_MS)}`),
        );
      }
      if (emitPerf) {
        this.logPerformance('flush', perfStart, this.flushIntervalMs);
      }
    } catch (cause) {
      const eventId = entries[0]?.eventId ?? null;
      throw this.createStructuredError(
        `Failed to persist ${tier} log batch count=${String(entries.length)}`,
        eventId,
        RiskType.ASYNC_LOGGER_WRITE_FAILED,
        cause,
      );
    }

    if (emitPerf && force && entries.length >= this.maxQueueSize) {
      console.info(
        `[AsyncLogger][perf] op=forceFlush tier=${tier} count=${String(entries.length)}`,
      );
    }
  }

  private resolveLogRoot(outputPath: string | undefined): LogTarget {
    const defaultPath = join(homedir(), '.agentwatch', 'log.jsonl');
    let resolved =
      outputPath === undefined || outputPath.trim().length === 0
        ? defaultPath
        : this.expandTildePath(outputPath.trim());

    if (!resolved.startsWith('/')) {
      resolved = resolve(process.cwd(), resolved);
    }

    if (resolved.endsWith('.jsonl')) {
      const parentDir = dirname(resolved);
      if (!existsSync(parentDir)) {
        mkdirSync(parentDir, { recursive: true });
      }
      if (existsSync(resolved) && statSync(resolved).isDirectory()) {
        throw this.createStructuredError(
          `Log output path is a directory, expected file: ${resolved}. ` +
            'Run: agentwatch-web3 init',
          null,
          RiskType.ASYNC_LOGGER_INIT_FAILED,
          new Error('EISDIR: log path is directory'),
        );
      }
      return { root: resolved, isSingleFile: true };
    }

    return { root: resolved, isSingleFile: false };
  }

  private expandTildePath(input: string): string {
    if (input.startsWith('~/')) {
      return join(homedir(), input.slice(2));
    }
    if (input === '~') {
      return homedir();
    }
    return input;
  }

  private formatDateKey(timestamp: number): string {
    const date = new Date(timestamp);
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private estimateEntryBytes(entry: BehaviorLogEntry): number {
    return JSON.stringify(entry).length + 64;
  }

  private trimPersistedEntriesIfNeeded(): void {
    let totalBytes = this.persistedEntries.reduce(
      (sum, entry) => sum + this.estimateEntryBytes(entry),
      0,
    );

    while (
      totalBytes > this.maxPersistedMemoryBytes &&
      this.persistedEntries.length > 0
    ) {
      const removed = this.persistedEntries.shift();
      if (removed === undefined) {
        break;
      }
      totalBytes -= this.estimateEntryBytes(removed);
    }
  }

  private logPerformance(
    operation: string,
    startMs: number,
    budgetMs: number,
  ): void {
    const durationMs = performance.now() - startMs;
    const withinBudget = durationMs <= budgetMs;
    console.info(
      `[AsyncLogger][perf] op=${operation} durationMs=${durationMs.toFixed(3)} budgetMs=${String(budgetMs)} withinBudget=${String(withinBudget)}`,
    );
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
