# E2E 全链路集成测试指南

> 测试文件：`packages/local/tests/e2e/full-pipeline.test.ts`  
> 运行环境：Node.js >= 18，Vitest，隔离临时 HOME（不污染真实 `~/.agentwatch`）

---

## 1. 模拟环境说明

| 项目 | 说明 |
|------|------|
| 数据库 | 每个用例 `mkdtempSync` 创建独立 HOME，`~/.agentwatch/agentwatch.db` 自动隔离 |
| 云端 API | `CloudClient` 注入 `fetchImpl` mock，不访问真实网络 |
| MCP 子进程 | `node:child_process.spawn` mock，PassThrough 模拟 stdio，避免真实 MCP 进程 |
| HMAC 密钥 | `HMACChainManager.initialize()` 在临时 HOME 下生成 `.hmac_key` |
| 日志路径 | 分级 JSONL：`{logRoot}/{YYYY-MM-DD}/{block\|warn\|...}.jsonl` |
| 清理 | `afterEach` 调用 `DatabaseManager.close()` + `HMACChainManager.reset()` |

---

## 2. 验收场景对照

### 场景 A — 完整全链路数据闭环

| 步骤 | 验证点 |
|------|--------|
| MCP `tools/call` 写入 Proxy stdin | 返回 JSON-RPC error code `-32000`，管道不崩溃 |
| L0 + L1 + baseline_deviation | `DecisionRouter.detect` 收到 `baseline_deviation` 场景 |
| 脱敏日志落盘 | `block.jsonl` 含 `_meta.hmac`，不含明文 `apiKey` |
| upload_queue 持久化 | SQLite `upload_queue` 行数 >= 1 |
| EventUploader 5s flush | mock fetch 被调用，上报成功后队列清空 |

### 场景 B — 断网重试恢复

| 步骤 | 验证点 |
|------|--------|
| 首次 flush 返回 503 | 队列保留事件 |
| 推进时间 + 再次 flush | 200 响应，队列 `getPendingCount() === 0` |

### 场景 C — 三级冷启动阈值

| 累计调用 | 期望 Tier | Z-score 策略 |
|----------|-----------|--------------|
| 0–9 | L1 | `>= 5`，`allowBaselineBlock=false` |
| 10–99 | L2 | `>= 3.5` |
| 100+ | L3 | `= 3`（base），`allowBaselineBlock=true` |
| 进程重启 | 接续 | `hydrateFromStorage()` 后 `totalCalls` 不重置 |

### 场景 D — HMAC 链式签名防篡改

| 步骤 | 验证点 |
|------|--------|
| 连续 100 条签名 | `HMACChain.verifyChain` → `{ valid: true }` |
| 篡改第 50 条 `dec` 字段 | `{ valid: false, tamperedIndex: 49 }` |

### 性能基准

| 基准 | 指标 |
|------|------|
| 1000 次连续 `handleToolCall` | 无 `database is locked`，堆增长 < 128MB |
| 100 条 BLOCK 日志批量上报 | 全流程（脱敏+签名+入库+HTTP）< 5s |

---

## 3. 运行命令

```bash
# 全量测试（含 E2E + 原有单元测试）
cd /Users/alex/Desktop/agent-watch-v0
npm test

# 仅 E2E 全链路
npm test --prefix packages/local -- tests/e2e/full-pipeline.test.ts

# 单场景
npm test --prefix packages/local -- tests/e2e/full-pipeline.test.ts -t "Scenario A"
npm test --prefix packages/local -- tests/e2e/full-pipeline.test.ts -t "Scenario B"
npm test --prefix packages/local -- tests/e2e/full-pipeline.test.ts -t "Scenario C"
npm test --prefix packages/local -- tests/e2e/full-pipeline.test.ts -t "Scenario D"
npm test --prefix packages/local -- tests/e2e/full-pipeline.test.ts -t "Performance"
```

---

## 4. 手工验证命令（真实环境）

在本地已安装 AgentWatch 后，可用以下命令交叉验证 E2E 模拟结论：

### SQLite 队列检查

```bash
sqlite3 ~/.agentwatch/agentwatch.db "SELECT COUNT(*) FROM upload_queue;"
sqlite3 ~/.agentwatch/agentwatch.db "SELECT id, retry_count, next_retry_at FROM upload_queue LIMIT 5;"
```

### CLI 状态与日志

```bash
agentwatch status
agentwatch logs --tail 10
```

期望：`logs --tail 10` 输出末尾 10 条 JSONL，每条含 `_meta.hmac` 字段。

### 基线冷启动 Tier

```bash
sqlite3 ~/.agentwatch/agentwatch.db \
  "SELECT json_extract(data,'$.totalCalls') FROM baselines LIMIT 1;"
```

对照 `ColdStartController`：`<10 → L1`，`<100 → L2`，`>=100 → L3`。

### HMAC 链校验（开发调试）

在 Node REPL 或脚本中加载 `HMACChain`，读取 `block.jsonl` 各行构造 `HmacChainSignedEntry[]` 后调用 `verifyChain()`。

---

## 5. 注意事项

1. E2E 测试**不修改** `rule/`、`stat/`、`detection/` 业务源码，仅新增测试用例。
2. 日志实际写入分级目录 `{output}/{date}/block.jsonl`，CLI `logs` 命令读取的 `~/.agentwatch/log.jsonl` 为兼容路径；E2E 直接读取 tier 文件验证 HMAC。
3. 性能基准在 CI 环境可能因 CPU 差异波动；本地 MacOS/Linux 下应稳定 < 5s / 120s 超时内完成。
