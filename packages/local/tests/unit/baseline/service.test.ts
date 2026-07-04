import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BaselineService } from '../../../src/baseline/BaselineService.js';
import { ColdStartController } from '../../../src/baseline/ColdStartController.js';
import { DatabaseManager } from '../../../src/storage/DatabaseManager.js';

import type { DetectionEvent, L1BehaviorDimensions } from '@packages/shared/types';

function buildEvent(overrides?: Partial<DetectionEvent>): DetectionEvent {
  return {
    tool: { name: 'transfer', ...(overrides?.tool ?? {}) },
    argument: { name: 'amount', value: 100, ...(overrides?.argument ?? {}) },
    request: {
      timestamp: Date.now(),
      session_id: 'sess-baseline',
      ...(overrides?.request ?? {}),
    },
  };
}

const normalDimensions: L1BehaviorDimensions = {
  chain_depth: 2,
  arg_count: 3,
  tool_frequency: 1,
  latency: 12,
  error_rate: 0,
  user_repeat: 1,
};

describe('ColdStartController', () => {
  const controller = new ColdStartController();

  it('switches tiers at 10 and 100 call boundaries', () => {
    expect(controller.resolveTier(0)).toBe('L1');
    expect(controller.resolveTier(9)).toBe('L1');
    expect(controller.resolveTier(10)).toBe('L2');
    expect(controller.resolveTier(99)).toBe('L2');
    expect(controller.resolveTier(100)).toBe('L3');
  });

  it('relaxes Z-score threshold during early cold start', () => {
    const l1 = controller.buildPolicy(5, 3);
    const l3 = controller.buildPolicy(150, 3);
    expect(l1.zScoreThreshold).toBeGreaterThan(l3.zScoreThreshold);
    expect(l1.deviationWeight).toBeLessThan(l3.deviationWeight);
  });
});

describe('BaselineService', () => {
  let previousHome: string | undefined;
  let service: BaselineService;

  beforeEach(() => {
    previousHome = process.env['HOME'];
    process.env['HOME'] = mkdtempSync(join(tmpdir(), 'agentwatch-baseline-svc-'));
    service = new BaselineService({
      userId: 'user-1',
      agentId: 'agent-1',
    });
  });

  afterEach(() => {
    DatabaseManager.getInstance().close();
    if (previousHome === undefined) {
      delete process.env['HOME'];
    } else {
      process.env['HOME'] = previousHome;
    }
    vi.useRealTimers();
  });

  it('updates Welford variance for normal observations', () => {
    for (let index = 0; index < 20; index += 1) {
      service.recordObservation({
        event: buildEvent(),
        dimensions: { ...normalDimensions, arg_count: 10 + index },
        isAnomaly: false,
        baseZScoreThreshold: 3,
      });
    }

    expect(service.getParamVariance('arg_count')).toBeGreaterThan(0);
    expect(service.getToolFrequency('transfer')).toBe(20);
  });

  it('does not pollute baseline stats when observation is anomalous', () => {
    service.recordObservation({
      event: buildEvent({ tool: { name: 'safe_tool' } }),
      dimensions: normalDimensions,
      isAnomaly: false,
      baseZScoreThreshold: 3,
    });

    service.recordObservation({
      event: buildEvent({ tool: { name: 'evil_tool' } }),
      dimensions: { ...normalDimensions, arg_count: 9999 },
      isAnomaly: true,
      baseZScoreThreshold: 3,
    });

    expect(service.getToolFrequency('safe_tool')).toBe(1);
    expect(service.getToolFrequency('evil_tool')).toBe(0);
    expect(service.getParamVariance('arg_count')).toBe(0);
  });

  it('persists snapshot on explicit persist() and reloads on restart', () => {
    for (let index = 0; index < 10; index += 1) {
      service.recordObservation({
        event: buildEvent(),
        dimensions: normalDimensions,
        isAnomaly: false,
        baseZScoreThreshold: 3,
      });
    }
    service.persist();

    const reloaded = new BaselineService({
      userId: 'user-1',
      agentId: 'agent-1',
    });
    const cache = reloaded.hydrateFromStorage();
    expect(cache).not.toBeNull();
    expect(reloaded.getTotalCalls()).toBe(10);
    expect(reloaded.getToolFrequency('transfer')).toBe(10);
  });

  it('applies daily 0.95 forgetting factor to historical activity', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-04T10:00:00.000Z'));

    service.recordObservation({
      event: buildEvent({
        request: { timestamp: Date.parse('2026-07-04T10:00:00.000Z'), session_id: 's1' },
      }),
      dimensions: normalDimensions,
      isAnomaly: false,
      baseZScoreThreshold: 3,
    });

    const before = service.getHourlyActivity()[10] ?? 0;
    expect(before).toBe(1);

    vi.setSystemTime(new Date('2026-07-05T10:00:00.000Z'));
    service.recordObservation({
      event: buildEvent({
        request: { timestamp: Date.parse('2026-07-05T10:00:00.000Z'), session_id: 's1' },
      }),
      dimensions: normalDimensions,
      isAnomaly: false,
      baseZScoreThreshold: 3,
    });

    const after = service.getHourlyActivity()[10] ?? 0;
    expect(after).toBeCloseTo(1 + before * 0.95, 5);
  });

  it('applies monthly 0.95 forgetting when monthlyDecay is enabled', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-04T10:00:00.000Z'));

    const monthlyService = new BaselineService({
      userId: 'user-1',
      agentId: 'agent-1',
      monthlyDecay: true,
    });

    monthlyService.recordObservation({
      event: buildEvent({
        request: { timestamp: Date.parse('2026-07-04T10:00:00.000Z'), session_id: 's1' },
      }),
      dimensions: normalDimensions,
      isAnomaly: false,
      baseZScoreThreshold: 3,
    });

    const before = monthlyService.getHourlyActivity()[10] ?? 0;
    expect(before).toBe(1);

    vi.setSystemTime(new Date('2026-07-05T10:00:00.000Z'));
    monthlyService.recordObservation({
      event: buildEvent({
        request: { timestamp: Date.parse('2026-07-05T10:00:00.000Z'), session_id: 's1' },
      }),
      dimensions: normalDimensions,
      isAnomaly: false,
      baseZScoreThreshold: 3,
    });

    expect(monthlyService.getHourlyActivity()[10] ?? 0).toBe(2);

    vi.setSystemTime(new Date('2026-08-01T10:00:00.000Z'));
    monthlyService.recordObservation({
      event: buildEvent({
        request: { timestamp: Date.parse('2026-08-01T10:00:00.000Z'), session_id: 's1' },
      }),
      dimensions: normalDimensions,
      isAnomaly: false,
      baseZScoreThreshold: 3,
    });

    const afterMonth = monthlyService.getHourlyActivity()[10] ?? 0;
    expect(afterMonth).toBeCloseTo(1 + 2 * 0.95, 5);
  });
});
