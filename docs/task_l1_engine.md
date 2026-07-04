# L1 Statistical Engine 工程任务清单与分析报告

> **分析范围**: 架构文档 §4.4 L1 统计引擎 (L1632-L2263)
> **分析日期**: 2025-07-01
> **文档版本**: v1.0-final

---

## 1. L1 Statistical Engine 工程任务清单 (V0 MVP 范围)

### 1.1 算法/组件任务清单

| 任务ID | 任务名称 | 优先级 | 输入接口 | 输出接口 | 依赖模块 | 代码状态 | 测试验收标准 |
|--------|----------|--------|----------|----------|----------|----------|--------------|
| L1-001 | `WelfordStats` - 在线均值方差计算 | P0 | `update(value: number): void` | `getMean(): number`, `getVariance(): number`, `getStdDev(): number`, `zScore(value: number): number`, `anomalyScore(value: number): number` | 无 | `可直接用` | ① 均值计算精度: 单点更新后 mean == value; ② 方差: 单点 variance == 0; ③ Z-score: 同值输入 zScore == 0; ④ std == 0 时 zScore 返回 0 不抛异常; ⑤ anomalyScore sigmoid 映射正确 (z=3 -> ~0.5, z=0 -> ~0.002); ⑥ 序列化/反序列化状态一致 |
| L1-002 | `ZScoreDetector` - 多维度 Z-score 检测器 | P0 | `updateBaseline(dimension: string, value: number): void`, `detect(dimensions: Record<string, number>): ZScoreResult` | `ZScoreResult` (含 combinedScore, maxZScore, maxDimension, dimensionScores, isAnomaly, confidence) | L1-001 (WelfordStats) | `可直接用` | ① 冷启动 (<30 样本): 返回 coldStartScore (score=0.1 或 0.8); ② 正常检测: zScore > 3 标记 isAnomaly; ③ combinedScore > 0.7 触发 isAnomaly; ④ maxZScore > 4 触发 isAnomaly; ⑤ 加权平均分计算正确; ⑥ 空维度输入返回 safe 结果 |
| L1-003 | `SlidingWindowFrequency` - 滑动窗口频率统计 | P0 | `record(toolName: string, timestamp?: number): void` | `getFrequency(toolName: string): number`, `getAllFrequencies(): Map<string, number>` | 无 | `需补全` | ① 新工具动态创建 bucket (Uint32Array); ② 同桶内多次 record 累加正确; ③ 桶索引跨越时 advanceBuckets 清零正确 (含环绕情况); ④ 获取频率 O(N_buckets) 求和正确; ⑤ 长静默后时间环绕处理; ⑥ 内存上限验证 (N_tools * N_buckets * 4 bytes) |
| L1-004 | `MultiGranularityFrequency` - 多粒度频率管理器 | P0 | `record(toolName: string, timestamp?: number): void` | `getFrequency(toolName: string, window: '1m' \| '5m' \| '1h' \| '1d'): number` | L1-003 (SlidingWindowFrequency) | `需补全` | ① 四窗口同时更新一致; ② 各窗口粒度频率统计独立正确; ③ 内存占用 ~40KB (4 * 10KB); ④ 缺少 `getAllFrequencies()` 批量查询需补充 |
| L1-005 | `MarkovChainDetector` - Markov 链序列检测 | P1 | `train(sequence: string[]): void`, `scoreSequence(sequence: string[]): MarkovResult`, `scoreTransition(prevTool: string, currentTool: string): number` | `MarkovResult` (含 logProbability, perplexity, unknownTransitions, unknownRatio, anomalyScore, isAnomaly) | 无 | `需补全` | ① 1-gram 训练计数正确; ② 2-gram 转移矩阵训练正确; ③ 3-gram 训练正确; ④ 未知工具 logProb = ln(0.01); ⑤ perplexity 计算正确 (exp(-logProb/N)); ⑥ anomalyScore > 0.7 触发 isAnomaly; ⑦ unknownRatio > 0.5 触发 isAnomaly; ⑧ Laplace smoothing 参数 alpha=0.1 生效 |
| L1-006 | `CUSUMDetector` - 累积和检测器 | **Deferred → V1** | `update(value: number): CUSUMResult`, `setBaseline(mean: number, std: number): void`, `reset(): void` | `CUSUMResult` (含 value, normalized, positiveSum, negativeSum, score, isAlarm, alarmCount) | 无 (V0 不使用) | `可直接用` | V1 启用时测试: ① 正偏移累积 sp 增加; ② 负偏移累积 sn 增加; ③ 阈值 h 触发 isAlarm; ④ score 归一化到 [0,1]; ⑤ reset 清零累积和; ⑥ alarmCount 正确计数 |
| L1-007 | `EWMADetector` - 指数加权移动平均检测器 | **Deferred → V1** | `update(value: number): EWMAResult` | `EWMAResult` (含 value, ewma, ucl, lcl, score, isAnomaly) | 无 (V0 不使用) | `可直接用` | V1 启用时测试: ① 首次初始化 z=value; ② EWMA 公式 z = lambda*x + (1-lambda)*z_prev; ③ 控制限 ucl/lcl 基于 varianceZ 计算; ④ 超出控制限标记 isAnomaly; ⑤ score = deviation / (l * stdZ) 上限 1.0 |

### 1.2 任务依赖关系图

```
L1-001 WelfordStats (P0, 可直接用)
  └── L1-002 ZScoreDetector (P0, 可直接用)

L1-003 SlidingWindowFrequency (P0, 需补全)
  └── L1-004 MultiGranularityFrequency (P0, 需补全)

L1-005 MarkovChainDetector (P1, 需补全) ── 独立

L1-006 CUSUMDetector (Deferred V1, 可直接用) ── 独立

L1-007 EWMADetector (Deferred V1, 可直接用) ── 独立
```

---

## 2. 各算法实现完成度评估

### 2.1 WelfordStats (L1677-L1731)

| 评估维度 | 评估结果 |
|----------|----------|
| **代码可直接使用百分比** | **100%** — 完整 TypeScript 实现，可直接复制使用 |
| **需要补充的边界情况** | ① `count === 0` 时 `getVariance()` 返回 0 (已有处理); ② 大规模数据数值稳定性 (Welford 算法天然免疫); ③ 反序列化时未验证输入字段类型; ④ 建议添加 `reset()` 方法清零状态 |
| **单元测试需覆盖场景** | ① 空状态 (count=0) 所有 getter; ② 单点更新后统计量; ③ 同值多次更新 (variance→0); ④ 异值更新后 mean/variance 正确; ⑤ std=0 时 zScore 返回 0; ⑥ sigmoid 映射关键值 (z=-3,0,3,6); ⑦ serialize/deserialize 状态一致性; ⑧ 1000+ 次更新数值稳定性 |

### 2.2 ZScoreDetector (L1739-L1825)

| 评估维度 | 评估结果 |
|----------|----------|
| **代码可直接使用百分比** | **95%** — 核心逻辑完整，少量增强建议 |
| **需要补充的边界情况** | ① `dimensionWeights` 未暴露 setter (仅内部 Map); ② `coldStartScore` 硬编码阈值 `value > 5` 为魔法数字，应参数化; ③ 缺少 `reset()` 方法; ④ `detect()` 中 `stat['count']` 用字符串索引访问 private 字段 (TypeScript strict 下可能报错，应改为 WelfordStats 公共 getter); ⑤ 冷启动评分缺乏权重参与加权平均计算 |
| **单元测试需覆盖场景** | ① 全新维度冷启动 (<30 样本); ② 恰好 30 样本的边界; ③ 多维度加权平均; ④ combinedScore > 0.7 触发 isAnomaly; ⑤ maxZScore > 4 触发 isAnomaly; ⑥ 单维度检测; ⑦ 空输入; ⑧ 权重不一致的维度组合 |

### 2.3 SlidingWindowFrequency (L2022-L2088)

| 评估维度 | 评估结果 |
|----------|----------|
| **代码可直接使用百分比** | **80%** — 核心桶逻辑完整，但缺少边界保护和序列化 |
| **需要补充的边界情况** | ① **缺少序列化/反序列化** — 重启后频率数据丢失; ② `advanceBuckets` 环绕处理中 `newIndex > currentIndex` 的情况可能跳过过多桶 (应计算实际跨度); ③ 时间大幅倒退 (时钟回拨) 未处理; ④ 无 `reset(toolName)` 单工具清零接口; ⑤ `getAllFrequencies()` 效率可优化为增量维护总和; ⑥ Uint32Array 溢出 (单桶计数 > 4.29B) 未处理 |
| **单元测试需覆盖场景** | ① 同桶内多次 record; ② 桶索引跨越 (advanceBuckets); ③ 环绕归零 (currentIndex 接近 numBuckets 时); ④ 新工具动态创建 bucket; ⑤ 不存在工具查询返回 0; ⑥ 高频调用 (1M+ records); ⑦ 长静默后首次 record 正确清零; ⑧ 多工具并发记录 |

### 2.4 MultiGranularityFrequency (L2096-L2115)

| 评估维度 | 评估结果 |
|----------|----------|
| **代码可直接使用百分比** | **70%** — 基础包装器，缺少关键功能 |
| **需要补充的边界情况** | ① **缺少 `getAllFrequencies()` 方法** — 需要遍历四窗口聚合; ② **缺少序列化/反序列化** — 重启后全部数据丢失; ③ 四个窗口独立 `record` 调用有 4x 函数调用开销，可考虑批量; ④ 无工具频率异常检测接口 (需结合阈值判断); ⑤ 无 `reset()` 或 `clear()` 接口 |
| **单元测试需覆盖场景** | ① 四窗口频率统计独立正确; ② 各粒度 (1m/5m/1h/1d) 衰减正确; ③ 内存占用验证; ④ 高频 record (性能测试); ⑤ 边界: 恰好跨越桶边界 |

### 2.5 MarkovChainDetector (L2132-L2252)

| 评估维度 | 评估结果 |
|----------|----------|
| **代码可直接使用百分比** | **85%** — 训练和评分逻辑完整，但缺少序列化和增量训练 |
| **需要补充的边界情况** | ① **缺少序列化/反序列化** — 训练好的模型无法持久化; ② **缺少增量训练接口** — `train()` 只能全量训练，无法在线更新 (V0 可接受，V1 需增量); ③ `scoreSequence` 空序列返回 (已有处理); ④ `prevTotal` 每次用 `Array.from().reduce()` 计算效率低，应缓存; ⑤ 无 `forget()` 或模型老化机制; ⑥ smoothingAlpha 硬编码 0.1，应参数化; ⑦ 未提供 `getKnownTools()` 查询接口 |
| **单元测试需覆盖场景** | ① 空序列评分; ② 单元素序列 (仅 unigram); ③ 双元素序列 (bigram 回退); ④ 三元素序列 (trigram 正常); ⑤ 未知工具 (logProb = ln(0.01)); ⑥ 未见过转移 (count=0, smoothing 生效); ⑦ 高 perplexity 触发 anomaly; ⑧ unknownRatio > 0.5 触发 anomaly; ⑨ 多次 train 累加; ⑩ scoreTransition 边界 (未知 prevTool 返回 0.01) |

### 2.6 CUSUMDetector (L1860-L1925) — V1 启用

| 评估维度 | 评估结果 |
|----------|----------|
| **代码可直接使用百分比** | **100%** — 完整 TypeScript 实现，可直接复制使用 |
| **需要补充的边界情况** | ① `baselineStd <= 0` 时除以 0 防护 (已有 `std > 0 ? std : 1`); ② 连续 alarm 的抑制逻辑 (需外部控制); ③ 反序列化缺少 `lastAlarmTime` 字段恢复 |
| **单元测试需覆盖场景** | ① 正常值 (normalized < k) sp/sn 递减至 0; ② 正偏移检测 (sp 累积 > h); ③ 负偏移检测 (sn 累积 > h); ④ score 归一化上限 1.0; ⑤ alarmCount 累加; ⑥ reset 清零; ⑦ 基线 std = 0 防护; ⑧ 不同 k/h 参数组合 |

### 2.7 EWMADetector (L1951-L1999) — V1 启用

| 评估维度 | 评估结果 |
|----------|----------|
| **代码可直接使用百分比** | **100%** — 完整 TypeScript 实现，可直接复制使用 |
| **需要补充的边界情况** | ① `baselineStd = 0` 时 `varianceZ = 0` 导致 `stdZ = 0` 除零 (需防护); ② 缺少 `setBaseline()` 动态更新接口 (CUSUM 有但 EWMA 无); ③ 首次初始化返回 score=0 合理但可能被误判 |
| **单元测试需覆盖场景** | ① 首次初始化 z=value; ② 平稳序列 EWMA 收敛; ③ 趋势变化检测 (超出 ucl/lcl); ④ score 上限 1.0; ⑤ lambda 不同值响应速度; ⑥ baselineStd=0 边界; ⑦ 序列化状态恢复后检测一致 |

---

## 3. V0 简化版 vs 完整版差异

### 3.1 架构文档明确声明 (L6548-L6549)

> - L1 统计引擎使用简化版算法 **(无 CUSUM/EWMA)**
> - 基线系统为 **静态阈值 (无增量学习)**

### 3.2 V0 MVP 功能清单 (L6525-L6527)

| 算法/组件 | V0 优先级 | V0 状态 | V1 计划 | 决策 |
|-----------|-----------|---------|---------|------|
| Welford Z-score | P0 | **必须完成** | 增强 (增量学习) | ✅ V0 保留 |
| 滑动窗口频率统计 | P0 | **必须完成** | 增强 (多粒度) | ✅ V0 保留 |
| Markov 链 2-gram | P1 | 推荐完成 | 增强 (3-gram + 在线更新) | ✅ V0 保留 (P1) |
| CUSUM 累积和 | — | **Deferred** | V1 新增 (L6561) | ❌ V0 不实现 |
| EWMA 趋势检测 | — | **Deferred** | V1 新增 (L6562) | ❌ V0 不实现 |

### 3.3 V0 应保留的算法类

```
V0 L1 Statistical Engine (简化版)
├── WelfordStats           ← P0, 在线均值方差计算
├── ZScoreDetector         ← P0, 多维度 Z-score 检测
├── SlidingWindowFrequency ← P0, 滑动窗口频率统计
├── MultiGranularityFrequency ← P0, 多粒度频率管理
└── MarkovChainDetector    ← P1, Markov 链序列检测 (2-gram)
```

### 3.4 V0 可 Deferred 的算法类

```
V1 新增 (Deferred from V0)
├── CUSUMDetector          ← V1 新增 (渐进异常检测)
└── EWMADetector           ← V1 新增 (趋势变化检测)
```

### 3.5 V0 基线系统约束

| 约束项 | V0 行为 | V1+ 行为 |
|--------|---------|----------|
| 基线更新 | 静态阈值 (无增量学习) | 增量学习 + 遗忘因子 |
| 冷启动处理 | 硬编码保守估计 | 三级过渡策略 |
| 异常过滤 | 不更新基线 (无此逻辑) | 异常事件不污染基线 |
| 持久化 | 无 (内存状态) | SQLite 持久化 |

---

## 4. 关键 TypeScript 接口清单

### 4.1 类 (Class) 定义

| 行号 | 类名 | 说明 | 方法列表 |
|------|------|------|----------|
| L1677 | `WelfordStats` | Welford 在线均值方差 | `update`, `getMean`, `getVariance`, `getStdDev`, `zScore`, `anomalyScore`, `serialize`, `deserialize` |
| L1739 | `ZScoreDetector` | 多维度 Z-score 检测 | `updateBaseline`, `detect`, `coldStartScore`(private), `serialize` |
| L1860 | `CUSUMDetector` | CUSUM 累积和检测 (V1) | `setBaseline`, `update`, `reset`, `serialize` |
| L1951 | `EWMADetector` | EWMA 指数加权移动平均 (V1) | `update`, `serialize` |
| L2022 | `SlidingWindowFrequency` | 滑动窗口频率 | `record`, `getFrequency`, `getAllFrequencies`, `advanceBuckets`(private) |
| L2096 | `MultiGranularityFrequency` | 多粒度频率管理 | `record`, `getFrequency` |
| L2132 | `MarkovChainDetector` | Markov 链序列检测 | `train`, `scoreSequence`, `scoreTransition` |

### 4.2 接口 (Interface) 定义

| 行号 | 接口名 | 字段/说明 |
|------|--------|-----------|
| L1827 | `DimensionScore` | `value: number; mean: number; stdDev: number; zScore: number; anomalyScore: number; isAnomaly: boolean; note?: string` |
| L1837 | `ZScoreResult` | `combinedScore: number; maxZScore: number; maxDimension: string; dimensionScores: Record<string, DimensionScore>; isAnomaly: boolean; confidence: number` |
| L1927 | `CUSUMResult` | `value: number; normalized: number; positiveSum: number; negativeSum: number; score: number; isAlarm: boolean; alarmCount: number` |
| L2002 | `EWMAResult` | `value: number; ewma: number; ucl: number; lcl: number; score: number; isAnomaly: boolean` |
| L2255 | `MarkovResult` | `logProbability: number; perplexity: number; unknownTransitions?: number; unknownRatio?: number; anomalyScore: number; isAnomaly: boolean` |

### 4.3 构造函数选项接口 (内联定义)

| 所属类 | 选项接口 | 字段 |
|--------|----------|------|
| `CUSUMDetector` | `options` | `{ k?: number; h?: number; baselineMean?: number; baselineStd?: number }` |
| `EWMADetector` | `options` | `{ lambda?: number; l?: number; baselineMean?: number; baselineStd?: number }` |

---

## 5. 代码状态汇总

| 算法类 | 代码行数 | 状态 | 可直接使用 % | 需补充内容 |
|--------|----------|------|-------------|------------|
| WelfordStats | ~55 行 | `可直接用` | 100% | 可选: `reset()`, 反序列化字段校验 |
| ZScoreDetector | ~87 行 | `可直接用` | 95% | `dimensionWeights` setter; 魔法数字参数化; `stat['count']` 改 getter |
| CUSUMDetector | ~66 行 | `可直接用` (V1) | 100% | 反序列化补全 `lastAlarmTime` |
| EWMADetector | ~49 行 | `可直接用` (V1) | 100% | `setBaseline()` 接口; baselineStd=0 防护 |
| SlidingWindowFrequency | ~67 行 | `需补全` | 80% | serialize/deserialize; 时钟回拨处理; 单工具 reset |
| MultiGranularityFrequency | ~20 行 | `需补全` | 70% | serialize/deserialize; `getAllFrequencies()`; 批量查询 |
| MarkovChainDetector | ~121 行 | `需补全` | 85% | serialize/deserialize; 增量 train; prevTotal 缓存; 参数化 alpha |

---

## 6. 实施建议

### V0 实施顺序

1. **第一优先级 (P0)**: 实现 `WelfordStats` + `ZScoreDetector` — 核心统计基线
2. **第二优先级 (P0)**: 实现 `SlidingWindowFrequency` + `MultiGranularityFrequency` — 频率监控
3. **第三优先级 (P1)**: 实现 `MarkovChainDetector` — 序列异常检测 (工具链分析)

### 代码质量注意事项

1. `ZScoreDetector.detect()` 第 L1766 行使用 `stat['count']` 访问 private 字段，应改为通过 WelfordStats 的 getter 方法
2. `advanceBuckets()` 环绕逻辑需仔细测试边界条件
3. MarkovChainDetector 的 `scoreSequence()` 中 `Array.from().reduce()` 模式在热路径上应缓存
4. 所有算法类应统一添加 `serialize()` / `deserialize()` / `reset()` 接口 (V0 可 deferred serialize 到 V1)

---

## Week1 Day7 源码落地同步

| 组件 | 源码 | 扩展注释 |
|------|------|----------|
| StatEngine | `packages/local/src/stat/StatEngine.ts` | 类级 JSDoc + processEvent 预算 |
| MarkovChainDetector | 同文件内嵌类 | `appendSessionSequence` MAX_SEQUENCE_LENGTH；`evictSessionTrackersIfNeeded` LRU |
| 会话 Map 内存保护 | `MAX_SESSION_TRACKERS` / `MAX_PERSISTED_MEMORY_BYTES` | `constants.ts` |
| benchmark | `tests/unit/stat/engine.test.ts` | `L1 math benchmark — architecture doc numeric parity` |

### 十大场景 L1 覆盖缺口

| 场景 | L1 能力 | 缺口 |
|------|---------|------|
| 工具链滥用 / 意图劫持 | Markov 序列 | 无 GNN A2A (V2) |
| 频率异常 | 四窗口频率 | FREQ_001 L0 硬阈值并存 |
| 基线偏离 | Z-score 6 维 | 无增量学习 / SQLite |
| 耗时异常 | latency 维度 | 无 CUSUM/EWMA 生产启用 (V1) |
| A2A 风险 | — | **未实现** |
