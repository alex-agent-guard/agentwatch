# AgentWatch V0 运维故障排查手册

> 适用版本：V0.1.0 (Week1)  
> 运行环境：Node.js >= 18，本地 stdio MCP 代理

---

## 1. FIFO 双流网关

### 1.1 架构说明

外部工具可通过命名管道 `~/.agentwatch/gateway.in.fifo` 向 AgentWatch 注入 JSON-RPC 行，与 stdin 并行进入 `GatewayClientInput`（产品架构 §5.1）。常量见 `packages/shared/constants.ts`：`FIFO_HEARTBEAT_MS=250`、`FIFO_REOPEN_MS=10`。

### 1.2 常见症状

| 症状 | 可能原因 | 处理 |
|------|----------|------|
| FIFO 写入阻塞 | 读端未打开 / 进程已退出 | 确认 `agentwatch` 进程存活；见清理脚本 |
| 重复或丢失行 | writer 未加 `\n` 行分隔 | 每条 JSON-RPC 必须以 `\n` 结尾 |
| `parse_discard` 日志激增 | JSON 语法错误 | 检查 gateway 输出；启用 JSON 修复层已覆盖常见笔误 |
| `fifo_error` 循环 | 管道文件被删或非 FIFO | 重新创建 FIFO（见下） |

### 1.3 FIFO 清理 / 重建脚本

```bash
#!/usr/bin/env bash
# agentwatch-fifo-reset.sh — 安全重建 gateway FIFO
set -euo pipefail

PIPE="${HOME}/.agentwatch/gateway.in.fifo"
DIR="${HOME}/.agentwatch"

mkdir -p "$DIR"

# 停止占用进程（按需调整 PID）
if pgrep -f "bootstrap.ts" >/dev/null 2>&1; then
  echo "Stopping AgentWatch bootstrap..."
  pkill -f "bootstrap.ts" || true
  sleep 1
fi

if [ -p "$PIPE" ]; then
  echo "Removing stale FIFO: $PIPE"
  rm -f "$PIPE"
elif [ -e "$PIPE" ]; then
  echo "ERROR: $PIPE exists but is not a FIFO — manual review required"
  exit 1
fi

mkfifo "$PIPE"
chmod 600 "$PIPE"
echo "FIFO ready: $PIPE"
```

### 1.4 埋点阶段对照

bootstrap 输出 `[AgentWatch][bootstrap][pipe] stage=...`：

| stage | 含义 |
|-------|------|
| `fifo_open_wait` | 等待 writer 打开管道 |
| `fifo_open_ready` | 读端就绪 |
| `fifo_eof` | writer 关闭，将按 FIFO_REOPEN_MS 重开 |
| `enqueue_line` | 行进入 GatewayClientInput |
| `parse_discard` | JSON 修复后仍无法解析 |
| `toolcall_line` | 规范化后的 tools/call 行 |

---

## 2. 结构化错误码（RiskType）

所有模块异常携带 `riskType`（见 `RiskType` 常量）。排查时搜索日志中的字段：

### 2.1 MCP Proxy

| riskType | 说明 | 建议 |
|----------|------|------|
| `CHILD_CRASH` | 子 MCP Server 退出 | 检查 server 命令、依赖、stderr |
| `TOOL_CALL_DETECTION_TIMEOUT` | 检测超过 50ms 预算 | 减少规则集 / 检查 L1 会话 Map 膨胀 |
| `CLIENT_JSON_PARSE_ERROR` | 客户端非 JSON 行 | 正常 passthrough；若大量出现检查 Agent 输出 |
| `SESSION_ALREADY_ACTIVE` | 重复 `start()` | 确保单例 gateway |

### 2.2 L0 Rule Engine

| riskType | 说明 | 建议 |
|----------|------|------|
| `RULE_ENGINE_MATCH_TIMEOUT` | match > 10ms | 检查 REGEX 规则数量、ReDoS 模式 |
| `RULE_ENGINE_FIELD_VALUE_ERROR` | getFieldValue 路径异常 | 核对 FieldSource 与 DetectionEvent 结构 |

### 2.3 L1 Stat Engine

| riskType | 说明 | 建议 |
|----------|------|------|
| `STAT_ENGINE_PROCESS_TIMEOUT` | processEvent > 10ms | 检查 `MAX_SESSION_TRACKERS` 淘汰是否正常 |
| `STAT_ENGINE_BUILTIN_BASELINE_FAILED` | 内置基线加载失败 | 检查 `baseline.ts` 数据完整性 |

### 2.4 Async Logger

| riskType | 说明 | 建议 |
|----------|------|------|
| `ASYNC_LOGGER_QUEUE_OVERFLOW` | 队列 >= maxQueueSize 且刷盘失败 | 降低写入频率；检查磁盘权限 |
| `ASYNC_LOGGER_WRITE_TIMEOUT` | 同步写入 > 10ms | 检查磁盘 IO；考虑调大 flush 间隔 |

### 2.5 Config Manager

| riskType | 说明 | 建议 |
|----------|------|------|
| `CONFIG_YAML_PARSE_FAILED` | YAML 语法错误 | 修复 `~/.agentwatch/config.yaml` |
| `CONFIG_VALIDATION_FAILED` | Schema 校验失败 | 对照 README 默认模板字段 |

---

## 3. 性能预算超标

各模块 `[perf]` 日志格式：`[Module][perf] op=... durationMs=... budgetMs=... withinBudget=...`

| 模块 | 预算常量 | 默认值 |
|------|----------|--------|
| RuleEngine.match | `DEFAULT_MAX_MATCH_TIME_MS` | 10ms |
| StatEngine.processEvent | `DEFAULT_MAX_PROCESS_TIME_MS` | 10ms |
| DecisionRouter.detect | `DEFAULT_DECISION_BUDGET_MS` | 1ms |
| MCPProxyCore 端到端 | `DEFAULT_MAX_DETECTION_LATENCY_MS` | 50ms |
| AsyncLogger 同步写 | `DEFAULT_WRITE_BUDGET_MS` | 10ms |

**排查步骤**：

1. 运行 `npm run test` 确认基准测试通过  
2. 检查 `[perf] withinBudget=false` 的 `op` 字段定位阶段  
3. L1 会话过多时清理：重启进程（V0 无 SQLite 持久化）  
4. Markov 内存：单进程 `sessionFrequencies` 超过 `MAX_SESSION_TRACKERS`(512) 会自动 LRU 淘汰最早 session  

---

## 4. 日志目录问题

默认根目录：`./logs/YYYY-MM-DD/{block,warn,allow,raw}.jsonl`

| 问题 | 处理 |
|------|------|
| 目录不可写 | `chmod u+w logs` 或配置 `logging.output` |
| BLOCK 无落盘 | 确认 decision=BLOCK 且 logger 未 shutdown |
| 敏感字段泄露 | 设置 `logging.mask.enabled: true`, `level: 2+` |

---

## 5. 快速诊断命令

```bash
# 类型 + 全量测试
npm run typecheck && npm run test

# 仅网关集成
cd packages/local && npm run test -- tests/integration/bootstrap/gateway.test.ts

# 查看 FIFO 管道状态
ls -l ~/.agentwatch/gateway.in.fifo

# 跟踪 bootstrap 管道埋点
npm start -- node -e "console.log('ok')" 2>&1 | rg '\[pipe\]'
```

---

## 6. 升级 / 回滚

见 [npm_publish_guide.md](./npm_publish_guide.md) 第 4 节。

---

*Last updated: Week1 Day7 — 与源码 `packages/shared/constants.ts` 及 bootstrap FIFO 扩展对齐。*
