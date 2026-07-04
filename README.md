# AgentWatch MCP Web3 安全审计 CLI 工具

> **@agentwatch-web3/cli** · **v0.1.2** · Node.js ≥ 18  
> 面向 Web3 / MCP 生态的 **本地安全代理 + HMAC 链完整性审计** 工具。部署在 AI Agent 与 MCP Server 之间，实时拦截异常 `tools/call`，写入防篡改审计日志，支持 OKX A2A 客观验收。

**npm**：[@agentwatch-web3/cli](https://www.npmjs.com/package/@agentwatch-web3/cli)  
**CLI 命令**：`agentwatch-web3`（主）/ `agentwatch`（兼容别名）

---

## 项目简介

AgentWatch 是一款 **stdio MCP 安全中间件 CLI**，核心能力：

- **实时风控**：L0 规则 + L1 统计，单次检测 P99 < 50ms，输出 ALLOW / WARN / BLOCK
- **Web3 操作审计**：工具调用全链路 JSON Lines 日志 + HMAC 链式签名，防篡改
- **隐私优先**：DataMasker 四级脱敏，API Key / 私钥 / 地址不明文落盘
- **离线可用**：SQLite 持久化基线、上报队列、HMAC 索引
- **A2A 验收**：`audit verify` → ✅ + exit 0，不依赖云端

---

## 核心功能（5 条 CLI 命令）

| 命令 | 作用 | 适用场景 |
|------|------|----------|
| **`init`** | 生成 `~/.agentwatch/config.yaml`；扫描 Cursor / Claude / OnchainOS MCP 配置；备份并注入 AgentWatch 代理 | 首次安装、换机、重新绑定 MCP |
| **`proxy`** | 启动 MCP 安全网关；拦截 `tools/call`；转发其余 JSON-RPC | 日常开发、生产 Agent 运行、Demo 录屏 |
| **`status`** | 彩色自检：MCP 注入、SQLite 表、冷启动等级、云端状态、近 1h 风险统计 | 排障、上架前自检、买家验收辅助 |
| **`logs`** | 查看脱敏安全日志 `log.jsonl`；支持 tail / level / since / follow | 审计追溯、BLOCK/WARN 复盘 |
| **`audit verify`** | 校验 HMAC 审计链完整性；人类可读或 `--json`；exit 0=通过 | **OKX A2A / X Layer 官方验收标准** |

### 底层能力（命令背后）

| 层级 | 模块 | 说明 |
|------|------|------|
| 代理 | `MCPProxyCore` | stdio JSON-RPC 双向代理，仅拦截 `tools/call` |
| L0 | `RuleEngine` + 8 内置规则 | 注入/大额转账/链滥用/频率等，P99 ~0.43ms |
| L1 | `StatEngine` | Z-score、频率、Markov；P99 ~0.48ms |
| 融合 | `DecisionRouter` | rule 0.6 + stat 0.4 → 最终决策 |
| 脱敏 | `DataMasker` | FULL / HASH / TYPE / DROP 四级 |
| 审计 | `HMACChain` + `AsyncLogger` | 链式签名写入 `log.jsonl` |
| 存储 | `DatabaseManager` | SQLite 四表：baselines / upload_queue / hmac_chain / perm_probe_tracker |
| 上报 | `CloudClient` | BLOCK/WARN 脱敏批量上报（默认开，无 key 降级） |

---

## 安装

### 全局安装（推荐）

```bash
npm install -g @agentwatch-web3/cli@0.1.2
agentwatch-web3 --help
```

### npx 免安装

```bash
npx @agentwatch-web3/cli@0.1.2 agentwatch-web3 --help
npx agentwatch-web3@0.1.2 init
```

> 多 bin 包执行 `npx @scope/pkg` 时需带命令名 `agentwatch-web3`；简写 `npx agentwatch-web3` 可直接用。

### 环境变量（init / proxy 前建议设置）

```bash
export OKX_API_KEY=your_key
export OKX_SECRET_KEY=your_secret
export OKX_PASSPHRASE=your_passphrase
export OKX_PROJECT_ID=optional

export AGENTWATCH_API_KEY=optional   # 无则跳过云端上报，本地审计不受影响
```

Demo 占位：`OKX_*=demo`、`AGENTWATCH_API_KEY=demo`（配合 `scripts/echo-mcp.js`）。

---

## 命令使用示例（复制即用）

以下示例使用 `agentwatch-web3`；`agentwatch` 完全等价。

### init — 初始化

```bash
agentwatch-web3 init
# 产出：~/.agentwatch/config.yaml、rules/、MCP 配置注入（如有）
```

### proxy — 启动 MCP 代理

```bash
# 终端 1：保持运行
agentwatch-web3 proxy -- npx -y @okx_ai/okx-trade-mcp

# 自定义配置
agentwatch-web3 proxy --config ~/.agentwatch/config.yaml -- npx -y @okx_ai/okx-trade-mcp

# 本地 Demo（零 OKX 凭证）
agentwatch-web3 proxy -- node /path/to/agent-watch-v0/scripts/echo-mcp.js

# init 注入格式（MCP 配置内无 proxy 子命令）
npx @agentwatch-web3/cli --config ~/.agentwatch/config.yaml -- npx -y @okx_ai/okx-trade-mcp
```

### status — 运行状态

```bash
agentwatch-web3 status
```

### logs — 安全日志

```bash
agentwatch-web3 logs --tail 10
agentwatch-web3 logs --tail 10 --level WARN
agentwatch-web3 logs --since 1h
agentwatch-web3 logs --follow
agentwatch-web3 logs --tail 10 --since "2026-07-01"
```

### audit verify — HMAC 链审计（A2A 验收）

```bash
agentwatch-web3 audit verify
# ✅ Chain verified: 127 entries intact
# First: 2026-07-04T10:00:00.000Z
# Last:  2026-07-04T11:30:00.000Z

agentwatch-web3 audit verify --json
# {"valid":true,"count":127,"tamperedIndex":null}

echo $?   # 0=通过, 1=篡改/错误, 2=参数错误
```

### 买家 3 步验收（OKX A2A）

```bash
agentwatch-web3 init
agentwatch-web3 status
# Agent 驱动若干 tools/call 后：
agentwatch-web3 audit verify
agentwatch-web3 audit verify --json && echo $?
```

---

## 项目架构

### 目录分层

```
agent-watch-v0/
├── package.json                 # npm 发包入口（@agentwatch-web3/cli）
├── dist/                        # npm run build 编译产物（随包发布）
│   └── packages/
│       ├── local/src/           # CLI + 代理 + L0/L1 + 存储 + 云端
│       └── shared/              # 编译后的 constants / types
├── packages/
│   ├── local/src/               # 运行时源码（CLI 入口、MCPProxyCore 等）
│   │   ├── cli/                 # commander CLI：init/proxy/status/logs/audit
│   │   ├── proxy/               # MCPProxyCore
│   │   ├── rule/ · stat/        # L0 / L1 引擎
│   │   ├── privacy/             # DataMasker、HMACChain
│   │   ├── logging/             # AsyncLogger
│   │   ├── cloud/               # CloudClient、EventUploader
│   │   └── storage/             # DatabaseManager（SQLite）
│   └── shared/
│       ├── types/               # 全局 TypeScript 契约（事件、配置、规则）
│       └── constants.ts         # 默认常量、RiskType
├── scripts/
│   ├── fix-dist-imports.mjs     # 构建后路径别名重写
│   ├── echo-mcp.js              # 本地 Demo MCP（零外部依赖）
│   └── a2a-demo.sh              # Demo 指引脚本
└── docs/                        # 架构 / 任务 / 运维文档（不进 npm 包）
```

### 执行入口与 bin 双别名

| 项 | 路径 / 值 |
|----|-----------|
| **npm bin（主）** | `agentwatch-web3` → `dist/packages/local/src/cli/index.js` |
| **npm bin（兼容）** | `agentwatch` → 同上 |
| **源码入口** | `packages/local/src/cli/index.ts`（含 `#!/usr/bin/env node`） |
| **代理运行时** | `packages/local/src/cli/proxy-runtime.ts` |
| **隐式代理** | `npx @agentwatch-web3/cli --config … -- <downstream>`（无 `proxy` 子命令） |

### 核心模块分工

| 模块 | 路径 | 职责 |
|------|------|------|
| DataMasker | `privacy/DataMasker.ts` | 落盘前参数脱敏 |
| HMACChain | `privacy/HMACChain.ts` | 链式签名算法 |
| audit-verify | `cli/lib/audit-verify.ts` | CLI 层包装 verify（不动 HMAC 内核） |
| AsyncLogger | `logging/AsyncLogger.ts` | 异步写 log.jsonl + 签名 + 上报队列 |
| MCPProxyCore | `proxy/MCPProxyCore.ts` | stdio 代理与检测调度 |

### 本地数据目录

```
~/.agentwatch/
├── config.yaml       # 主配置
├── log.jsonl         # 审计日志（HMAC 签名在 _meta.hmac）
├── .hmac_key         # 签名密钥（0600）
├── agentwatch.db     # SQLite
└── rules/            # 规则目录
```

---

## 性能与打包信息

### 检测性能（V0 基准）

| 指标 | 目标 | 实测（参考） |
|------|------|-------------|
| L0 规则 P99 | < 10ms | ~0.43ms |
| L1 统计 P99 | < 50ms | ~0.48ms |
| E2E 检测 P99 | < 50ms | ~0.76ms |

### npm 包体积（v0.1.2，`npm pack --dry-run`）

| 项 | 数值 |
|----|------|
| tarball 文件名 | `agentwatch-web3-cli-0.1.2.tgz` |
| 压缩包大小 | ~202 KB |
| 解压大小 | ~921 KB |
| 包含文件数 | 214（dist + README） |

### 构建与发布机制

```bash
npm run build          # tsc + fix-dist-imports.mjs → dist/
npm run pack:verify    # build + tarball 安装冒烟（289 tests + 2 pack tests）
```

- **`prepublishOnly`**：`npm publish` 前自动执行 `npm run build`，确保 dist 最新
- **`files`**：仅发布 `dist/` 与 `README.md`（源码不进 npm 包）

### 依赖区分

| 类型 | 包 | 说明 |
|------|-----|------|
| **生产 dependencies** | `commander`, `chalk`, `byline`, `better-sqlite3` | 全局安装 / npx 运行时必需 |
| **开发 devDependencies** | `typescript`, `vitest`, `tsx`, `@types/node` | 仅源码开发、测试、构建 |

---

## 发包与迭代维护

### 版本规范（SemVer）

| 类型 | 示例 |
|------|------|
| PATCH（修复） | 0.1.2 → 0.1.3 |
| MINOR（兼容新功能） | 0.1.x → 0.2.0 |
| MAJOR（破坏性变更） | 0.x → 1.0.0 |

### 维护者发布流程

```bash
cd /Users/alex/Desktop/agent-watch-v0

# 1. 改 version（package.json + package-lock.json）
# 2. 校验
npm install
npm run build
npm test                    # 期望 289 passed / 2 skipped
npm run pack:verify

# 3. 打包预览
npm pack
# → agentwatch-web3-cli-x.y.z.tgz

# 4. 发布（prepublishOnly 自动 build）
npm publish --access public

# 5. 发布后验证
npm install -g @agentwatch-web3/cli@x.y.z
agentwatch-web3 --help
```

### GitHub 私有源码 + npm 公共包

- **源码**：私有 GitHub 仓库托管 monorepo
- **分发**：npm 公共 scope `@agentwatch-web3`
- **Release**：tag 推送后可附 tarball（GitHub Actions，可选）

### npm 发布鉴权（免 2FA 令牌）

1. 注册 npm 组织 `agentwatch-web3`
2. [npm Access Tokens](https://www.npmjs.com/settings/~your-user/tokens) → **Granular Access Token**
3. 权限：`@agentwatch-web3/cli` Read and write；**bypass 2FA**（自动化发布）
4. 本地：`npm login` 或使用 `NPM_TOKEN` 环境变量 / CI secret

---

## 常见报错避坑

| 症状 | 原因 | 处理 |
|------|------|------|
| **`command not found: agentwatch-web3`** | 未全局安装或 PATH 未含 npm global bin | `npm install -g @agentwatch-web3/cli@0.1.2`；或 `npx agentwatch-web3@0.1.2` |
| **`npx @agentwatch-web3/cli` 无输出** | 多 bin 需指定命令名 | 使用 `npx @agentwatch-web3/cli agentwatch-web3 --help` |
| **`ERR_MODULE_NOT_FOUND: commander`** | 0.1.1 及更早包生产依赖缺失 | 升级到 **0.1.2+**：`npm install -g @agentwatch-web3/cli@0.1.2` |
| **`OKX_API_KEY is not set`** | config 模板 `${OKX_*}` 未 export | 设置 env 或编辑 `~/.agentwatch/config.yaml` |
| **`npm publish` 403 Forbidden** | 版本号已存在或未授权 scope | 递增 patch 版本；确认 token 对 `@agentwatch-web3` 有 write 权限 |
| **`npm publish` 402 / 需付费 scope** | 未创建 org 或未 `--access public` | `npm publish --access public` |
| **better-sqlite3 加载失败** | 本地 Node 与预编译二进制不匹配 | `npm rebuild better-sqlite3 --build-from-source` |
| **audit verify 无日志** | 未运行 proxy 或未产生 tool call | 先 `proxy` 并触发调用，再 verify |

---

## 标准配置参考

路径：`~/.agentwatch/config.yaml`（`init` 自动生成）。完整样例见历史版本文档或运行 `init` 后查看。

关键项：

- `cloud.enabled: true` — 默认开；无 `AGENTWATCH_API_KEY` 自动降级
- `detection.a2aRisk: false` — 设为 `true` 启用 A2A 委托风控
- `logging.mask.level: 1` — 脱敏级别（0=FULL … 3=DROP）

---

## OKX.AI A2A 上架摘要

- **定价**：5 USDT（一次性）
- **验收**：`agentwatch-web3 audit verify` → ✅，`echo $?` = 0
- **隐私**：README Data Privacy 段 + `cloud.enabled: false` 可关上报
- **Demo**：`bash scripts/a2a-demo.sh` · 分镜见 `DEMO.md`

---

## 开发者

```bash
git clone <private-repo-url> agent-watch-v0 && cd agent-watch-v0
npm install
npm run build
npm test
npm run pack:verify
npm link                    # 可选
```

| 命令 | 说明 |
|------|------|
| `npm test` | 289 passed / 2 skipped |
| `npm run bench` | L0/L1 性能基准 |
| `npm run pack:verify` | tarball 安装 + proxy 冒烟 |

### 仓库文档

| 文档 | 说明 |
|------|------|
| [架构复查报告](docs/architecture_review_report.md) | V0 as-built 对照 |
| [NPM 打包验证](docs/npm_pack_verify.md) | pack 安装流程 |
| [NPM 发包指引](docs/npm_publish_guide.md) | 版本与发布细节 |
| [运维故障排查](docs/operation_troubleshoot.md) | 运维 FAQ |
| [产品架构完整版](docs/产品架构完整版.md) | 长期设计参考 |

---

## 版本历史（npm）

| 版本 | 说明 |
|------|------|
| 0.1.0 | 首包 |
| 0.1.1 | 补 `agentwatch-web3` / `agentwatch` 双 bin |
| **0.1.2** | 修复 commander 生产依赖；**当前稳定版** |

---

## License

ISC
