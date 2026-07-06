/**
 * MCP Proxy Core — stdio JSON-RPC 代理、子进程生命周期、检测调度
 * 契约：task_proxy_config.md MPC-03~12 / agentwatch_v0_mvp_tasklist.md §1
 */
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import byline from 'byline';

import {
  BLOCK_ERROR_CODE,
  DEFAULT_IO_TIMEOUT_MS,
  DEFAULT_MAX_RESTARTS,
  RiskType,
  SHUTDOWN_KILL_TIMEOUT_MS,
} from '@packages/shared/constants';

import type { A2ARiskAssessment, A2ARiskDetector } from '../detection/scenarios/A2ARiskDetector.js';
import type { BaselineDeviationDetector } from '../detection/scenarios/BaselineDeviationDetector.js';

import type { DetectionEvent } from '@packages/shared/types';
import type { ProxyConfig } from '@packages/shared/types';
import type {
  ILogger,
  IRuleEngine,
  IStatisticalEngine,
} from '@packages/shared/types';
import type { IDecisionRouter, ScenarioScore } from '@packages/shared/types';
import type { L1BehaviorDimensions, L1DetectionResult } from '@packages/shared/types';
import type { RuleAction, RuleMatchResult } from '@packages/shared/types';
import type {
  DetectionResult,
  JSONRPCRequest,
  JSONRPCResponse,
  ProxySession,
  SecurityMarker,
  StatAnomaly,
  TriggeredRule,
} from '@packages/shared/types';

export class MCPProxyCore {
  private session: ProxySession | null = null;
  private restartCount = 0;
  private shuttingDown = false;
  private relayStarted = false;
  private sequenceNo = 0;
  /** 待匹配 server 响应的 tools/call — 用于耗时与失败计数 */
  private readonly pendingToolCalls = new Map<
    string,
    { sessionId: string; toolName: string; startedAt: number }
  >();
  /** `${sessionId}:${toolName}` → 连续授权失败次数 */
  private readonly consecutiveFailures = new Map<string, number>();
  /** sessionId → 上一笔 tools/call 工具名 — 供云端链路上下文 */
  private readonly lastToolBySession = new Map<string, string>();
  /** sessionId → 上一笔 tools/call 服务端耗时 (ms) */
  private readonly lastToolDurationMs = new Map<string, number>();
  /** 当前会话 MCP 客户端 — initialize.clientInfo */
  private sessionMcpClient: { name: string; version?: string } | null = null;

  constructor(
    private readonly config: ProxyConfig,
    private readonly ruleEngine: IRuleEngine,
    private readonly statEngine: IStatisticalEngine,
    private readonly asyncLogger: ILogger,
    private readonly decisionRouter: IDecisionRouter,
    private readonly clientIn: Readable = process.stdin,
    private readonly clientOut: Writable = process.stdout,
    private readonly a2aDetector: A2ARiskDetector | null = null,
    private readonly baselineDeviationDetector: BaselineDeviationDetector | null = null,
  ) {}

  /** MPC-03：spawn 子进程并组装 ProxySession — agentwatch_v0_mvp_tasklist.md MPC-03 */
  async start(): Promise<ProxySession> {
    const perfStart = performance.now();
    if (this.session !== null) {
      throw this.createStructuredError(
        'Proxy session already active',
        null,
        RiskType.SESSION_ALREADY_ACTIVE,
        new Error('start() called while session exists'),
      );
    }

    try {
      const sessionId = this.generateULID();
      this.sessionMcpClient = null;
      const childProcess = this.spawnServerProcess();
      this.attachChildExitHandler(childProcess);

      if (
        childProcess.stdout === null ||
        childProcess.stdin === null ||
        childProcess.stderr === null
      ) {
        throw this.createStructuredError(
          'Child process missing stdio pipes',
          null,
          RiskType.CHILD_STDIO_MISSING,
          new Error('spawn did not provide stdin/stdout/stderr'),
        );
      }

      const session: ProxySession = {
        sessionId,
        sequenceNo: 0,
        childProcess,
        clientIn: this.clientIn,
        serverOut: childProcess.stdout,
        clientOut: this.clientOut,
        serverIn: childProcess.stdin,
        ruleEngine: this.ruleEngine,
        statEngine: this.statEngine,
        asyncLogger: this.asyncLogger,
        decisionRouter: this.decisionRouter,
        start: async (): Promise<void> => {
          await this.startRelay(session);
        },
        stop: async (): Promise<void> => {
          await this.gracefulShutdown(session);
        },
        handleToolCall: async (request: JSONRPCRequest): Promise<DetectionResult> => {
          return this.handleToolCall(request, session);
        },
      };

      this.session = session;
      await session.start();

      this.logPerformance('start', perfStart, this.config.performance.maxDetectionLatencyMs);
      return session;
    } catch (cause) {
      await this.cleanupAfterStartFailure();
      throw this.createStructuredError(
        'Failed to start MCP proxy session',
        null,
        RiskType.START_FAILED,
        cause,
      );
    }
  }

  /** MPC-04：双向 byline 管道中继 — Client↔Server JSON-RPC 行级转发 */
  async startRelay(session: ProxySession): Promise<void> {
    if (this.relayStarted) {
      return;
    }
    this.relayStarted = true;
    const perfStart = performance.now();

    const clientLineStream = byline.createStream(session.clientIn);
    clientLineStream.on('data', (line: string | Buffer) => {
      void this.handleClientLine(session, line.toString()).catch((cause: unknown) => {
        this.handleStreamFault(session, 'handleClientLine', cause);
      });
    });
    clientLineStream.on('error', (cause: Error) => {
      this.handleStreamFault(session, 'clientLineStream', cause);
    });

    const serverLineStream = byline.createStream(session.serverOut);
    serverLineStream.on('data', (line: string | Buffer) => {
      void this.handleServerStdoutLine(session, line.toString()).catch((cause: unknown) => {
        this.handleStreamFault(session, 'handleServerStdoutLine', cause);
      });
    });
    serverLineStream.on('error', (cause: Error) => {
      this.handleStreamFault(session, 'serverLineStream', cause);
    });

    const serverErrStream = byline.createStream(session.childProcess.stderr!);
    serverErrStream.on('data', (line: string | Buffer) => {
      this.handleServerStderrLine(line.toString());
    });
    serverErrStream.on('error', (cause: Error) => {
      this.handleStreamFault(session, 'serverErrStream', cause);
    });

    this.attachRelayStreamErrorHandlers(session);

    this.logPerformance('startRelay', perfStart, this.config.performance.maxDetectionLatencyMs);
  }

  /** MPC-05：tools/call 拦截 — L0.match + L1.processEvent + DecisionRouter.detect 并行调度 */
  async handleToolCall(
    request: JSONRPCRequest,
    session: ProxySession,
  ): Promise<DetectionResult> {
    const perfStart = performance.now();
    const eventId = request.id;

    try {
      session.sequenceNo = this.nextSequenceNo();
      const detectionEvent = this.convertRequestToDetectionEvent(request, session);

      const l1Result = session.statEngine.processEvent(detectionEvent);
      const enrichedEvent = this.enrichDetectionEventFromL1(detectionEvent, l1Result);
      const ruleMatches = session.ruleEngine.match(enrichedEvent);

      let a2aAssessment: A2ARiskAssessment | null = null;
      try {
        a2aAssessment = this.a2aDetector?.assess(detectionEvent) ?? null;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        console.error(`[MCPProxyCore] A2A assess failed: ${message}`);
      }

      const behaviorDimensions = this.buildBehaviorDimensionsFromL1(l1Result);
      let baselineScenarioScore: ScenarioScore | null = null;
      try {
        baselineScenarioScore =
          this.baselineDeviationDetector?.assess(detectionEvent, behaviorDimensions) ?? null;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        console.error(`[MCPProxyCore] baseline deviation assess failed: ${message}`);
      }

      const fusion = session.decisionRouter.detect(
        ruleMatches,
        l1Result,
        eventId === null || eventId === undefined ? null : String(eventId),
        baselineScenarioScore !== null ? [baselineScenarioScore] : [],
      );
      let decision = this.mapFusionDecisionToRuleAction(fusion.finalDecision);
      let score = fusion.enhancedScore;
      let blockReason =
        decision === 'BLOCK'
          ? fusion.finalDecision === 'BLOCK'
            ? 'Fusion score exceeded block threshold'
            : 'Rule engine blocked request'
          : undefined;

      const markers = [
        ...this.buildSecurityMarkers(session.sessionId, session.sequenceNo, decision),
        ...this.buildScenarioRiskMarkers(fusion.activeScenarios),
      ];

      if (a2aAssessment !== null) {
        markers.push(...a2aAssessment.markers);
        if (a2aAssessment.decision === 'BLOCK') {
          decision = 'BLOCK';
          score = Math.max(score, 0.95);
          blockReason = a2aAssessment.message;
        } else if (a2aAssessment.decision === 'WARN' && decision === 'ALLOW') {
          decision = 'WARN';
          score = Math.max(score, 0.6);
        }
      }

      const detectionDurationMs = Math.max(0, Math.round(performance.now() - perfStart));

      const result: DetectionResult = {
        decision,
        score,
        triggeredRules: this.mapRuleMatchesToTriggeredRules(ruleMatches),
        statAnomalies: this.mapL1ToStatAnomalies(l1Result),
        ...(decision === 'BLOCK' && blockReason !== undefined ? { blockReason } : {}),
        detectionDurationMs,
        markers,
      };

      this.logPerformance(
        'handleToolCall',
        perfStart,
        this.config.performance.maxDetectionLatencyMs,
      );
      this.assertDetectionBudget(perfStart, eventId);
      return result;
    } catch (cause) {
      if (
        cause instanceof Error &&
        (cause as Error & { riskType?: string }).riskType === RiskType.TOOL_CALL_DETECTION_TIMEOUT
      ) {
        throw cause;
      }
      throw this.createStructuredError(
        'handleToolCall failed',
        eventId,
        RiskType.TOOL_CALL_DETECTION_FAILED,
        cause,
      );
    }
  }

  /** MPC-06：构造 JSON-RPC error 拦截响应 — error.code = BLOCK_ERROR_CODE (-32000) */
  buildBlockResponse(
    request: JSONRPCRequest,
    result: DetectionResult,
  ): JSONRPCResponse {
    return {
      jsonrpc: '2.0',
      id: request.id,
      error: {
        code: BLOCK_ERROR_CODE,
        message: 'AgentWatch: Request blocked by security policy',
        data: {
          reason: result.blockReason ?? 'Security policy violation',
          triggeredRules: result.triggeredRules,
          score: result.score,
          timestamp: Date.now(),
          helpUrl: 'https://agentwatch.dev/docs/blocked',
        },
      },
    };
  }

  injectSecurityMarkers(
    response: JSONRPCResponse,
    markers: SecurityMarker[],
  ): JSONRPCResponse {
    // TODO(P2): V1关联ToolCallEvent完整字段，补全审计维度信息
    if (
      !this.config.agentWatch.proxy?.injectSecurityMarkers ||
      markers.length === 0 ||
      response.error !== undefined
    ) {
      return response;
    }

    if (response.result === undefined || typeof response.result !== 'object') {
      return response;
    }

    const resultRecord = response.result as Record<string, unknown>;
    const content = resultRecord['content'];
    if (!Array.isArray(content)) {
      return response;
    }

    const markerText = markers
      .map((marker) => `[AgentWatch:${marker.code}] ${marker.message}`)
      .join('\n');

    return {
      jsonrpc: '2.0',
      id: response.id,
      result: {
        ...resultRecord,
        content: [...content, { type: 'text', text: markerText }],
      },
    };
  }

  /** MPC-08：SIGTERM → 超时 SIGKILL 优雅关闭子进程与管道 */
  async gracefulShutdown(session: ProxySession): Promise<void> {
    if (this.shuttingDown) {
      return;
    }
    this.shuttingDown = true;
    const perfStart = performance.now();

    try {
      this.destroyStreamSafely(session.clientIn);
      this.destroyStreamSafely(session.serverOut);
      this.destroyStreamSafely(session.serverIn);
      this.destroyStreamSafely(session.clientOut);

      if (!session.childProcess.killed) {
        session.childProcess.kill('SIGTERM');
        await this.waitForChildExit(session.childProcess, SHUTDOWN_KILL_TIMEOUT_MS);
      }
    } catch {
      // MPC-08: 优雅关闭不得向外抛异常
    } finally {
      this.session = null;
      this.relayStarted = false;
      this.restartCount = 0;
      this.shuttingDown = false;
      this.logPerformance('gracefulShutdown', perfStart, this.config.performance.maxDetectionLatencyMs);
    }
  }

  private async handleClientLine(session: ProxySession, line: string): Promise<void> {
    const perfStart = performance.now();
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      return;
    }

    try {
      const parsed: unknown = JSON.parse(trimmed);

      if (!this.isJsonRpcRequest(parsed)) {
        this.writeLineSafe(session, session.serverIn, trimmed, 'clientLinePassthrough');
        this.logPerformance('clientLinePassthrough', perfStart, this.config.performance.maxDetectionLatencyMs);
        return;
      }

      const request = parsed;

      if (request.method === 'initialize') {
        this.captureInitializeClient(request);
        this.writeLineSafe(session, session.serverIn, trimmed, 'clientInitializeForward');
        this.logPerformance('clientInitializeForward', perfStart, this.config.performance.maxDetectionLatencyMs);
        return;
      }

      if (request.method === 'tools/call') {
        await this.processToolCallRequest(session, request, trimmed);
      } else {
        // MPC-09 / MPC-10: tools/list、resources/*、prompts/*、notifications/* 直接转发
        this.writeLineSafe(session, session.serverIn, trimmed, 'clientLineForward');
      }

      this.logPerformance('clientLine', perfStart, this.config.performance.maxDetectionLatencyMs);
    } catch {
      // 非 JSON 行透传至 MCP Server，避免 proxy 进程崩溃（Template 1 边界容错）
      this.writeLineSafe(session, session.serverIn, trimmed, 'clientLinePassthroughNonJson');
      console.warn(
        `[MCPProxyCore][pipe] stage=client_non_json_passthrough len=${String(trimmed.length)}`,
      );
      this.logPerformance(
        'clientLinePassthroughNonJson',
        perfStart,
        this.config.performance.maxDetectionLatencyMs,
      );
      return;
    }
  }

  private async processToolCallRequest(
    session: ProxySession,
    request: JSONRPCRequest,
    rawLine: string,
  ): Promise<void> {
    try {
      const toolName = this.resolveToolNameFromRequest(request);
      const previousTool = this.lastToolBySession.get(session.sessionId);
      const result = await session.handleToolCall(request);

      if (result.decision === 'BLOCK') {
        const blockResponse = this.buildBlockResponse(request, result);
        this.writeJsonRpc(session, session.clientOut, blockResponse);
        await session.asyncLogger.logBlocked(
          this.attachAgentWatchMeta(request, session, previousTool),
          result,
        );
        if (toolName !== undefined) {
          this.lastToolBySession.set(session.sessionId, toolName);
        }
        return;
      }

      const logRequest = this.attachAgentWatchMeta(request, session, previousTool);
      if (result.decision === 'WARN') {
        await session.asyncLogger.logWarn(logRequest, result);
      } else {
        await session.asyncLogger.logAllowed(logRequest, result);
      }

      if (toolName !== undefined) {
        this.lastToolBySession.set(session.sessionId, toolName);
      }

      this.trackPendingToolCall(request, session);
      this.writeLineSafe(session, session.serverIn, rawLine, 'processToolCallForward');
    } catch (cause) {
      this.handleStreamFault(session, 'processToolCallRequest', cause, request.id);
    }
  }

  private resolveToolNameFromRequest(request: JSONRPCRequest): string | undefined {
    const params = request.params;
    if (params === null || typeof params !== 'object' || Array.isArray(params)) {
      return undefined;
    }
    const name = (params as Record<string, unknown>)['name'];
    return typeof name === 'string' && name.trim().length > 0 ? name.trim() : undefined;
  }

  private async handleServerStdoutLine(session: ProxySession, line: string): Promise<void> {
    const perfStart = performance.now();
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      return;
    }

    try {
      const parsed: unknown = JSON.parse(trimmed);

      if (this.isJsonRpcResponse(parsed)) {
        this.recordToolCallOutcome(session, parsed);
        const markers =
          this.session !== null
            ? this.buildSecurityMarkers(
                this.session.sessionId,
                this.session.sequenceNo,
                'ALLOW',
              )
            : [];
        const enhanced = this.injectSecurityMarkers(parsed, markers);
        this.writeJsonRpc(session, session.clientOut, enhanced);
      } else {
        this.writeLineSafe(session, session.clientOut, trimmed, 'serverStdoutPassthrough');
      }

      this.logPerformance('serverStdoutLine', perfStart, this.config.performance.maxDetectionLatencyMs);
    } catch (cause) {
      // 非 JSON 行透传至 Client，避免 async handler 未捕获异常导致主进程崩溃
      this.writeLineSafe(session, session.clientOut, trimmed, 'serverStdoutPassthroughNonJson');
      console.warn(
        `[MCPProxyCore][pipe] stage=server_non_json_passthrough len=${String(trimmed.length)}`,
      );
      this.logPerformance(
        'serverStdoutPassthroughNonJson',
        perfStart,
        this.config.performance.maxDetectionLatencyMs,
      );
    }
  }

  private handleServerStderrLine(line: string): void {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      return;
    }

    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'level' in parsed &&
        'message' in parsed
      ) {
        // V0: stderr 结构化日志仅记录；V1 路由至 AsyncLogger
        console.error('[MCPProxyCore][server-log]', JSON.stringify(parsed));
        return;
      }
    } catch {
      console.error('[MCPProxyCore][server-stderr]', trimmed);
    }
  }

  private spawnServerProcess(): ChildProcess {
    const { command, args, cwd, env } = this.config.server;
    const child = spawn(command, args ?? [], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    child.on('error', (cause: Error) => {
      const active = this.session;
      if (active !== null) {
        this.handleStreamFault(active, 'child_spawn_error', cause);
        return;
      }
      console.error('[MCPProxyCore][stream] child spawn error before session ready', cause);
    });

    return child;
  }

  private attachChildExitHandler(childProcess: ChildProcess): void {
    childProcess.on('exit', (code, signal) => {
      if (this.shuttingDown) {
        return;
      }

      const active = this.session;
      const autoRestart = this.config.connection?.autoRestart ?? true;
      const maxRestarts = this.config.connection?.maxRestarts ?? DEFAULT_MAX_RESTARTS;

      if (code !== 0 && code !== null && autoRestart && this.restartCount < maxRestarts) {
        this.restartCount += 1;
        if (active !== null) {
          this.handleStreamFault(
            active,
            'child_crash_restart',
            new Error(
              `Child process exited with code ${String(code)} signal=${String(signal)} restarts=${String(this.restartCount)}`,
            ),
          );
        }
        void this.restartSessionAfterCrash();
        return;
      }

      if (code !== 0 && code !== null && active !== null) {
        this.handleStreamFault(
          active,
          'child_crash',
          new Error(`Child process exited with code ${String(code)} signal=${String(signal)}`),
        );
      }
    });
  }

  private async restartSessionAfterCrash(): Promise<void> {
    const previous = this.session;
    if (previous === null) {
      return;
    }

    try {
      await this.gracefulShutdown(previous);
    } catch {
      // 重启路径中忽略清理异常
    }

    this.shuttingDown = false;
    this.relayStarted = false;
    await this.start();
  }

  private async cleanupAfterStartFailure(): Promise<void> {
    const active = this.session;
    if (active !== null) {
      await this.gracefulShutdown(active);
    }
  }

  private convertRequestToDetectionEvent(
    request: JSONRPCRequest,
    session: ProxySession,
  ): DetectionEvent {
    const params = request.params ?? {};
    const toolName = params['name'];
    const rawArgs = params['arguments'];
    const rpcMeta = this.extractRpcMeta(params);

    if (typeof toolName !== 'string' || toolName.length === 0) {
      throw this.createStructuredError(
        'tools/call missing params.name',
        request.id,
        RiskType.INVALID_TOOL_CALL,
        new Error('params.name must be a non-empty string'),
      );
    }

    const flattenedArgs = this.flattenToolArguments(rawArgs);
    const argumentEntries = this.buildArgumentEntries(flattenedArgs);
    const primaryArgument = this.selectPrimaryArgument(toolName, flattenedArgs);
    const chainDepth = this.resolveChainDepth(rpcMeta, flattenedArgs, session.sequenceNo);
    const metadata = this.buildEventMetadata(
      session,
      toolName,
      rpcMeta,
      flattenedArgs,
    );
    const toolSource = this.resolveToolSource(params, rpcMeta, flattenedArgs);

    const detectionEvent: DetectionEvent = {
      tool: {
        name: toolName,
        ...(toolSource !== undefined ? { source: toolSource } : {}),
      },
      argument: primaryArgument,
      request: {
        timestamp: Date.now(),
        session_id: session.sessionId,
        ...(this.config.agentWatch.userId !== undefined
          ? { user_id: this.config.agentWatch.userId }
          : {}),
        ...(typeof rpcMeta.origin === 'string' ? { origin: rpcMeta.origin } : {}),
      },
      context: {
        chain_depth: chainDepth,
        ...(this.config.agentWatch.agentId !== undefined
          ? { agent_id: this.config.agentWatch.agentId }
          : {}),
        ...(typeof rpcMeta.skill_id === 'string'
          ? { skill_id: rpcMeta.skill_id }
          : {}),
      },
    };

    if (argumentEntries.length > 0) {
      detectionEvent.arguments = argumentEntries;
    }
    if (metadata !== undefined) {
      detectionEvent.metadata = metadata;
    }

    return detectionEvent;
  }

  private captureInitializeClient(request: JSONRPCRequest): void {
    const params = request.params;
    if (params === null || typeof params !== 'object' || Array.isArray(params)) {
      return;
    }

    const clientInfo = params['clientInfo'];
    if (clientInfo === null || typeof clientInfo !== 'object' || Array.isArray(clientInfo)) {
      return;
    }

    const info = clientInfo as Record<string, unknown>;
    const name = info['name'];
    if (typeof name !== 'string' || name.trim().length === 0) {
      return;
    }

    this.sessionMcpClient = {
      name: name.trim(),
      ...(typeof info['version'] === 'string' && info['version'].trim().length > 0
        ? { version: info['version'].trim() }
        : {}),
    };
  }

  /** 为日志/上报附加 MCP 客户端与链路上下文 — 不修改转发给 Server 的原始语义 */
  private attachAgentWatchMeta(
    request: JSONRPCRequest,
    session?: ProxySession,
    previousTool?: string,
  ): JSONRPCRequest {
    const params =
      request.params !== null && typeof request.params === 'object' && !Array.isArray(request.params)
        ? { ...(request.params as Record<string, unknown>) }
        : {};

    if (this.sessionMcpClient !== null) {
      params['_agentwatch_client_name'] = this.sessionMcpClient.name;
      if (this.sessionMcpClient.version) {
        params['_agentwatch_client_version'] = this.sessionMcpClient.version;
      }
    }

    if (session !== undefined) {
      params['_agentwatch_chain_depth'] = session.sequenceNo;
      if (previousTool !== undefined && previousTool.length > 0) {
        params['_agentwatch_previous_tool'] = previousTool;
      }
    }

    if (Object.keys(params).length === 0) {
      return request;
    }

    return {
      ...request,
      params,
    };
  }

  private extractRpcMeta(params: Record<string, unknown>): Record<string, unknown> {
    const rawMeta = params['_meta'];
    if (rawMeta !== null && typeof rawMeta === 'object' && !Array.isArray(rawMeta)) {
      return rawMeta as Record<string, unknown>;
    }
    return {};
  }

  private flattenToolArguments(rawArgs: unknown): Record<string, unknown> {
    const flattened: Record<string, unknown> = {};

    if (Array.isArray(rawArgs)) {
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

    if (typeof rawArgs === 'object' && rawArgs !== null && !Array.isArray(rawArgs)) {
      return { ...(rawArgs as Record<string, unknown>) };
    }

    if (typeof rawArgs === 'string' || typeof rawArgs === 'number' || typeof rawArgs === 'boolean') {
      flattened.value = rawArgs;
    }

    return flattened;
  }

  private buildArgumentEntries(
    flattenedArgs: Record<string, unknown>,
  ): NonNullable<DetectionEvent['arguments']> {
    return Object.entries(flattenedArgs).map(([name, value]) => ({
      name,
      value,
      ...(value !== null && value !== undefined
        ? { type: typeof value }
        : {}),
    }));
  }

  private selectPrimaryArgument(
    toolName: string,
    flattenedArgs: Record<string, unknown>,
  ): DetectionEvent['argument'] {
    const matchKeys = ['amount', 'value', 'sum', 'prompt', 'input', 'text', 'content', 'query'];
    const reservedKeys = new Set([
      'chain_depth',
      'chainDepth',
      'consecutive_failures',
      'frequency_1m',
      'frequency_5m',
      'tool_source',
      'source',
    ]);

    if (toolName === 'transfer') {
      for (const key of ['amount', 'value', 'sum']) {
        const candidate = flattenedArgs[key];
        if (typeof candidate === 'number' && Number.isFinite(candidate)) {
          return { name: key, value: candidate, type: 'number' };
        }
      }
    }

    for (const key of matchKeys) {
      const candidate = flattenedArgs[key];
      if (typeof candidate === 'string' && candidate.length > 0) {
        return { name: key, value: candidate, type: 'string' };
      }
    }

    let bestStringKey: string | null = null;
    let bestStringValue = '';
    for (const [key, candidate] of Object.entries(flattenedArgs)) {
      if (reservedKeys.has(key)) {
        continue;
      }
      if (typeof candidate === 'string' && candidate.length > bestStringValue.length) {
        bestStringKey = key;
        bestStringValue = candidate;
      }
    }
    if (bestStringKey !== null) {
      return { name: bestStringKey, value: bestStringValue, type: 'string' };
    }

    for (const [key, candidate] of Object.entries(flattenedArgs)) {
      if (reservedKeys.has(key)) {
        continue;
      }
      if (typeof candidate === 'number' && Number.isFinite(candidate)) {
        return { name: key, value: candidate, type: 'number' };
      }
    }

    for (const [key, candidate] of Object.entries(flattenedArgs)) {
      if (reservedKeys.has(key)) {
        continue;
      }
      return {
        name: key,
        value: candidate,
        ...(candidate !== null && candidate !== undefined
          ? { type: typeof candidate }
          : {}),
      };
    }

    return { name: 'arguments', value: null, type: 'object' };
  }

  private resolveChainDepth(
    rpcMeta: Record<string, unknown>,
    flattenedArgs: Record<string, unknown>,
    sequenceNo: number,
  ): number {
    const candidates = [
      rpcMeta['chain_depth'],
      rpcMeta['chainDepth'],
      flattenedArgs['chain_depth'],
      flattenedArgs['chainDepth'],
      sequenceNo,
    ];

    for (const candidate of candidates) {
      if (typeof candidate === 'number' && Number.isFinite(candidate)) {
        return Math.max(0, Math.trunc(candidate));
      }
      if (typeof candidate === 'string' && candidate.trim().length > 0) {
        const parsed = Number(candidate);
        if (Number.isFinite(parsed)) {
          return Math.max(0, Math.trunc(parsed));
        }
      }
    }

    return 0;
  }

  private buildEventMetadata(
    session: ProxySession,
    toolName: string,
    rpcMeta: Record<string, unknown>,
    flattenedArgs: Record<string, unknown>,
  ): DetectionEvent['metadata'] | undefined {
    const metadata: NonNullable<DetectionEvent['metadata']> = {};

    const frequency1m = this.readNumericField(rpcMeta, flattenedArgs, [
      'frequency_1m',
      'frequency1m',
    ]);
    if (frequency1m !== undefined) {
      metadata.frequency_1m = frequency1m;
    }

    const frequency5m = this.readNumericField(rpcMeta, flattenedArgs, [
      'frequency_5m',
      'frequency5m',
    ]);
    if (frequency5m !== undefined) {
      metadata.frequency_5m = frequency5m;
    }

    const consecutiveFailures = this.readNumericField(rpcMeta, flattenedArgs, [
      'consecutive_failures',
      'consecutiveFailures',
    ]);
    const trackedFailures = this.consecutiveFailures.get(
      this.failureTrackerKey(session.sessionId, toolName),
    );
    const mergedFailures = Math.max(consecutiveFailures ?? 0, trackedFailures ?? 0);
    if (mergedFailures > 0) {
      metadata.consecutive_failures = mergedFailures;
    }

    const durationMs = this.readNumericField(rpcMeta, flattenedArgs, [
      'duration_ms',
      'durationMs',
    ]);
    const lastDuration = this.lastToolDurationMs.get(session.sessionId);
    const resolvedDuration = durationMs ?? lastDuration;
    if (resolvedDuration !== undefined && resolvedDuration > 0) {
      metadata.duration_ms = resolvedDuration;
    }

    return Object.keys(metadata).length > 0 ? metadata : undefined;
  }

  /** L1 频率计数回写 metadata — 与 FREQ_001 规则读数对齐（产品架构 §6.4） */
  private enrichDetectionEventFromL1(
    event: DetectionEvent,
    l1Result: L1DetectionResult,
  ): DetectionEvent {
    const frequencies = l1Result.frequency.frequencies;
    const metadata: NonNullable<DetectionEvent['metadata']> = {
      ...(event.metadata ?? {}),
      frequency_1m: frequencies['1m'],
      frequency_5m: frequencies['5m'],
    };
    return { ...event, metadata };
  }

  private trackPendingToolCall(request: JSONRPCRequest, session: ProxySession): void {
    if (request.id === null || request.id === undefined) {
      return;
    }
    const params = request.params ?? {};
    const toolName =
      typeof params['name'] === 'string' && params['name'].length > 0
        ? params['name']
        : 'unknown';
    this.pendingToolCalls.set(String(request.id), {
      sessionId: session.sessionId,
      toolName,
      startedAt: Date.now(),
    });
  }

  private recordToolCallOutcome(session: ProxySession, response: JSONRPCResponse): void {
    if (response.id === null || response.id === undefined) {
      return;
    }
    const pending = this.pendingToolCalls.get(String(response.id));
    if (pending === undefined) {
      return;
    }

    const durationMs = Date.now() - pending.startedAt;
    this.lastToolDurationMs.set(pending.sessionId, durationMs);

    const failKey = this.failureTrackerKey(pending.sessionId, pending.toolName);
    if (response.error !== undefined) {
      this.consecutiveFailures.set(failKey, (this.consecutiveFailures.get(failKey) ?? 0) + 1);
    } else {
      this.consecutiveFailures.delete(failKey);
    }

    this.pendingToolCalls.delete(String(response.id));
  }

  private failureTrackerKey(sessionId: string, toolName: string): string {
    return `${sessionId}:${toolName}`;
  }

  private buildBehaviorDimensionsFromL1(l1Result: L1DetectionResult): L1BehaviorDimensions {
    const dimensions: L1BehaviorDimensions = {};
    for (const [key, dim] of Object.entries(l1Result.zScore.dimensionScores)) {
      dimensions[key] = dim.value;
    }
    return dimensions;
  }

  private buildScenarioRiskMarkers(activeScenarios: string[]): SecurityMarker[] {
    const enginePseudo = new Set(['rule_engine', 'statistical_engine']);
    return activeScenarios
      .filter((scenario) => !enginePseudo.has(scenario))
      .map((scenario) => ({
        type: 'scenario',
        code: `scenario:${scenario}`,
        message: scenario,
      }));
  }

  private readNumericField(
    rpcMeta: Record<string, unknown>,
    flattenedArgs: Record<string, unknown>,
    keys: string[],
  ): number | undefined {
    for (const key of keys) {
      const candidate = rpcMeta[key] ?? flattenedArgs[key];
      if (typeof candidate === 'number' && Number.isFinite(candidate)) {
        return candidate;
      }
      if (typeof candidate === 'string' && candidate.trim().length > 0) {
        const parsed = Number(candidate);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }
    return undefined;
  }

  private resolveToolSource(
    params: Record<string, unknown>,
    rpcMeta: Record<string, unknown>,
    flattenedArgs: Record<string, unknown>,
  ): string | undefined {
    const candidates = [
      params['source'],
      rpcMeta['tool_source'],
      rpcMeta['source'],
      flattenedArgs['tool_source'],
      flattenedArgs['source'],
    ];

    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.length > 0) {
        return candidate;
      }
    }

    return undefined;
  }

  private buildScenarioScores(
    ruleMatches: RuleMatchResult[],
    l1Result: L1DetectionResult,
  ): Map<string, ScenarioScore> {
    const l0Score =
      ruleMatches.length > 0
        ? Math.max(...ruleMatches.map((match) => match.confidence))
        : 0;

    const scenarioScores = new Map<string, ScenarioScore>();
    scenarioScores.set('rule_engine', {
      scenario: 'rule_engine',
      score: l0Score,
      isAnomaly: ruleMatches.some(
        (match) => match.action === 'BLOCK' || match.action === 'WARN',
      ),
      indicators: ruleMatches.map((match) => match.ruleId),
    });
    scenarioScores.set('statistical_engine', {
      scenario: 'statistical_engine',
      score: this.resolveStatisticalEngineScore(l1Result),
      isAnomaly: l1Result.isAnomaly,
      indicators: this.buildStatisticalEngineIndicators(l1Result),
    });

    // TODO(DR-V1): 多场景权重映射 — 接入 config.agentWatch.scenarios.weights
    return scenarioScores;
  }

  private resolveStatisticalEngineScore(l1Result: L1DetectionResult): number {
    let score = l1Result.combinedScore;
    if (l1Result.cusum !== undefined) {
      for (const result of Object.values(l1Result.cusum)) {
        score = Math.max(score, result.score);
      }
    }
    if (l1Result.ewma !== undefined) {
      for (const result of Object.values(l1Result.ewma)) {
        score = Math.max(score, result.score);
      }
    }
    return score;
  }

  private buildStatisticalEngineIndicators(l1Result: L1DetectionResult): string[] {
    const indicators: string[] = [];
    if (l1Result.isAnomaly) {
      indicators.push('l1_combined_anomaly');
    }
    if (l1Result.cusum !== undefined) {
      for (const [dimension, result] of Object.entries(l1Result.cusum)) {
        if (result.isAlarm || result.score > 0) {
          indicators.push(`cusum:${dimension}`);
        }
      }
    }
    if (l1Result.ewma !== undefined) {
      for (const [dimension, result] of Object.entries(l1Result.ewma)) {
        if (result.isAnomaly || result.score > 0) {
          indicators.push(`ewma:${dimension}`);
        }
      }
    }
    return indicators;
  }

  private mapFusionDecisionToRuleAction(
    decision: 'ALLOW' | 'BLOCK' | 'WARN',
  ): RuleAction {
    if (decision === 'BLOCK') {
      return 'BLOCK';
    }
    if (decision === 'WARN') {
      return 'WARN';
    }
    return 'ALLOW';
  }

  private mapRuleMatchesToTriggeredRules(
    ruleMatches: RuleMatchResult[],
  ): TriggeredRule[] {
    return ruleMatches.map((match) => ({
      ruleId: match.ruleId,
      ruleName: match.ruleName,
      severity: match.severity,
      matchedValue: match.matchedFields,
    }));
  }

  private mapL1ToStatAnomalies(l1Result: L1DetectionResult): StatAnomaly[] {
    const anomalies: StatAnomaly[] = [];

    if (l1Result.zScore.isAnomaly) {
      anomalies.push({
        metricName: l1Result.zScore.maxDimension || 'zscore',
        metricType: 'zscore',
        observedValue: l1Result.zScore.maxZScore,
        expectedValue: 0,
        deviation: l1Result.zScore.maxZScore,
      });
    }

    if (l1Result.frequency.isAnomaly) {
      anomalies.push({
        metricName: l1Result.frequency.toolName,
        metricType: 'frequency',
        observedValue: l1Result.frequency.anomalyScore,
        expectedValue: 0,
        deviation: l1Result.frequency.anomalyScore,
      });
    }

    if (l1Result.markov.isAnomaly) {
      anomalies.push({
        metricName: 'markov_sequence',
        metricType: 'markov',
        observedValue: l1Result.markov.anomalyScore,
        expectedValue: 0,
        deviation: l1Result.markov.anomalyScore,
      });
    }

    if (l1Result.cusum !== undefined) {
      for (const [dimension, cusumResult] of Object.entries(l1Result.cusum)) {
        if (!cusumResult.isAlarm && cusumResult.score <= 0) {
          continue;
        }
        anomalies.push({
          metricName: dimension,
          metricType: 'cusum',
          observedValue: cusumResult.score,
          expectedValue: 0,
          deviation: Math.max(cusumResult.positiveSum, cusumResult.negativeSum),
        });
      }
    }

    if (l1Result.ewma !== undefined) {
      for (const [dimension, ewmaResult] of Object.entries(l1Result.ewma)) {
        if (!ewmaResult.isAnomaly && ewmaResult.score <= 0) {
          continue;
        }
        anomalies.push({
          metricName: dimension,
          metricType: 'ewma',
          observedValue: ewmaResult.score,
          expectedValue: ewmaResult.ewma,
          deviation: Math.max(
            Math.abs(ewmaResult.value - ewmaResult.ucl),
            Math.abs(ewmaResult.lcl - ewmaResult.value),
          ),
        });
      }
    }

    return anomalies;
  }

  private buildSecurityMarkers(
    sessionId: string,
    sequenceNo: number,
    decision: RuleAction,
  ): SecurityMarker[] {
    if (!this.config.agentWatch.proxy?.injectSecurityMarkers) {
      return [];
    }

    return [
      {
        type: 'audit',
        code: 'AW-AUDIT',
        message: `session=${sessionId} seq=${String(sequenceNo)} decision=${decision}`,
      },
    ];
  }

  private writeJsonRpc(
    session: ProxySession,
    stream: Writable,
    message: JSONRPCRequest | JSONRPCResponse,
  ): boolean {
    try {
      stream.write(`${JSON.stringify(message)}\n`);
      return true;
    } catch (cause) {
      this.handleStreamFault(session, 'writeJsonRpc', cause, message.id ?? null);
      return false;
    }
  }

  /** 标准 JSON-RPC 2.0 流故障响应 — 固定格式下发至 Client */
  private buildStreamErrorResponse(
    detail: string,
    id: string | number | null = null,
  ): JSONRPCResponse {
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: BLOCK_ERROR_CODE,
        message: '[AgentWatch] Stream error',
        data: {
          reason: 'stream_error',
          detail,
        },
      },
    };
  }

  /** 向 Client 输出流故障 JSON-RPC 错误报文 — 写失败时仅 console 记录，不二次抛出 */
  private emitStreamErrorResponse(
    session: ProxySession,
    detail: string,
    requestId: string | number | null = null,
  ): void {
    try {
      const response = this.buildStreamErrorResponse(detail, requestId);
      session.clientOut.write(`${JSON.stringify(response)}\n`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      console.error(
        `[MCPProxyCore][stream] failed to emit stream error response: ${message}`,
      );
    }
  }

  /** 流读写安全包装 — 捕获同步写异常并转为标准 JSON-RPC 错误响应 */
  private writeLineSafe(
    session: ProxySession,
    stream: Writable,
    line: string,
    context: string,
    requestId: string | number | null = null,
  ): boolean {
    try {
      stream.write(`${line}\n`);
      return true;
    } catch (cause) {
      this.handleStreamFault(session, context, cause, requestId);
      return false;
    }
  }

  /** 注册 client/server/stdio 原始流 error 监听 — 禁止未捕获异常冒泡至主进程 */
  private attachRelayStreamErrorHandlers(session: ProxySession): void {
    const bindings: Array<{ stream: Readable | Writable; label: string }> = [
      { stream: session.clientIn, label: 'clientIn' },
      { stream: session.clientOut, label: 'clientOut' },
      { stream: session.serverIn, label: 'serverIn' },
      { stream: session.serverOut, label: 'serverOut' },
      { stream: session.childProcess.stderr!, label: 'serverStderr' },
    ];

    for (const { stream, label } of bindings) {
      stream.on('error', (cause: Error) => {
        this.handleStreamFault(session, label, cause);
      });
    }
  }

  /** 流故障统一处理：AsyncLogger 告警 + 标准 JSON-RPC 错误下发，主进程保持存活 */
  private handleStreamFault(
    session: ProxySession,
    context: string,
    cause: unknown,
    requestId: string | number | null = null,
  ): void {
    if (this.shuttingDown) {
      return;
    }

    const detail = this.formatStreamFaultDetail(context, cause);
    console.error(`[MCPProxyCore][stream] context=${context} detail=${detail}`);
    this.logStreamFault(session, context, cause);
    this.emitStreamErrorResponse(session, detail, requestId);
  }

  private formatStreamFaultDetail(context: string, cause: unknown): string {
    const message = cause instanceof Error ? cause.message : String(cause);
    const stack = cause instanceof Error && cause.stack !== undefined ? cause.stack : undefined;
    return stack === undefined ? `[${context}] ${message}` : `[${context}] ${message}\n${stack}`;
  }

  /** 流异常完整堆栈写入 AsyncLogger — scenario=proxy_stream_fault */
  private logStreamFault(
    session: ProxySession,
    context: string,
    cause: unknown,
  ): void {
    const message = cause instanceof Error ? cause.message : String(cause);
    const stack = cause instanceof Error ? cause.stack : undefined;
    const detail = stack === undefined ? message : `${message}\n${stack}`;

    void Promise.resolve(
      session.asyncLogger.logAlert({
        alertId: `stream-${context}-${String(Date.now())}`,
        timestamp: Date.now(),
        severity: 'CRITICAL',
        scenario: 'proxy_stream_fault',
        message: `[${context}] ${detail}`,
        score: 1,
      }),
    ).catch((logCause: unknown) => {
      const logMessage = logCause instanceof Error ? logCause.message : String(logCause);
      console.error(`[MCPProxyCore][stream] logAlert failed: ${logMessage}`);
    });
  }

  private nextSequenceNo(): number {
    this.sequenceNo += 1;
    return this.sequenceNo;
  }

  private generateULID(): string {
    // TODO(P2): V1替换标准ulid第三方库，提升序列唯一性
    const timePart = Date.now().toString(36).padStart(10, '0');
    const randomPart = Math.random().toString(36).slice(2, 12).padStart(10, '0');
    return `${timePart}${randomPart}`.toUpperCase();
  }

  private isJsonRpcRequest(value: unknown): value is JSONRPCRequest {
    if (typeof value !== 'object' || value === null) {
      return false;
    }
    const candidate = value as JSONRPCRequest;
    return candidate.jsonrpc === '2.0' && typeof candidate.method === 'string';
  }

  private isJsonRpcResponse(value: unknown): value is JSONRPCResponse {
    if (typeof value !== 'object' || value === null) {
      return false;
    }
    const candidate = value as JSONRPCResponse;
    return (
      candidate.jsonrpc === '2.0' &&
      (candidate.result !== undefined || candidate.error !== undefined)
    );
  }

  private destroyStreamSafely(stream: Readable | Writable): void {
    if ('destroyed' in stream && stream.destroyed) {
      return;
    }
    stream.destroy();
  }

  private waitForChildExit(
    childProcess: ChildProcess,
    timeoutMs: number,
  ): Promise<void> {
    return new Promise((resolve) => {
      if (childProcess.killed) {
        resolve();
        return;
      }

      const timer = setTimeout(() => {
        if (!childProcess.killed) {
          childProcess.kill('SIGKILL');
        }
        resolve();
      }, timeoutMs);

      childProcess.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    eventId: string | number | null,
  ): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => {
            reject(
              this.createStructuredError(
                `Operation timed out after ${String(timeoutMs)}ms`,
                eventId,
                RiskType.PROCESS_TIMEOUT,
                new Error('timeout'),
              ),
            );
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  private createStructuredError(
    message: string,
    eventId: string | number | null,
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

  private assertDetectionBudget(
    perfStart: number,
    eventId: string | number | null,
  ): void {
    const elapsed = performance.now() - perfStart;
    const budgetMs = this.config.performance.maxDetectionLatencyMs;
    if (elapsed > budgetMs) {
      throw this.createStructuredError(
        `Tool call detection exceeded budget elapsedMs=${elapsed.toFixed(3)} budgetMs=${String(budgetMs)}`,
        eventId,
        RiskType.TOOL_CALL_DETECTION_TIMEOUT,
        new Error(`Exceeded maxDetectionLatencyMs=${String(budgetMs)}`),
      );
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
      `[MCPProxyCore][perf] op=${operation} durationMs=${durationMs.toFixed(3)} budgetMs=${String(budgetMs)} withinBudget=${String(withinBudget)}`,
    );
  }
}
