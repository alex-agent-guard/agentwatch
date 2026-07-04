# AgentWatch 性能基准测试报告

> 生成时间：2026-07-03T22:57:42.904Z
> 命令：`npm run bench --prefix packages/local` 或 `vitest bench tests/bench/latency.bench.ts`

**总体验收：** PASS

## 核心路径指标（用户感知延迟）

| 指标 | 目标 | 实测 | 结论 | 说明 |
|------|------|------|------|------|
| L0 规则匹配（1000 规则 × 10000 事件） P99 | <10ms | ~0.433ms | ✅ PASS |  |
| L1 统计检测（Z-score + Markov + 频次） P99 | <50ms | ~0.481ms | ✅ PASS |  |
| Proxy 转发 — 核心同步路径 MEAN | <0.1ms | ~0.060ms | ✅ PASS | JSON 序列化 + clientIn.write |
| Baseline update — 纯内存路径 MEAN | <0.1ms | ~0.004ms | ✅ PASS | recordObservation 纯内存 |
| 完整端到端链路（L0+L1+决策+脱敏+HMAC） P99 | <50ms | ~0.761ms | ✅ PASS |  |

## I/O 异步开销（非核心路径）

| 指标 | 目标 | 实测 | 结论 | 说明 |
|------|------|------|------|------|
| Proxy 转发 — stdio 管道 I/O MEAN | <10ms | ~0.012ms | ⚠️ REVIEW | 周期性 I/O，非检测核心路径 |
| Baseline persist — SQLite I/O MEAN | <10ms | ~0.222ms | ⚠️ REVIEW | 周期性 I/O，非检测核心路径 |

### 性能说明

核心路径指标反映 L0/L1/决策/Proxy 同步处理与纯内存基线更新，代表用户实际感知延迟。
I/O 开销指标包含 stdio 管道往返与 SQLite 落盘，为周期性异步操作，不计入检测链路 P99 预算。
Proxy / Baseline 原合并 MEAN 已拆分为「核心 + I/O」两行，避免 I/O 掩盖同步计算耗时。

## 明细

### L0 规则匹配（1000 规则 × 10000 事件）

- 路径：核心同步路径
- 描述：RuleEngine.match() — 1000 条合成规则，循环匹配事件
- 样本数：10966
- mean：0.155 ms
- P99：0.433 ms
- min / max：0.052 / 1.828 ms
- 验收：P99 0.433 ms < 10 ms — ✅ PASS

### L1 统计检测（Z-score + Markov + 频次）

- 路径：核心同步路径
- 描述：StatEngine.processEvent() — Z-score 方差、Markov 链、行为频次
- 样本数：2610
- mean：0.166 ms
- P99：0.481 ms
- min / max：0.055 / 4.703 ms
- 验收：P99 0.481 ms < 50 ms — ✅ PASS

### Proxy 转发 — 核心同步路径

- 路径：核心同步路径
- 描述：JSON 序列化 + clientIn.write — 不含 stdio 管道往返
- 样本数：1820
- mean：0.060 ms
- P99：0.207 ms
- min / max：0.042 / 0.951 ms
- 验收：MEAN 0.060 ms < 0.1 ms — ✅ PASS

### Proxy 转发 — stdio 管道 I/O

- 路径：I/O 异步开销
- 描述：下游 stdin 收到数据的管道往返延迟
- 样本数：1820
- mean：0.012 ms
- P99：0.042 ms
- min / max：0.008 / 0.475 ms
- 验收：MEAN 0.012 ms < 10 ms — ⚠️ REVIEW（I/O 开销，非核心路径）

### Baseline update — 纯内存路径

- 路径：核心同步路径
- 描述：recordObservation — Welford/频次/时段内存更新
- 样本数：924
- mean：0.004 ms
- P99：0.095 ms
- min / max：0.001 / 0.296 ms
- 验收：MEAN 0.004 ms < 0.1 ms — ✅ PASS

### Baseline persist — SQLite I/O

- 路径：I/O 异步开销
- 描述：BaselineStorage.save() — better-sqlite3 同步落盘
- 样本数：924
- mean：0.222 ms
- P99：0.436 ms
- min / max：0.169 / 1.201 ms
- 验收：MEAN 0.222 ms < 10 ms — ⚠️ REVIEW（I/O 开销，非核心路径）

### 完整端到端链路（L0+L1+决策+脱敏+HMAC）

- 路径：核心同步路径
- 描述：processEvent + match + detect + DataMasker + HmacChainSigner
- 样本数：1000
- mean：0.395 ms
- P99：0.761 ms
- min / max：0.324 / 2.272 ms
- 验收：P99 0.761 ms < 50 ms — ✅ PASS

