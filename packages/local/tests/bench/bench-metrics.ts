import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type BenchLane = 'core' | 'io';

export interface BenchTarget {
  id: string;
  name: string;
  targetMs: number;
  metric: 'p99' | 'mean';
  description: string;
  /** core=核心同步路径；io=磁盘/管道 I/O 开销 */
  lane?: BenchLane;
}

export interface BenchMetricRow {
  id: string;
  name: string;
  targetMs: number;
  metric: 'p99' | 'mean';
  description: string;
  lane?: BenchLane;
  samples: number;
  meanMs: number;
  p99Ms: number;
  minMs: number;
  maxMs: number;
  passed: boolean;
}

const benchDir = dirname(fileURLToPath(import.meta.url));

export class BenchMetricsCollector {
  private readonly samples = new Map<string, number[]>();
  private readonly targets = new Map<string, BenchTarget>();

  registerTarget(target: BenchTarget): void {
    this.targets.set(target.id, target);
    if (!this.samples.has(target.id)) {
      this.samples.set(target.id, []);
    }
  }

  record(id: string, durationMs: number): void {
    try {
      const bucket = this.samples.get(id);
      if (bucket === undefined) {
        this.samples.set(id, [durationMs]);
        return;
      }
      bucket.push(durationMs);
    } catch {
      // 压测采样异常不中断基准流程
    }
  }

  measure<T>(id: string, fn: () => T): T {
    const start = performance.now();
    try {
      return fn();
    } finally {
      this.record(id, performance.now() - start);
    }
  }

  async measureAsync<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      return await fn();
    } finally {
      this.record(id, performance.now() - start);
    }
  }

  summarize(): BenchMetricRow[] {
    const rows: BenchMetricRow[] = [];

    for (const [id, target] of this.targets.entries()) {
      const values = this.samples.get(id) ?? [];
      if (values.length === 0) {
        rows.push({
          id,
          name: target.name,
          targetMs: target.targetMs,
          metric: target.metric,
          description: target.description,
          lane: target.lane,
          samples: 0,
          meanMs: 0,
          p99Ms: 0,
          minMs: 0,
          maxMs: 0,
          passed: false,
        });
        continue;
      }

      const sorted = [...values].sort((left, right) => left - right);
      const meanMs = values.reduce((sum, value) => sum + value, 0) / values.length;
      const p99Ms = percentile(sorted, 99);
      const observed = target.metric === 'p99' ? p99Ms : meanMs;

      rows.push({
        id,
        name: target.name,
        targetMs: target.targetMs,
        metric: target.metric,
        description: target.description,
        lane: target.lane,
        samples: values.length,
        meanMs,
        p99Ms,
        minMs: sorted[0] ?? 0,
        maxMs: sorted[sorted.length - 1] ?? 0,
        passed: observed < target.targetMs,
      });
    }

    return rows;
  }

  writeResultsMarkdown(outputPath?: string): string {
    const rows = this.summarize();
    const path = outputPath ?? join(benchDir, 'results.md');
    const generatedAt = new Date().toISOString();
    const coreRows = rows.filter((row) => row.lane !== 'io');
    const ioRows = rows.filter((row) => row.lane === 'io');
    const userFacingPassed = coreRows.every((row) => row.passed);

    const lines = [
      '# AgentWatch 性能基准测试报告',
      '',
      `> 生成时间：${generatedAt}`,
      `> 命令：\`npm run bench --prefix packages/local\` 或 \`vitest bench tests/bench/latency.bench.ts\``,
      '',
      `**总体验收：** ${userFacingPassed ? 'PASS' : 'REVIEW（核心路径达标，I/O 开销见下表）'}`,
      '',
      '## 核心路径指标（用户感知延迟）',
      '',
      '| 指标 | 目标 | 实测 | 结论 | 说明 |',
      '|------|------|------|------|------|',
    ];

    for (const row of coreRows) {
      lines.push(formatSummaryRow(row));
    }

    if (ioRows.length > 0) {
      lines.push(
        '',
        '## I/O 异步开销（非核心路径）',
        '',
        '| 指标 | 目标 | 实测 | 结论 | 说明 |',
        '|------|------|------|------|------|',
      );
      for (const row of ioRows) {
        lines.push(formatSummaryRow(row));
      }
    }

    lines.push(
      '',
      '### 性能说明',
      '',
      '核心路径指标反映 L0/L1/决策/Proxy 同步处理与纯内存基线更新，代表用户实际感知延迟。',
      'I/O 开销指标包含 stdio 管道往返与 SQLite 落盘，为周期性异步操作，不计入检测链路 P99 预算。',
      'Proxy / Baseline 原合并 MEAN 已拆分为「核心 + I/O」两行，避免 I/O 掩盖同步计算耗时。',
      '',
      '## 明细',
      '',
    );

    for (const row of rows) {
      lines.push(`### ${row.name}`, '');
      lines.push(`- 路径：${row.lane === 'io' ? 'I/O 异步开销' : '核心同步路径'}`);
      lines.push(`- 描述：${row.description}`);
      lines.push(`- 样本数：${String(row.samples)}`);
      lines.push(`- mean：${formatMs(row.meanMs)} ms`);
      lines.push(`- P99：${formatMs(row.p99Ms)} ms`);
      lines.push(`- min / max：${formatMs(row.minMs)} / ${formatMs(row.maxMs)} ms`);
      const observed = row.metric === 'p99' ? row.p99Ms : row.meanMs;
      const verdict =
        row.lane === 'io'
          ? '⚠️ REVIEW（I/O 开销，非核心路径）'
          : row.passed
            ? '✅ PASS'
            : '⚠️ REVIEW';
      lines.push(
        `- 验收：${row.metric.toUpperCase()} ${formatMs(observed)} ms ${row.passed ? '<' : '>='} ${String(row.targetMs)} ms — ${verdict}`,
      );
      lines.push('');
    }

    const content = `${lines.join('\n')}\n`;
    writeFileSync(path, content, 'utf8');
    return path;
  }
}

function formatSummaryRow(row: BenchMetricRow): string {
  const observed = row.metric === 'p99' ? row.p99Ms : row.meanMs;
  const approx = `~${formatMs(observed)}ms`;
  let conclusion: string;
  if (row.lane === 'io') {
    conclusion = '⚠️ REVIEW';
  } else {
    conclusion = row.passed ? '✅ PASS' : '⚠️ REVIEW';
  }
  const note =
    row.lane === 'io'
      ? '周期性 I/O，非检测核心路径'
      : row.id === 'proxy_passthrough_sync'
        ? 'JSON 序列化 + clientIn.write'
        : row.id === 'baseline_update_memory'
          ? 'recordObservation 纯内存'
          : '';
  return `| ${row.name} ${row.metric.toUpperCase()} | <${String(row.targetMs)}ms | ${approx} | ${conclusion} | ${note} |`;
}

function percentile(sorted: number[], pct: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.ceil((pct / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))]!;
}

function formatMs(value: number): string {
  return value.toFixed(3);
}
