# AgentWatch — MCP 安全中间件

> **定位**：部署在 AI Agent 与 MCP Server 之间的本地安全网关。拦截每一次 `tools/call`，在 **<50ms** 内完成 L0 规则 + L1 统计检测，输出 ALLOW / WARN / BLOCK 决策，并写入防篡改审计日志。

**包名**：`@agentwatch/mcp-proxy` · **版本**：`0.1.0` · **Node.js** >= 18

---

## 1. 项目简介

AgentWatch 为 AI Agent 提供**可离线运行**的工具调用安全层，核心能力：

| 能力 | 说明 |
|------|------|
| **参数脱敏** | 4 级可配置脱敏（FULL / HASH / TYPE / DROP），敏感密钥/金额不明文落盘 |
| **防篡改日志** | HMAC 链式签名（`~/.agentwatch/.hmac_key`），支持 `verifyChain` 篡改检测 |
| **基线异常拦截** | Welford 统计 + 冷启动 L1/L2/L3 + 独立基线偏离场景（权重 0.03） |
| **A2A 委托风控** | 识别 delegate/authorize/a2a 工具；未知 Agent WARN、大额跨代理 BLOCK |
| **SQLite 离线持久化** | 基线 / 上报队列 / HMAC 链 / 权限试探 — 重启不丢数据 |
| **云端批量上报** | BLOCK/WARN 事件 5s 批量 HTTP 上报，断网 SQLite 队列重试 |

---

## 2. 核心功能清单（按架构分层）

### 基础设施层
- SQLite 四表：`baselines` · `upload_queue` · `hmac_chain` · `perm_probe_tracker`
- 文件权限：`agentwatch.db` 与 `.hmac_key` 均为 `0o600`
- `DataMasker` 四级脱敏，由 `logging.mask` 配置驱动

### 数据流转层
- `MCPProxyCore` stdio JSON-RPC 双向代理
- 单文件审计日志 `~/.agentwatch/log.jsonl`（含 `tier` 字段）
- `CloudClient` + `EventUploader`：5s flush、断网持久化、ALLOW 过滤

### 风险检测层
- **L0**：Trie + Aho-Corasick，8 条内置规则，P99 < 10ms
- **L1**：Z-score + 多窗口频率 + Markov 2-gram，P99 < 50ms
- **A2ARiskDetector**：可选，`detection.a2aRisk: true` 启用
- **BaselineDeviationDetector**：频次 / 参数 / 时段三维偏离
- **DecisionRouter**：加权融合（rule 0.6 + stat 0.4）→ ALLOW / WARN / BLOCK

### CLI 交互层
- `init` — 扫描 MCP 配置、备份、注入代理、生成 `config.yaml`
- `status` — 全链路彩色自检（MCP / SQLite / 冷启动 / 云端 / 风险统计）
- `logs` — tail / level / since / follow 查询 `log.jsonl`
- `proxy` — 启动检测网关，支持 `--config` 与 `--` 下游命令
- `audit verify` — 验证 HMAC 审计链（人类可读 / `--json` Agent 解析）

### 测试与性能层
- **289** 单元/集成测试 + **4** 套 E2E 闭环场景
- **5+2** 项性能基准（核心路径 + I/O 拆分）
- `npm run pack:verify` 打包安装冒烟

---

## 3. 快速安装

### 方式 A：本地 npm pack（推荐演示）

```bash
git clone <repo-url> agent-watch-v0 && cd agent-watch-v0
npm install
npm run build
npm pack
# 输出：agentwatch-mcp-proxy-0.1.0.tgz

mkdir /tmp/aw-demo && cd /tmp/aw-demo
npm init -y
npm install /path/to/agentwatch-mcp-proxy-0.1.0.tgz

npx agentwatch --help
```

### 方式 B：全局安装（发布后）

```bash
npm install -g @agentwatch/mcp-proxy
agentwatch --help
```

### 方式 C：源码开发

```bash
npm install
npm run build
npm link   # 可选：全局链接 agentwatch 命令
```

**better-sqlite3 编译问题**：

```bash
npm rebuild better-sqlite3 --build-from-source
```

---

## 4. CLI 全命令示例

### 初始化（扫描 MCP + 生成配置）

```bash
agentwatch init
# → ~/.agentwatch/config.yaml
# → 备份并注入 ~/.cursor/mcp.json 等
```

### 状态自检

```bash
agentwatch status
# ✅ MCP 代理注入 / SQLite 表 / 冷启动等级 / 云端连通 / 近 1h 风险
```

### 启动代理（下游 MCP）

```bash
# 标准：-- 之后为下游 MCP 命令
agentwatch proxy -- npx -y @okx_ai/okx-trade-mcp

# 自定义配置
agentwatch proxy --config ~/.agentwatch/config.yaml -- npx -y @okx_ai/okx-trade-mcp

# init 注入格式（无 proxy 子命令）也支持
npx @agentwatch/mcp-proxy --config ~/.agentwatch/config.yaml -- npx -y @okx_ai/okx-trade-mcp
```

### 验证 HMAC 审计链（A2A 验收）

```bash
agentwatch audit verify
# ✅ Chain verified: 127 entries intact
# First: 2026-07-04T10:00:00.000Z
# Last:  2026-07-04T11:30:00.000Z

agentwatch audit verify --json
# {"valid":true,"count":127,"tamperedIndex":null}
# exit code: 0=通过, 1=篡改/错误, 2=参数错误
```

### 查看安全日志

```bash
agentwatch logs --tail 10
agentwatch logs --tail 10 --level WARN
agentwatch logs --since 1h
agentwatch logs --follow
agentwatch logs --tail 10 --since "2026-07-01"
```

---

## 5. 标准配置文件

路径：**`~/.agentwatch/config.yaml`**（`agentwatch init` 自动生成）

```yaml
# AgentWatch V0 — 完整样例
agentId: "aw-agent-xxxxxxxx"
userId: "aw-user-xxxxxxxx"

server:
  command: npx
  args: ["-y", "@okx_ai/okx-trade-mcp"]
  env:
    OKX_API_KEY: ${OKX_API_KEY}
    OKX_SECRET_KEY: ${OKX_SECRET_KEY}
    OKX_PASSPHRASE: ${OKX_PASSPHRASE}
    OKX_PROJECT_ID: ${OKX_PROJECT_ID}   # optional

performance:
  maxDetectionLatencyMs: 50

connection:
  timeoutMs: 30000
  autoRestart: true
  maxRestarts: 3

agentWatch:
  performance:
    maxDetectionLatencyMs: 50

  detection:
    enabled: true
    a2aRisk: false                    # true 启用 A2A 委托风控
    baselineDeviation: true           # 基线偏离独立场景
    ruleEngine:
      enabled: true
      rulesPath: ~/.agentwatch/rules/builtin.yaml
      maxMatchTimeMs: 10
    statisticalEngine:
      enabled: true
      zScoreThreshold: 3
      coldStartMinSamples: 30
      combinedScoreThreshold: 0.7
    decisionRouter:
      blockThreshold: 0.8
      warnThreshold: 0.5
      ruleWeight: 0.6
      statWeight: 0.4

  logging:
    level: info
    format: json
    output: ~/.agentwatch/log.jsonl
    mask:
      enabled: true
      level: 1                        # 0=FULL 1=HASH 2=TYPE 3=DROP
      sensitiveFields:
        - apiKey
        - secret
        - privateKey
        - password
        - mnemonic

  cloud:
    enabled: true                     # 默认开启脱敏上报；无 API Key 时自动降级
    endpoint: https://api.agentwatch.io/v1
    apiKey: ${AGENTWATCH_API_KEY}
    batch:
      batchSize: 100
      flushIntervalMs: 5000
      maxRetries: 5

  scenarios:
    baselineDeviation:
      monthlyDecay: false             # false=日级衰减 / true=月级衰减
```

---

## 6. 全链路业务复现演示

```bash
# 1. 构建并初始化
npm run build
npx agentwatch init

# 2. 检查状态
npx agentwatch status

# 3. 启动代理（另开终端）
export AGENTWATCH_API_KEY=your-key-or-placeholder
npx agentwatch proxy -- npx -y @okx_ai/okx-trade-mcp

# 4. 触发一次 tools/call（经 MCP 客户端或 echo 模拟）
# 代理 stdout 应出现 [AgentWatch][proxy] gateway_ready

# 5. 查看审计日志
npx agentwatch logs --tail 5

# 6. 验证 HMAC 审计链（A2A 验收标准）
npx agentwatch audit verify

# 7. 验证 SQLite
sqlite3 ~/.agentwatch/agentwatch.db ".tables"
# baselines  hmac_chain  perm_probe_tracker  upload_queue

# 7. 验证 HMAC 密钥权限
ls -la ~/.agentwatch/.hmac_key   # 权限应为 -rw-------
```

---

## OKX.AI A2A Registration

> **Node.js ≥ 18 required** · Cross-platform (Windows / Linux / macOS) · stdio MCP compatible with OnchainOS, Claude Desktop, Cursor, OpenClaw, Hermes

### Listing fields (copy-paste ready)

**Name (EN)** — `AgentWatch MCP Security Proxy` (29 chars)

**Description (EN, ~280 chars)**

Install a safety belt for your AI Agent — real-time anomaly interception, tamper-proof HMAC audit logs, and intelligent behavior baseline detection. Works with all OKX MCP services. Local-first privacy. One-click CLI setup. Complements CertiK: CertiK checks token risk; AgentWatch secures agent operations.

**Description (ZH, ~120 chars)**

为 AI Agent 安装「安全带」：实时拦截异常操作、不可篡改 HMAC 审计日志、智能行为基线检测。安装后自动接入 AgentWatch 安全网络，匿名行为数据持续优化全球风控模型。兼容 OKX MCP 生态，本地优先，CLI 一键安装。

**Services (Auto Ranger format)**

① **What you get / 给你**
- MCP security proxy with L0 rules + L1 stats → BLOCK/WARN/ALLOW
- Tamper-proof HMAC audit chain + `agentwatch audit verify`
- Behavior baseline from historical tool calls (demo: 10–20 calls)
- 安装后自动接入 AgentWatch 安全网络，匿名行为数据持续优化全球风控模型

② **What you need / 你需要**
- Node.js ≥ 18
- OKX MCP credentials: `OKX_API_KEY`, `OKX_SECRET_KEY`, `OKX_PASSPHRASE` (optional: `OKX_PROJECT_ID`)
- Authorize your Agent to run `agentwatch init` and proxy setup

**Default price:** 5 USDT (one-time, configurable on OKX A2A)

### Buyer acceptance (X Layer release criteria)

```bash
agentwatch init
agentwatch status
# Agent drives MCP calls via OnchainOS / OpenClaw / Hermes (stdio)
agentwatch audit verify          # human: ✅ Chain verified
agentwatch audit verify --json   # agent: {"valid":true,"count":N,"tamperedIndex":null}
echo $?                          # must be 0
```

---

## Data Privacy & Cloud Upload

AgentWatch uploads anonymized security data to the cloud by default.

- **What we upload:** tool names, call frequency, risk alerts, fuzzy timestamps
- **What we NEVER upload:** API keys, wallet addresses, prompts, personal data
- **Privacy:** Local DataMasker → TLS 1.3 → AES-256 (at rest on server) → 90-day TTL
- **Disable:** set `cloud.enabled: false` in `~/.agentwatch/config.yaml`
- **No API key:** 首次使用无需 apiKey，本地审计完全可用 — if `AGENTWATCH_API_KEY` is missing, upload is skipped with a one-time warning; local audit still works

Endpoint placeholder: `https://api.agentwatch.io/v1` (replace when OKX official URL is available). A2A acceptance does **not** depend on cloud connectivity — local HMAC verify is the release gate.

---

## 7. 测试与性能基准

### 运行测试

```bash
npm test
# 期望：289 passed / 2 skipped
```

### E2E 全链路

```bash
npm test --prefix packages/local -- tests/e2e/full-pipeline.test.ts
```

场景：A 全流程闭环 · B 断网恢复 · C 冷启动分级 · D HMAC 篡改检测

### 性能基准

```bash
npm run bench --prefix packages/local
cat packages/local/tests/bench/results.md
```

| 指标 | 目标 | 实测（参考） | 结论 |
|------|------|-------------|------|
| L0 规则匹配 P99 | <10ms | ~0.43ms | ✅ |
| L1 统计检测 P99 | <50ms | ~0.48ms | ✅ |
| 完整 E2E 链路 P99 | <50ms | ~0.76ms | ✅ |
| Proxy 核心同步 MEAN | <0.1ms | ~0.06ms | ✅ |
| Baseline 内存 MEAN | <0.1ms | ~0.004ms | ✅ |

I/O 开销（stdio 管道 / SQLite 落盘）已单独标注，不计入核心检测预算。详见 [bench results](packages/local/tests/bench/results.md)。

---

## 8. 交付验收命令清单

```bash
npm test                                    # 289+ 测试通过
npm run bench --prefix packages/local       # 性能基准 PASS
npm run pack:verify                         # build + pack + 安装冒烟
agentwatch proxy -- npx -y @okx_ai/okx-trade-mcp
agentwatch logs --tail 5
sqlite3 ~/.agentwatch/agentwatch.db ".tables"
```

完整架构对照见 **[架构复查报告](docs/architecture_review_report.md)**。

---

## 9. 仓库文档目录

| 文档 | 说明 |
|------|------|
| [产品架构完整版](docs/产品架构完整版.md) | 完整架构设计基准（6700+ 行） |
| [架构对照复查报告](docs/architecture_review_report.md) | V0 交付前全量复盘 |
| [V0 冻结验收报告](docs/v0-freeze-report.md) | SQLite 表结构验收标准 |
| [MVP 任务清单](docs/agentwatch_v0_mvp_tasklist.md) | 63 项开发任务 |
| [E2E 测试指南](docs/e2e_full_pipeline.md) | 四场景验收说明 |
| [NPM 打包验证](docs/npm_pack_verify.md) | pack 安装流程 |
| [运维故障排查](docs/operation_troubleshoot.md) | 常见问题 |
| [NPM 发包指引](docs/npm_publish_guide.md) | 版本与发布 |
| [L0 引擎任务](docs/task_l0_engine.md) | 规则引擎规范 |
| [L1 引擎任务](docs/task_l1_engine.md) | 统计引擎规范 |
| [Proxy/Config 任务](docs/task_proxy_config.md) | 代理与配置 |
| [路由/日志任务](docs/task_router_logger_structure.md) | 决策路由与日志 |

---

## 仓库结构

```
agent-watch-v0/
├── packages/local/src/       # 运行时：proxy / L0 / L1 / CLI / cloud / storage
├── packages/shared/types/    # 全局 TypeScript 契约
├── packages/shared/constants.ts
├── docs/                     # 架构与任务文档
├── scripts/fix-dist-imports.mjs
└── dist/                     # npm run build 输出
```

---

## 能力边界（V0 vs 路线图）

| V0 已交付 | V1/V2 路线图 |
|-----------|-------------|
| L0/L1 + 决策路由 + 异步日志 | L2 孤立森林 / ONNX |
| SQLite + HMAC + 四级脱敏 | Dashboard / WebSocket |
| A2A + 基线偏离独立场景 | CUSUM / EWMA 完整版 |
| CLI 四命令 + npm 发包 | FalsePositiveController 持久化 |
| 云端 HTTP 批量上报 | L3 云端深度学习 |

**License**: ISC
