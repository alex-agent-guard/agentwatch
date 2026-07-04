import { describe, expect, it, vi } from 'vitest';

import { A2ARiskDetector } from '../../../src/detection/scenarios/A2ARiskDetector.js';

import type { DetectionEvent } from '@packages/shared/types';

function buildA2AEvent(overrides?: Partial<DetectionEvent>): DetectionEvent {
  return {
    tool: { name: overrides?.tool?.name ?? 'delegate_transfer' },
    argument: { name: 'amount', value: 100 },
    request: {
      timestamp: Date.now(),
      session_id: 'sess-a2a',
      user_id: 'user-1',
    },
    arguments: [
      { name: 'agentId', value: 'agent_unknown' },
      { name: 'amount', value: 2000 },
    ],
    ...(overrides ?? {}),
  };
}

describe('A2ARiskDetector', () => {
  it('returns null when detector is disabled via config', () => {
    const detector = new A2ARiskDetector({
      enabled: false,
      localAgentId: 'agent_local',
    });

    expect(detector.assess(buildA2AEvent())).toBeNull();
  });

  it('warns on unknown agentId for A2A tool names', () => {
    const detector = new A2ARiskDetector({
      enabled: true,
      localAgentId: 'agent_local',
      registeredAgentIds: ['agent_local'],
    });

    const result = detector.assess(
      buildA2AEvent({
        arguments: [{ name: 'agentId', value: 'agent_unknown' }, { name: 'amount', value: 10 }],
      }),
    );

    expect(result?.decision).toBe('WARN');
    expect(result?.scenario).toBe('a2a_unknown_agent');
  });

  it('blocks high-value cross-agent transfers', () => {
    const detector = new A2ARiskDetector({
      enabled: true,
      localAgentId: 'agent_local',
      registeredAgentIds: ['agent_local', 'agent_peer'],
    });

    const result = detector.assess(
      buildA2AEvent({
        tool: { name: 'a2a_authorize_payment' },
        arguments: [
          { name: 'targetAgentId', value: 'agent_peer' },
          { name: 'amount', value: 5000 },
        ],
      }),
    );

    expect(result?.decision).toBe('BLOCK');
    expect(result?.severity).toBe('HIGH');
    expect(result?.scenario).toBe('a2a_high_value_cross_agent');
  });

  it('ignores non-A2A tool names', () => {
    const detector = new A2ARiskDetector({
      enabled: true,
      localAgentId: 'agent_local',
    });

    expect(
      detector.assess(
        buildA2AEvent({
          tool: { name: 'transfer' },
        }),
      ),
    ).toBeNull();
  });

  it('does not throw when arguments are malformed', () => {
    const detector = new A2ARiskDetector({
      enabled: true,
      localAgentId: 'agent_local',
    });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = detector.assess({
      tool: { name: 'delegate_action' },
      argument: { name: 'x', value: 1 },
      request: { timestamp: Date.now(), session_id: 's' },
    });

    expect(result).toBeNull();
    errorSpy.mockRestore();
  });
});

describe('MCPProxyCore A2A integration', () => {
  it('escalates decision when A2A detector returns BLOCK', async () => {
    const { MCPProxyCore } = await import('../../../src/proxy/MCPProxyCore.js');
    const { RuleEngine } = await import('../../../src/rule/RuleEngine.js');
    const { StatEngine } = await import('../../../src/stat/StatEngine.js');
    const { DecisionRouter } = await import('../../../src/detection/DecisionRouter.js');
    const { PassThrough } = await import('node:stream');
    const { V0_BUILTIN_RULES } = await import('../../../src/rule/builtin.js');

    const ruleEngine = new RuleEngine({ maxMatchTimeMs: 10 });
    ruleEngine.loadRuleSet({
      id: 'builtin',
      name: 'builtin',
      description: 'test',
      rules: V0_BUILTIN_RULES,
      priority: 0,
      defaultAction: 'ALLOW',
    });

    const statEngine = new StatEngine();
    statEngine.loadBuiltinBaseline();

    const decisionRouter = new DecisionRouter({
      blockThreshold: 0.8,
      warnThreshold: 0.5,
      ruleWeight: 0.6,
      statWeight: 0.4,
      decisionBudgetMs: 50,
    });

    const a2aDetector = new A2ARiskDetector({
      enabled: true,
      localAgentId: 'agent_local',
      registeredAgentIds: ['agent_local'],
    });

    const proxy = new MCPProxyCore(
      {
        server: { command: 'node', args: ['-e', 'process.stdin.pipe(process.stdout)'] },
        agentWatch: {
          performance: { maxDetectionLatencyMs: 50 },
          detection: {
            ruleEngine: { enabled: true, rulesPath: '', maxMatchTimeMs: 10 },
            statisticalEngine: {
              enabled: true,
              zScoreThreshold: 3,
              coldStartMinSamples: 30,
              combinedScoreThreshold: 0.7,
              maxZScoreThreshold: 4,
              markovAnomalyThreshold: 0.7,
              markovUnknownRatioThreshold: 0.5,
              markovSmoothingAlpha: 0.1,
              windowSizeMs: 300_000,
            },
            decisionRouter: {
              blockThreshold: 0.8,
              warnThreshold: 0.5,
              ruleWeight: 0.6,
              statWeight: 0.4,
            },
            a2aRisk: true,
          },
          logging: {
            level: 'info',
            format: 'json',
            output: './logs',
            mask: { enabled: false, level: 0, sensitiveFields: [] },
            rotation: { maxSizeMB: 100, maxFiles: 7 },
          },
        },
        performance: { maxDetectionLatencyMs: 50 },
      },
      ruleEngine,
      statEngine,
      {
        logBlocked: async () => undefined,
        logAllowed: async () => undefined,
        logWarn: async () => undefined,
        logRaw: async () => undefined,
        logAlert: async () => undefined,
        queryLogs: () => [],
        flush: async () => undefined,
        writeFlush: async () => undefined,
        beforeExit: () => undefined,
        shutdown: async () => undefined,
      },
      decisionRouter,
      new PassThrough(),
      new PassThrough(),
      a2aDetector,
    );

    const session = await proxy.start();

    const result = await session.handleToolCall({
      jsonrpc: '2.0',
      id: 'a2a-1',
      method: 'tools/call',
      params: {
        name: 'delegate_transfer',
        arguments: [
          { name: 'targetAgentId', value: 'agent_other' },
          { name: 'amount', value: 9000 },
        ],
      },
    });

    expect(result.decision).toBe('BLOCK');
    await session.stop();
  });
});
