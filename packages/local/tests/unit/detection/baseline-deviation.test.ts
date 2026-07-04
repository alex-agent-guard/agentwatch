import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BaselineService } from '../../../src/baseline/BaselineService.js';
import {
  BASELINE_DEVIATION_SCENARIO,
  BaselineDeviationDetector,
} from '../../../src/detection/scenarios/BaselineDeviationDetector.js';
import { DecisionRouter } from '../../../src/detection/DecisionRouter.js';
import { DatabaseManager } from '../../../src/storage/DatabaseManager.js';
import { DEFAULT_BASELINE_DEVIATION_WEIGHT } from '@packages/shared/constants';

import type { DetectionEvent, L1BehaviorDimensions } from '@packages/shared/types';

let previousHome: string | undefined;

beforeEach(() => {
  previousHome = process.env['HOME'];
  process.env['HOME'] = mkdtempSync(join(tmpdir(), 'agentwatch-baseline-deviation-'));
});

afterEach(() => {
  DatabaseManager.getInstance().close();
  if (previousHome === undefined) {
    delete process.env['HOME'];
  } else {
    process.env['HOME'] = previousHome;
  }
  vi.restoreAllMocks();
});

function seedDaytimeBaseline(baselineService: BaselineService): void {
  const baseTimestamp = Date.UTC(2026, 6, 3, 10, 0, 0);
  for (let hour = 9; hour <= 17; hour += 1) {
    for (let index = 0; index < 20; index += 1) {
      const timestamp = Date.UTC(2026, 6, 3, hour, index, 0);
      baselineService.recordObservation({
        event: {
          tool: { name: 'transfer' },
          argument: { name: 'amount', value: 100 },
          request: {
            timestamp,
            session_id: 'sess-baseline',
            user_id: 'user-1',
          },
          arguments: [{ name: 'amount', value: 100 }],
        },
        dimensions: {
          transfer_amount: 100,
          arg_count: 1,
          tool_frequency: 1,
        },
        isAnomaly: false,
        baseZScoreThreshold: 3,
      });
    }
  }
}

function buildTransferEvent(timestamp: number): DetectionEvent {
  return {
    tool: { name: 'transfer' },
    argument: { name: 'amount', value: 5000 },
    request: {
      timestamp,
      session_id: 'sess-baseline',
      user_id: 'user-1',
    },
    arguments: [{ name: 'amount', value: 5000 }],
  };
}

describe('BaselineDeviationDetector', () => {
  it('returns null when detector is disabled via config', () => {
    const baselineService = new BaselineService();
    const detector = new BaselineDeviationDetector({
      enabled: false,
      baselineService,
    });

    expect(
      detector.assess(buildTransferEvent(Date.now()), { transfer_amount: 100 }),
    ).toBeNull();
  });

  it('scores temporal deviation above 0.5 for 3am calls against daytime baseline', () => {
    const baselineService = new BaselineService();
    seedDaytimeBaseline(baselineService);

    const detector = new BaselineDeviationDetector({
      enabled: true,
      baselineService,
    });

    const threeAmLocal = new Date(2026, 6, 4, 3, 15, 0).getTime();
    const dimensions = detector.computeDimensionScores(
      'transfer',
      { transfer_amount: 5000, arg_count: 1 },
      threeAmLocal,
    );

    expect(dimensions.temporal).toBeGreaterThan(0.5);

    const scenario = detector.assess(
      buildTransferEvent(threeAmLocal),
      { transfer_amount: 5000, arg_count: 1 },
    );
    expect(scenario?.scenario).toBe(BASELINE_DEVIATION_SCENARIO);
    expect(scenario?.score).toBeGreaterThan(0);
    expect(scenario?.indicators.some((entry) => entry.startsWith('baseline:temporal:'))).toBe(
      true,
    );
  });

  it('computes tool frequency and param variance deviations aligned with BaselineService', () => {
    const baselineService = new BaselineService();
    seedDaytimeBaseline(baselineService);

    for (let index = 0; index < 30; index += 1) {
      baselineService.recordObservation({
        event: {
          tool: { name: 'swap' },
          argument: { name: 'amount', value: 50 },
          request: {
            timestamp: Date.UTC(2026, 6, 3, 12, index, 0),
            session_id: 'sess-baseline',
            user_id: 'user-1',
          },
        },
        dimensions: { transfer_amount: 50, arg_count: 1 },
        isAnomaly: false,
        baseZScoreThreshold: 3,
      });
    }

    const detector = new BaselineDeviationDetector({
      enabled: true,
      baselineService,
    });

    const dimensions: L1BehaviorDimensions = {
      transfer_amount: 999_999,
      arg_count: 12,
    };
    const noonTimestamp = Date.UTC(2026, 6, 3, 12, 0, 0);
    const dimensionScores = detector.computeDimensionScores(
      'rare_tool',
      dimensions,
      noonTimestamp,
    );

    expect(dimensionScores.toolFrequency).toBeGreaterThan(0);
    expect(dimensionScores.paramVariance).toBeGreaterThan(0);
  });

  it('swallows assess errors and logs without throwing', () => {
    const baselineService = new BaselineService();
    const detector = new BaselineDeviationDetector({
      enabled: true,
      baselineService,
    });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(baselineService, 'exportSnapshot').mockImplementation(() => {
      throw new Error('snapshot failed');
    });

    expect(detector.assess(buildTransferEvent(Date.now()), {})).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[BaselineDeviationDetector] assess failed'),
    );

    errorSpy.mockRestore();
    vi.restoreAllMocks();
  });
});

describe('DecisionRouter baseline_deviation branch', () => {
  it('adds baseline_deviation with fixed weight 0.03 without changing rule/stat weights', () => {
    const router = new DecisionRouter({
      blockThreshold: 0.8,
      warnThreshold: 0.5,
      ruleWeight: 0.6,
      statWeight: 0.4,
      decisionBudgetMs: 50,
    });

    const baselineOnly = router.detect(
      [],
      {
        zScore: {
          combinedScore: 0,
          maxZScore: 0,
          maxDimension: 'none',
          dimensionScores: {},
          isAnomaly: false,
          confidence: 0,
        },
        frequency: {
          toolName: 'transfer',
          frequencies: { '1m': 0, '5m': 0, '1h': 0, '1d': 0 },
          anomalyScore: 0,
          isAnomaly: false,
        },
        markov: {
          logProbability: 0,
          perplexity: 1,
          anomalyScore: 0,
          isAnomaly: false,
        },
        combinedScore: 0,
        isAnomaly: false,
        latencyMs: 1,
      },
      'evt-1',
      [
        {
          scenario: BASELINE_DEVIATION_SCENARIO,
          score: 1,
          isAnomaly: true,
          indicators: ['baseline:temporal:hour_3'],
        },
      ],
    );

    expect(baselineOnly.baseScore).toBeCloseTo(DEFAULT_BASELINE_DEVIATION_WEIGHT, 5);
    expect(baselineOnly.scenarioBreakdown[BASELINE_DEVIATION_SCENARIO]?.score).toBe(1);
    expect(baselineOnly.activeScenarios).toContain(BASELINE_DEVIATION_SCENARIO);
  });
});
