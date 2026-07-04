/**
 * V0 内置 L1 统计基线静态数据集 — L1-RULE-01
 * 契约：BaselineCache / ToolSequence / WelfordStatsState (@packages/shared/types)
 * 仅静态常量，无运行时检测逻辑
 */
import type {
  BaselineCache,
  ToolSequence,
  WelfordStatsState,
} from '@packages/shared/types';

/** 单条内置 L1 基线 — 由 shared 契约字段组合 */
export type L1BaselineRecord = BaselineCache & {
  id: string;
  name: string;
  description: string;
  markovSeedSequence: ToolSequence;
  frequencySeeds: Record<string, number>;
  effectiveFrom?: number;
  effectiveTo?: number;
};

/** V0 内置 L1 基线条目数组类型 */
export type L1Baseline = readonly L1BaselineRecord[];

const V0_BASELINE_AUTHOR = 'AgentWatch';
const V0_BASELINE_VERSION = '1.0.0';
const V0_BASELINE_EFFECTIVE_FROM = 1_704_067_200_000;
const V0_BASELINE_EFFECTIVE_TO = 1_800_000_000_000;

/** 预计算 Welford 状态 — 模块加载期静态数值，非运行时采样 */
function staticWelford(samples: readonly number[]): WelfordStatsState {
  let count = 0;
  let mean = 0;
  let m2 = 0;
  for (const value of samples) {
    count += 1;
    const delta = value - mean;
    mean += delta / count;
    const delta2 = value - mean;
    m2 += delta * delta2;
  }
  return { count, mean, m2 };
}

function buildSamples(
  length: number,
  factory: (index: number) => number,
): readonly number[] {
  return Array.from({ length }, (_, index) => factory(index));
}

function buildDimensions(
  overrides: Partial<Record<keyof BaselineCache['dimensions'], readonly number[]>>,
): BaselineCache['dimensions'] {
  return {
    chain_depth: staticWelford(
      overrides.chain_depth ??
        buildSamples(35, (index) => 1 + (index % 3)),
    ),
    arg_count: staticWelford(
      overrides.arg_count ?? buildSamples(35, (index) => 2 + (index % 2)),
    ),
    tool_frequency: staticWelford(
      overrides.tool_frequency ??
        buildSamples(35, (index) => 4 + (index % 5)),
    ),
    latency: staticWelford(
      overrides.latency ?? buildSamples(35, (index) => 45 + (index % 10)),
    ),
    error_rate: staticWelford(
      overrides.error_rate ?? buildSamples(35, () => 0),
    ),
    user_repeat: staticWelford(
      overrides.user_repeat ?? buildSamples(35, (index) => 1 + (index % 2)),
    ),
    metadata_frequency_1m: staticWelford(
      overrides.metadata_frequency_1m ??
        buildSamples(35, (index) => 8 + (index % 4)),
    ),
    metadata_frequency_5m: staticWelford(
      overrides.metadata_frequency_5m ??
        buildSamples(35, (index) => 6 + (index % 5)),
    ),
    metadata_consecutive_failures: staticWelford(
      overrides.metadata_consecutive_failures ??
        buildSamples(35, (index) => index % 2),
    ),
  };
}

const V0_MARKOV_SEED_SEQUENCE: ToolSequence = [
  'read_file',
  'write_file',
  'read_file',
  'write_file',
  'list_dir',
  'read_file',
  'write_file',
];

const V0_FREQUENCY_SEEDS: Record<string, number> = {
  read_file: 12,
  write_file: 8,
  list_dir: 4,
  transfer: 2,
};

/** L1-RULE-01：V0 内置 L1 统计基线（8 套独立 profile，对齐 L0 场景维度） */
export const V0_BUILTIN_BASELINE: L1Baseline = [
  {
    id: 'V0_L1_BASELINE_001',
    name: 'Default Read/Write Profile',
    description: `${V0_BASELINE_AUTHOR} ${V0_BASELINE_VERSION} default z-score / frequency / Markov seed`,
    dimensions: buildDimensions({}),
    markovSeedSequence: V0_MARKOV_SEED_SEQUENCE,
    frequencySeeds: V0_FREQUENCY_SEEDS,
    effectiveFrom: V0_BASELINE_EFFECTIVE_FROM,
    effectiveTo: V0_BASELINE_EFFECTIVE_TO,
  },
  {
    id: 'V0_L1_BASELINE_002',
    name: 'Goal Hijacking Low-Variance Profile',
    description: 'Stable prompt argument shape for hijack detection cold start',
    dimensions: buildDimensions({
      arg_count: buildSamples(35, () => 1),
      user_repeat: buildSamples(35, () => 1),
    }),
    markovSeedSequence: ['read_file', 'read_file', 'write_file'],
    frequencySeeds: { read_file: 10, write_file: 6 },
    effectiveFrom: V0_BASELINE_EFFECTIVE_FROM,
    effectiveTo: V0_BASELINE_EFFECTIVE_TO,
  },
  {
    id: 'V0_L1_BASELINE_003',
    name: 'Parameter Tampering Transfer Profile',
    description: 'Elevated transfer tool frequency baseline for tampering context',
    dimensions: buildDimensions({
      tool_frequency: buildSamples(35, (index) => 6 + (index % 3)),
      chain_depth: buildSamples(35, (index) => 2 + (index % 2)),
    }),
    markovSeedSequence: ['list_dir', 'transfer', 'read_file'],
    frequencySeeds: { transfer: 6, read_file: 8, list_dir: 3 },
    effectiveFrom: V0_BASELINE_EFFECTIVE_FROM,
    effectiveTo: V0_BASELINE_EFFECTIVE_TO,
  },
  {
    id: 'V0_L1_BASELINE_004',
    name: 'Tool Chain Abuse Profile',
    description: 'Deep chain depth baseline for sensitive tool sequences',
    dimensions: buildDimensions({
      chain_depth: buildSamples(35, (index) => 3 + (index % 4)),
      tool_frequency: buildSamples(35, (index) => 10 + (index % 6)),
    }),
    markovSeedSequence: ['execute_shell', 'run_script', 'delete_file'],
    frequencySeeds: { execute_shell: 4, run_script: 3, delete_file: 2 },
    effectiveFrom: V0_BASELINE_EFFECTIVE_FROM,
    effectiveTo: V0_BASELINE_EFFECTIVE_TO,
  },
  {
    id: 'V0_L1_BASELINE_005',
    name: 'Permission Probing Profile',
    description: 'Consecutive failure metadata baseline for auth probe detection',
    dimensions: buildDimensions({
      metadata_consecutive_failures: buildSamples(35, (index) => index % 3),
      error_rate: buildSamples(35, (index) => (index % 5) * 0.02),
    }),
    markovSeedSequence: ['read_file', 'write_file', 'list_dir'],
    frequencySeeds: { read_file: 14, write_file: 5 },
    effectiveFrom: V0_BASELINE_EFFECTIVE_FROM,
    effectiveTo: V0_BASELINE_EFFECTIVE_TO,
  },
  {
    id: 'V0_L1_BASELINE_006',
    name: 'Frequency Anomaly Burst Profile',
    description: 'High 1m metadata frequency baseline for burst detection',
    dimensions: buildDimensions({
      metadata_frequency_1m: buildSamples(35, (index) => 12 + (index % 8)),
      metadata_frequency_5m: buildSamples(35, (index) => 10 + (index % 6)),
      tool_frequency: buildSamples(35, (index) => 15 + (index % 10)),
    }),
    markovSeedSequence: ['read_file', 'read_file', 'read_file', 'write_file'],
    frequencySeeds: { read_file: 20, write_file: 4 },
    effectiveFrom: V0_BASELINE_EFFECTIVE_FROM,
    effectiveTo: V0_BASELINE_EFFECTIVE_TO,
  },
  {
    id: 'V0_L1_BASELINE_007',
    name: 'Prompt Injection Delimiter Profile',
    description: 'Longer argument payloads for delimiter injection baselines',
    dimensions: buildDimensions({
      arg_count: buildSamples(35, (index) => 3 + (index % 4)),
      latency: buildSamples(35, (index) => 55 + (index % 15)),
    }),
    markovSeedSequence: ['read_file', 'write_file', 'list_dir', 'write_file'],
    frequencySeeds: { read_file: 9, write_file: 7, list_dir: 5 },
    effectiveFrom: V0_BASELINE_EFFECTIVE_FROM,
    effectiveTo: V0_BASELINE_EFFECTIVE_TO,
  },
  {
    id: 'V0_L1_BASELINE_008',
    name: 'Supply Chain Source Profile',
    description: 'Mixed tool source invocation baseline for supply-chain checks',
    dimensions: buildDimensions({
      tool_frequency: buildSamples(35, (index) => 5 + (index % 7)),
      user_repeat: buildSamples(35, (index) => 2 + (index % 3)),
    }),
    markovSeedSequence: ['read_file', 'write_file', 'transfer', 'list_dir'],
    frequencySeeds: { read_file: 11, write_file: 9, transfer: 3, list_dir: 6 },
    effectiveFrom: V0_BASELINE_EFFECTIVE_FROM,
    effectiveTo: V0_BASELINE_EFFECTIVE_TO,
  },
];
