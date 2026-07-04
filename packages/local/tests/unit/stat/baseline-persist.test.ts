import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BaselineStorage } from '../../../src/baseline/BaselineStorage.js';
import { StatBaseline } from '../../../src/stat/StatBaseline.js';
import { DatabaseManager } from '../../../src/storage/DatabaseManager.js';

import type { L1BehaviorDimensions } from '@packages/shared/types';

const sampleDimensions: L1BehaviorDimensions = {
  chain_depth: 2,
  arg_count: 3,
  tool_frequency: 1,
  latency: 12,
  error_rate: 0,
  user_repeat: 1,
};

describe('StatBaseline persistence', () => {
  let previousHome: string | undefined;
  let storage: BaselineStorage;

  beforeEach(() => {
    previousHome = process.env['HOME'];
    process.env['HOME'] = mkdtempSync(join(tmpdir(), 'agentwatch-stat-baseline-'));
    storage = new BaselineStorage();
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

  it('restores historical baseline after simulated process restart', () => {
    const baseline = new StatBaseline(storage, 'user-restart', 'agent-restart');
    for (let index = 0; index < 20; index += 1) {
      baseline.update({
        toolName: 'transfer',
        dimensions: { ...sampleDimensions, arg_count: 10 + index },
        timestamp: Date.now(),
      });
    }
    baseline.persist();

    const reloaded = new StatBaseline(storage, 'user-restart', 'agent-restart');
    expect(reloaded.getTotalUpdates()).toBe(20);
    expect(reloaded.getToolFrequency('transfer')).toBe(20);
    expect(reloaded.getParamVariance('arg_count')).toBeGreaterThan(0);
  });

  it('auto-persists to SQLite after 100 cumulative update() calls', () => {
    const baseline = new StatBaseline(storage, 'user-auto', 'agent-auto');
    for (let index = 0; index < 100; index += 1) {
      baseline.update({
        toolName: 'read_file',
        dimensions: sampleDimensions,
        timestamp: Date.now(),
      });
    }

    const reloaded = new StatBaseline(storage, 'user-auto', 'agent-auto');
    expect(reloaded.getTotalUpdates()).toBe(100);
    expect(reloaded.getToolFrequency('read_file')).toBe(100);
  });

  it('applyForgetting() decays all statistics by factor 0.95', () => {
    const baseline = new StatBaseline(storage, 'user-decay', 'agent-decay');
    baseline.update({
      toolName: 'tool-a',
      dimensions: { ...sampleDimensions, arg_count: 100 },
      timestamp: Date.parse('2026-07-04T10:00:00.000Z'),
    });
    baseline.update({
      toolName: 'tool-a',
      dimensions: { ...sampleDimensions, arg_count: 102 },
      timestamp: Date.parse('2026-07-04T10:05:00.000Z'),
    });

    const freqBefore = baseline.getToolFrequency('tool-a');
    const hourBefore = baseline.getHourlyActivity()[10] ?? 0;
    const varianceBefore = baseline.getParamVariance('arg_count');

    baseline.applyForgetting();

    expect(baseline.getToolFrequency('tool-a')).toBeCloseTo(freqBefore * 0.95, 5);
    expect(baseline.getHourlyActivity()[10]).toBeCloseTo(hourBefore * 0.95, 5);
    expect(baseline.getParamVariance('arg_count')).toBeCloseTo(varianceBefore * 0.95, 5);
  });

  it('persist() force-writes in-memory baseline to SQLite', () => {
    const baseline = new StatBaseline(storage, 'user-force', 'agent-force');
    baseline.update({
      toolName: 'write_file',
      dimensions: sampleDimensions,
      timestamp: Date.now(),
    });
    baseline.persist();

    const raw = storage.load('user-force', 'agent-force') as Record<string, unknown>;
    expect(raw).not.toBeNull();
    expect(raw['totalUpdates']).toBe(1);
    expect((raw['toolFrequency'] as Record<string, number>)['write_file']).toBe(1);
  });
});
