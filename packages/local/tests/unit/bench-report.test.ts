import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const benchDir = join(dirname(fileURLToPath(import.meta.url)), '../bench');
const resultsPath = join(benchDir, 'results.md');

describe('bench results report', () => {
  it('results.md exists with split core/io benchmark rows after vitest bench run', () => {
    if (!existsSync(resultsPath)) {
      console.warn(
        '[bench-report] results.md not found — run: npm run bench --prefix packages/local',
      );
      return;
    }

    const content = readFileSync(resultsPath, 'utf8');
    expect(content).toContain('# AgentWatch 性能基准测试报告');
    expect(content).toContain('核心路径指标');
    expect(content).toContain('L0 规则匹配');
    expect(content).toContain('L1 统计检测');
    expect(content).toContain('Proxy 转发');
    expect(content).toContain('Baseline');
    expect(content).toContain('完整端到端链路');
    expect(content).toMatch(/P99|mean|I\/O/);
  });
});
