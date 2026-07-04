/**
 * A2ARiskDetector — 跨代理 (Agent-to-Agent) 场景风险检测
 * L0 规则匹配后同步执行；不修改 L0/L1 引擎内部逻辑
 */
import type { DetectionEvent } from '@packages/shared/types';
import type { SecurityMarker } from '@packages/shared/types';

const A2A_TOOL_PATTERN = /delegate|authorize|a2a/i;
const AMOUNT_BLOCK_THRESHOLD = 1000;

export interface A2ARiskDetectorOptions {
  enabled: boolean;
  /** 本地 Agent 标识 — 来自 config agentId */
  localAgentId: string;
  /** 已登记 Agent ID 白名单 — 未配置时仅允许 localAgentId */
  registeredAgentIds?: string[];
}

export interface A2ARiskAssessment {
  matched: boolean;
  decision: 'WARN' | 'BLOCK';
  severity: 'WARN' | 'HIGH';
  scenario: string;
  message: string;
  markers: SecurityMarker[];
}

export class A2ARiskDetector {
  private readonly enabled: boolean;
  private readonly localAgentId: string;
  private readonly registeredAgentIds: Set<string>;

  constructor(options: A2ARiskDetectorOptions) {
    this.enabled = options.enabled;
    this.localAgentId = options.localAgentId;
    this.registeredAgentIds = new Set(
      options.registeredAgentIds ?? [options.localAgentId],
    );
  }

  /** L0 之后同步评估 — enabled=false 时直接返回 null */
  assess(event: DetectionEvent): A2ARiskAssessment | null {
    try {
      if (!this.enabled) {
        return null;
      }

      const toolName = event.tool.name;
      if (!A2A_TOOL_PATTERN.test(toolName)) {
        return null;
      }

      const targetAgentId = this.extractTargetAgentId(event);
      const amount = this.extractAmount(event);
      const crossAgent = this.isCrossAgentCall(targetAgentId);

      if (crossAgent && amount > AMOUNT_BLOCK_THRESHOLD) {
        return {
          matched: true,
          decision: 'BLOCK',
          severity: 'HIGH',
          scenario: 'a2a_high_value_cross_agent',
          message: `A2A high-value cross-agent transfer blocked amount=${String(amount)} targetAgent=${targetAgentId ?? 'unknown'}`,
          markers: [
            {
              type: 'scenario',
              code: 'A2A_BLOCK',
              message: 'a2a_high_value_cross_agent',
            },
          ],
        };
      }

      if (targetAgentId !== null && !this.registeredAgentIds.has(targetAgentId)) {
        return {
          matched: true,
          decision: 'WARN',
          severity: 'WARN',
          scenario: 'a2a_unknown_agent',
          message: `A2A unknown agentId=${targetAgentId}`,
          markers: [
            {
              type: 'scenario',
              code: 'A2A_WARN',
              message: 'a2a_unknown_agent',
            },
          ],
        };
      }

      return null;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      console.error(`[A2ARiskDetector] assess failed: ${message}`);
      return null;
    }
  }

  private extractTargetAgentId(event: DetectionEvent): string | null {
    const fromArgs = this.readAgentIdFromRecord(this.flattenArguments(event.arguments));
    if (fromArgs !== null) {
      return fromArgs;
    }

    const metadata = event.metadata;
    if (metadata !== null && typeof metadata === 'object' && !Array.isArray(metadata)) {
      return this.readAgentIdFromRecord(metadata as Record<string, unknown>);
    }

    return null;
  }

  private flattenArguments(arguments_: DetectionEvent['arguments']): Record<string, unknown> {
    const flattened: Record<string, unknown> = {};
    if (!Array.isArray(arguments_)) {
      return flattened;
    }

    for (const entry of arguments_) {
      if (typeof entry.name === 'string') {
        flattened[entry.name] = entry.value;
      }
    }
    return flattened;
  }

  private readAgentIdFromRecord(record: Record<string, unknown>): string | null {
    const keys = ['agentId', 'targetAgentId', 'delegateAgentId', 'toAgentId'];
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string' && value.length > 0) {
        return value;
      }
    }
    return null;
  }

  private extractAmount(event: DetectionEvent): number {
    const flattened = this.flattenArguments(event.arguments);
    const candidates = ['amount', 'value', 'transferAmount'];
    for (const key of candidates) {
      const raw = flattened[key];
      if (typeof raw === 'number' && Number.isFinite(raw)) {
        return raw;
      }
      if (typeof raw === 'string') {
        const parsed = Number(raw);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }
    return 0;
  }

  private isCrossAgentCall(targetAgentId: string | null): boolean {
    if (targetAgentId === null) {
      return false;
    }
    return targetAgentId !== this.localAgentId;
  }
}
