/**
 * MCP Proxy 会话类型定义
 * 适配文档：task_proxy_config.md (§3.1 ProxySession L363-L388, MPC-01)
 * 独立文件：聚合 proxy + api + fusion，打破 proxy ↔ api 循环依赖
 */
/// <reference types="node" />
import type { ChildProcess } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import type { ILogger, IRuleEngine, IStatisticalEngine } from './api.types.js';
import type { IDecisionRouter } from './fusion.types.js';
import type { DetectionResult, JSONRPCRequest } from './proxy.types.js';

/** MCP Proxy 会话状态 — 子进程、管道、引擎引用与生命周期方法 */
export interface ProxySession {
  sessionId: string;
  /** 会话级递增序号 — MPC-11 sequence_no */
  sequenceNo: number;
  childProcess: ChildProcess;
  clientIn: Readable;
  serverOut: Readable;
  clientOut: Writable;
  serverIn: Writable;
  ruleEngine: IRuleEngine;
  statEngine: IStatisticalEngine;
  asyncLogger: ILogger;
  decisionRouter: IDecisionRouter;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  handleToolCall: (request: JSONRPCRequest) => Promise<DetectionResult>;
}
