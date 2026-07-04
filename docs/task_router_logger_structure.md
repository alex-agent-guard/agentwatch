# AgentWatch 工程架构分析报告

## 分析模块范围：Decision Router + Async Logger + 项目结构 + Cursor 提示词

**基于架构文档**: `/mnt/agents/upload/agentwatch_architecture.md`
**分析日期**: 2025-01-15
**架构版本**: V0 (MVP)

---

## 1. Decision Router 工程任务清单

### 模块概述
Decision Router 是 AgentWatch 检测系统的最终决策中枢，负责将 L0 规则引擎、L1 统计引擎、L2 轻量 ML 引擎的多维检测结果融合为统一的 `ALLOW` / `BLOCK` / `WARN` / `CHALLENGE` 决策。核心由 `RiskFusionEngine`（风险融合引擎）和 `FalsePositiveController`（误报率控制器）组成。

### 架构引用
- **RiskFusionEngine**: 行 5612-5760
- **组合增强规则**: 行 5792-5798
- **FalsePositiveController**: 行 5800-5880
- **DetectionOrchestrator 层间协作**: 行 2850-3001
- **最终评分输出格式**: 行 5892-5994

### 任务清单

| 任务ID | 任务名称 | 优先级 | 输入接口 | 输出接口 | 依赖模块 | 代码状态 | 测试验收标准 |
|--------|---------|--------|---------|---------|---------|---------|-------------|
| DR-001 | RiskFusionEngine 核心融合算法 | P0 | `Map<string, ScenarioScore>` (各场景得分) | `FusionResult` (含 baseScore, enhancedScore, finalDecision) | L0 Rule Engine, L1 Statistical Engine | 架构代码 约170行；`fuse()` 方法可直接使用（行 5681-5724），`checkCombination()` 和 `decide()` 逻辑完整；**需补全** `calculateConfidence()` 的具体实现和边界 case 处理 | ① 10 个场景加权融合计算误差 < 1e-6；② 输入空 Map 时返回 ALLOW；③ 总延迟 < 0.01ms (O(N_scenarios * N_rules)) |
| DR-002 | 场景权重配置管理 | P1 | 配置文件路径或动态配置对象 | 权重 Map (`Map<string, number>`) | Config Manager (DR-006) | 架构代码 行 5630-5641 定义了默认权重；**需补全** 配置热加载、权重校验（和为1）、自定义权重覆盖 | ① 10 个默认场景权重之和 = 1.0；② 支持运行时动态更新权重；③ 配置异常时降级到默认权重 |
| DR-003 | 组合增强逻辑 (Combination Boost) | P0 | `Map<string, ScenarioScore>` + `CombinationRule[]` | 增强后得分 `enhancedScore` + `triggeredCombinations[]` | RiskFusionEngine (DR-001) | 架构代码 行 5644-5672 定义了 3 条规则，行 5700-5708 实现了循环检测；**需补全** 第 4 条(账户接管)和第 5 条(供应链+滥用)规则的实现 | ① `high_value_transfer`: 参数篡改>=0.6 + 工具链滥用>=0.4 → 1.5x 增强且 max=0.99；② `coordinated_attack`: 意图劫持>=0.5 + Prompt注入>=0.4 → 1.4x 增强且 max=0.95；③ `rapid_probing`: 权限试探>=0.6 + 频率异常>=0.5 → 1.3x 增强且 max=0.95；④ 多条规则同时触发时取乘积增强 |
| DR-004 | 动态阈值调整 (FalsePositiveController) | P0 | 用户反馈记录 `(alertId, wasFalsePositive, score, scenario)` | `ThresholdAdjustment` (含 adjusted, actualFPR, currentThresholds) | 日志系统（用于获取反馈数据）、Config Manager | 架构代码 行 5814-5880 完整实现了 `recordFeedback()` 和 `adjustThresholds()`；**需补全** 定时调度器（每 24h 调用）、阈值变更事件通知、持久化 | ① 7 天窗口内反馈 < 20 条时不调整阈值；② 实际误报率 > 7.5% 时 block/warn 阈值均 +0.02；③ 实际误报率 < 2.5% 时阈值均 -0.02；④ block 阈值范围 [0.5, 0.95]，warn 阈值范围 [0.2, 0.8]；⑤ 阈值调整后通知 RiskFusionEngine 更新 |
| DR-005 | 最终决策输出格式化 | P1 | `FusionResult` + 各层原始结果 | 标准 JSON 输出（行 5894-5994 格式） | RiskFusionEngine (DR-001), 所有检测层 | 架构代码 行 5892-5994 定义了完整输出格式；**需补全** JSON 序列化器、事件 ID 生成、检测延迟统计聚合 | ① 输出 JSON 严格匹配架构定义 schema；② 包含 fusion_result / scenario_scores / combination_analysis / detection_latency_ms / layer_results 全部字段；③ 序列化耗时 < 0.5ms |
| DR-006 | 关键场景兜底告警 | P1 | `enhancedScore` + `activeScenarios[]` | 可能覆盖为 WARN 的决策 | RiskFusionEngine (DR-001) | 架构代码 行 5739-5741 已实现：当 goal_hijacking 或 parameter_tampering 活跃且 score>=0.5 时强制 WARN；**代码完整，无需补全** | ① 意图劫持活跃 + score>=0.5 → WARN；② 参数篡改活跃 + score>=0.5 → WARN；③ 不影响 score>=0.8 时的 BLOCK 决策 |
| DR-007 | 检测延迟预算管控 | P0 | 各层检测耗时统计 | 总延迟 + 是否超预算 | 所有检测层 | 架构代码 行 2871-2876 定义了延迟预算；行 2930 计算总延迟；**需补全** 超时降级逻辑（L2/L3 跳过）、延迟告警 | ① L0 < 10ms（硬性）；② L0+L1 < 50ms（默认）；③ L0+L1+L2 < 50ms（按需）；④ 超预算时自动降级到下层检测 |

---

## 2. Async Logger 工程任务清单

### 模块概述
Async Logger 负责将检测过程中产生的所有行为事件以 JSON Lines 格式本地持久化，并支持批量异步上报云端。核心功能包括：本地存储、日志轮转、批量云端上报（V0 简化版用 HTTP）、参数脱敏（Masking）。

### 架构引用
- **BehaviorLogEntry 接口**: 行 4350-4392
- **UserProfile / UserConfig 接口**: 行 4398-4439
- **ILogger 接口**: 行 5049-5062
- **DataMasker / MaskLevel**: 行 4744-4841
- **HMAC 链式校验**: 行 4847-4919
- **云端批量上报接口**: 行 5260-5279
- **部署配置（日志）**: 行 6081-6099

### 任务清单

| 任务ID | 任务名称 | 优先级 | 输入接口 | 输出接口 | 依赖模块 | 代码状态 | 测试验收标准 |
|--------|---------|--------|---------|---------|---------|---------|-------------|
| AL-001 | JSON Lines 本地存储引擎 | P0 | `BehaviorLogEntry` 对象 | `~/.agentwatch/log.jsonl` 文件（追加写） | 无 | 架构代码 行 4350-4392 定义了完整 Schema；**需补全** 文件追加写入、目录创建、文件锁、错误处理 | ① 每条日志单行 JSON，无换行符污染；② 写入失败时抛异常不丢日志；③ 支持并发写入（文件锁或队列）；④ 存储路径可配置（默认 ~/.agentwatch/log.jsonl） |
| AL-002 | 日志轮转 (Rotation) | P0 | 当前日志文件 + 轮转配置 | 轮转后的 gzip 归档文件 | AL-001 | 架构代码 行 4357-4358 定义了策略；行 6083-6087 定义了配置项；**需补全** 按日期/大小轮转实现、压缩、清理过期文件 | ① 每日轮转；② 保留 7 天未压缩日志；③ 超过 7 天自动 gzip 压缩；④ 单文件 maxSizeMB=100 时触发额外轮转；⑤ 轮转过程不丢日志、不阻塞写入 |
| AL-003 | 批量云端上报 (HTTP 简化版) | P1 | `BehaviorLogEntry[]` 缓冲区 | HTTP POST 到 `/v1/events/batch` | Config Manager（读取 endpoint/apiKey）、Network | 架构代码 行 5260-5279 定义了批量上报接口；行 6111-6115 定义了 batch 配置；**需补全** HTTP 客户端、批量缓冲区、flush 定时器、重试策略 | ① 批量最多 100 条（可配置）；② flush 间隔 5s（可配置）；③ 上报失败时退避重试（最多 3 次）；④ 网络不可用时缓冲到本地，恢复后补报；⑤ 上报耗时 < 2s（异步不阻塞检测流程） |
| AL-004 | 参数脱敏 (DataMasking) | P0 | `toolName` + `params: Record<string, unknown>` + `MaskingConfig` | `MaskedParams` (含 maskedValues, typeSignatures, hashes) | Config Manager（读取脱敏配置） | 架构代码 行 4769-4834 `DataMasker.maskParams()` 完整可直接使用；**需补全** 配置文件加载、默认脱敏规则、工具级别规则匹配 | ① Level 0 (FULL): 参数值完整保留；② Level 1 (HASH): SHA-256 哈希替换，显示前 8 位；③ Level 2 (TYPE): 替换为 `<type>` 标记；④ Level 3 (DROP): 替换为 `[REDACTED]`；⑤ 敏感字段默认列表：apiKey, secret, privateKey, password, mnemonic |
| AL-005 | HMAC 链式校验 | P2 | `BehaviorLogEntry` | 带 HMAC 签名的日志条目 | AL-001 | 架构代码 行 4854-4919 `HMACChainVerifier` 完整可直接使用；**需补全** 密钥管理（从系统密钥环读取）、签名持久化 | ① 每条日志包含基于前一条 HMAC 的链式签名；② 篡改检测可定位到被篡改的条目索引；③ 密钥从系统密钥环读取（macOS Keychain / Linux Secret Service / Windows DPAPI） |
| AL-006 | 日志查询接口 | P2 | `LogFilter` (时间范围、会话ID、工具名、决策等) | `BehaviorLogEntry[]` | AL-001 | 架构代码 行 5061 定义了 `queryLogs(filter)` 接口；**需补全** 索引、分页、过滤实现 | ① 支持按时间范围过滤；② 支持按 sid/tid/tool/dec 过滤；③ 查询耗时 < 100ms（1万条日志）；④ 支持分页返回 |
| AL-007 | 日志缓冲区管理 | P1 | 实时检测事件流 | 缓冲的日志条目（批量 flush 前） | AL-001, AL-003 | 无架构代码；**需全新实现** | ① 内存缓冲区大小可配置（默认 100 条）；② 缓冲区满时自动 flush；③ 进程退出时 flush 剩余日志；④ 缓冲区溢出时丢弃最旧条目并告警 |
| AL-008 | 性能指标采集 | P2 | 检测引擎运行时数据 | 日志条目的性能字段 (dur_ms, l0_rules, l1_scores) | 所有检测层 | 架构代码 行 4374-4382 定义了性能字段；**需补全** 指标采集器、耗时测量 | ① dur_ms: 工具调用耗时精确到 1ms；② l0_rules: 记录命中的规则ID和严重级别；③ l1_scores: 记录 L1 各算法得分；④ 检测延迟在日志条目中准确反映 |

---

## 3. Monorepo 项目目录结构

```
agentwatch/
|
|-- README.md                          # 项目说明文档
|-- package.json                       # 根 package.json (workspaces 配置)
|-- tsconfig.json                      # 根 TypeScript 配置
|-- tsconfig.base.json                 # 共享 TS 配置基础
|-- pnpm-workspace.yaml                # pnpm workspace 配置
|-- .cursorrules                       # Cursor AI 全局规则文件
|
|-- packages/
|   |
|   |-- shared/                        # ======== 共享层 ========
|   |   |-- package.json
|   |   |-- tsconfig.json
|   |   |
|   |   |-- src/
|   |   |   |-- types/                 # 全局类型定义
|   |   |   |   |-- index.ts           # 类型统一导出
|   |   |   |   |-- detection.ts       # 检测相关类型 (ToolCallEvent, DetectionEvent, DetectionResult 等)
|   |   |   |   |-- fusion.ts          # 融合相关类型 (ScenarioScore, FusionResult, CombinationRule 等)
|   |   |   |   |-- logging.ts         # 日志相关类型 (BehaviorLogEntry, MaskedParams, MaskLevel 等)
|   |   |   |   |-- profile.ts         # 用户画像类型 (UserProfile, UserConfig, BaselineCache 等)
|   |   |   |   |-- api.ts             # API 接口类型 (ILogger, IConfigManager, IDetectionEngine 等)
|   |   |   |   |-- alert.ts           # 告警类型 (AlertRecord, ThresholdAdjustment 等)
|   |   |   |
|   |   |   |-- utils/                 # 共享工具函数
|   |   |   |   |-- crypto.ts          # SHA-256, HMAC 工具
|   |   |   |   |-- time.ts            # 时间戳、格式化工具
|   |   |   |   |-- jsonl.ts           # JSON Lines 序列化/反序列化
|   |   |   |   |-- math.ts            # 统计计算工具 (均值、方差、Z-score)
|   |   |   |
|   |   |   |-- constants/             # 全局常量
|   |   |   |   |-- index.ts           # 阈值默认值、场景权重默认值等
|   |   |   |   |-- scenarios.ts       # 检测场景枚举和配置
|   |   |   |
|   |   |-- tests/
|   |   |   |-- types.test.ts          # 类型兼容性测试
|   |   |   |-- utils.test.ts          # 工具函数单元测试
|   |   |
|   |   |-- .cursor-prompt.md          # Cursor AI 提示词：Shared 模块
|   |
|   |
|   |-- local/                         # ======== 本地层 (MCP 中间件) ========
|   |   |-- package.json               # 依赖: shared, ws, yaml, keytar
|   |   |-- tsconfig.json
|   |   |-- cli.ts                     # CLI 入口 (npx @agentwatch/mcp-proxy)
|   |   |
|   |   |-- src/
|   |   |   |
|   |   |   |-- proxy/                 # MCP Proxy 核心
|   |   |   |   |-- mcp-proxy.ts       # MCP 消息代理 (JSON-RPC 透传)
|   |   |   |   |-- interceptors.ts    # 请求/响应拦截器
|   |   |   |   |-- transport.ts       # STDIO 传输层封装
|   |   |   |   |-- session.ts         # 会话管理
|   |   |   |
|   |   |   |-- detection/             # 检测引擎
|   |   |   |   |-- orchestrator.ts    # DetectionOrchestrator (行 2856-2943)
|   |   |   |   |-- l0-rule-engine.ts  # L0 规则引擎 (规则匹配、规则集管理)
|   |   |   |   |-- l1-stat-engine.ts  # L1 统计引擎 (Z-score, CUSUM, EWMA, Markov)
|   |   |   |   |-- l2-ml-engine.ts    # L2 轻量 ML (V2 占位)
|   |   |   |   |-- l3-cloud-client.ts # L3 云端客户端 (异步提交)
|   |   |   |   |
|   |   |   |   |-- rules/             # 规则定义
|   |   |   |   |   |-- default.yaml   # 默认规则集
|   |   |   |   |   |-- custom/        # 用户自定义规则目录
|   |   |   |   |
|   |   |   |   |-- baseline/          # 行为基线
|   |   |   |   |   |-- builder.ts     # 基线构建器
|   |   |   |   |   |-- cache.ts       # 基线缓存管理
|   |   |   |   |   |-- persistence.ts # 基线持久化 (本地文件)
|   |   |   |   |
|   |   |   |   |-- scenarios/         # 场景检测器
|   |   |   |   |   |-- goal-hijacking.ts
|   |   |   |   |   |-- parameter-tampering.ts
|   |   |   |   |   |-- tool-chain-abuse.ts
|   |   |   |   |   |-- frequency-anomaly.ts
|   |   |   |   |   |-- supply-chain.ts
|   |   |   |   |   |-- prompt-injection.ts
|   |   |   |   |   |-- a2a-risk.ts
|   |   |   |   |   |-- permission-probing.ts
|   |   |   |   |   |-- timing-anomaly.ts
|   |   |   |   |   |-- baseline-deviation.ts
|   |   |   |
|   |   |   |-- decision/              # 决策路由
|   |   |   |   |-- fusion-engine.ts   # RiskFusionEngine (行 5628-5760)
|   |   |   |   |-- fp-controller.ts   # FalsePositiveController (行 5814-5880)
|   |   |   |   |-- threshold.ts       # 动态阈值管理
|   |   |   |   |-- output-formatter.ts# 最终输出格式化器
|   |   |   |
|   |   |   |-- logging/               # 异步日志系统
|   |   |   |   |-- async-logger.ts    # AsyncLogger 主类 (实现 ILogger)
|   |   |   |   |-- local-store.ts     # JSON Lines 本地存储引擎
|   |   |   |   |-- rotation.ts        # 日志轮转器
|   |   |   |   |-- cloud-uploader.ts  # 云端批量上报器 (HTTP)
|   |   |   |   |-- buffer.ts          # 日志缓冲区
|   |   |   |   |-- data-masker.ts     # DataMasker (行 4769-4834)
|   |   |   |   |-- hmac-chain.ts      # HMAC 链式校验 (行 4854-4919)
|   |   |   |   |-- query.ts           # 日志查询引擎
|   |   |   |
|   |   |   |-- config/                # 配置管理
|   |   |   |   |-- config-manager.ts  # ConfigManager (实现 IConfigManager)
|   |   |   |   |-- loader.ts          # 配置文件加载器 (YAML)
|   |   |   |   |-- validator.ts       # 配置校验器
|   |   |   |   |-- schema.ts          # 配置 Schema 定义
|   |   |   |
|   |   |   |-- encryption/            # 数据加密
|   |   |   |   |-- local-encrypt.ts   # LocalDataEncryption (行 4939-4967)
|   |   |   |   |-- keychain.ts        # 系统密钥环接口
|   |   |   |
|   |   |   |-- api/                   # 本地 API 实现
|   |   |   |   |-- server.ts          # 本地 HTTP API 服务 (可选)
|   |   |   |   |-- handlers.ts        # 请求处理器
|   |   |   |
|   |   |   |-- utils/                 # 本地层工具
|   |   |       |-- paths.ts           # 路径管理 (~/.agentwatch/)
|   |   |       |-- errors.ts          # 错误类型定义
|   |   |
|   |   |-- tests/
|   |   |   |-- detection/             # 检测引擎测试
|   |   |   |   |-- orchestrator.test.ts
|   |   |   |   |-- l0-rule.test.ts
|   |   |   |   |   |-- l1-stat.test.ts
|   |   |   |-- decision/              # 决策路由测试
|   |   |   |   |-- fusion-engine.test.ts
|   |   |   |   |-- fp-controller.test.ts
|   |   |   |-- logging/               # 日志系统测试
|   |   |   |   |-- local-store.test.ts
|   |   |   |   |-- rotation.test.ts
|   |   |   |   |-- masker.test.ts
|   |   |   |   |-- cloud-upload.test.ts
|   |   |   |-- config/                # 配置管理测试
|   |   |   |   |-- config.test.ts
|   |   |
|   |   |-- .cursor-prompt.md          # Cursor AI 提示词：Local 模块汇总
|   |
|   |
|   |-- cloud/                         # ======== 云端层 (V0 占位) ========
|   |   |-- package.json               # 依赖: shared, express, clickhouse
|   |   |-- tsconfig.json
|   |   |
|   |   |-- src/
|   |   |   |-- api/                   # REST API 服务端
|   |   |   |   |-- server.ts          # Express 服务器入口
|   |   |   |   |-- routes/            # 路由定义
|   |   |   |   |   |-- auth.ts        # /v1/auth/token
|   |   |   |   |   |-- agents.ts      # /v1/agents
|   |   |   |   |   |-- events.ts      # /v1/events, /v1/events/batch
|   |   |   |   |   |-- baselines.ts   # /v1/baselines
|   |   |   |   |   |-- alerts.ts      # /v1/alerts
|   |   |   |   |   |-- reports.ts     # /v1/reports
|   |   |   |   |   |-- config.ts      # /v1/config
|   |   |   |   |   |-- health.ts      # /v1/health, /v1/metrics
|   |   |   |   |
|   |   |   |   |-- middleware/
|   |   |   |   |   |-- auth.ts        # JWT 认证中间件
|   |   |   |   |   |-- rate-limit.ts  # 限流中间件
|   |   |   |   |   |-- error.ts       # 错误处理中间件
|   |   |   |
|   |   |   |-- storage/               # 数据存储
|   |   |   |   |-- postgres.ts        # PostgreSQL 客户端
|   |   |   |   |-- clickhouse.ts      # ClickHouse 客户端
|   |   |   |   |-- schema/            # 数据库迁移
|   |   |   |       |-- 001_init.sql   # 初始表结构 (行 4500-4728)
|   |   |   |
|   |   |   |-- ingestion/             # 数据摄入
|   |   |   |   |-- event-processor.ts # 事件处理器
|   |   |   |   |-- batch-processor.ts # 批量处理器
|   |   |   |   |-- stream-ws.ts       # WebSocket 实时流
|   |   |   |
|   |   |   |-- analysis/              # 深度分析 (V1+)
|   |   |   |   |-- .gitkeep           # V0 占位
|   |   |   |
|   |   |   |-- notification/          # 通知系统 (V1+)
|   |   |       |-- .gitkeep           # V0 占位
|   |   |
|   |   |-- tests/
|   |   |   |-- api.test.ts            # API 路由测试
|   |   |   |-- ingestion.test.ts      # 数据摄入测试
|   |   |
|   |   |-- .cursor-prompt.md          # Cursor AI 提示词：Cloud 模块
|   |
|   |
|-- docs/                              # 文档目录
|   |-- architecture.md                # 完整架构文档
|   |-- api-reference.md               # API 参考
|   |-- deployment.md                  # 部署指南
|   |-- development.md                 # 开发指南
|
|-- scripts/                           # 构建和工具脚本
|   |-- build.sh                       # 构建脚本
|   |-- test.sh                        # 测试脚本
|   |-- setup-dev.sh                   # 开发环境初始化
|
|-- configs/                           # 配置文件模板
|   |-- config.yaml.example            # 配置模板 (行 6020-6129)
|   |-- mcp-config.json.example        # MCP 配置模板 (行 6133-6149)
|   |-- rules.example.yaml             # 规则模板
|
|-- docker/                            # Docker 配置 (V1+)
|   |-- docker-compose.yml             # 开发环境编排
|   |-- Dockerfile.local               # 本地中间件镜像
|   |-- Dockerfile.cloud               # 云端服务镜像
```

### 目录说明

| 目录 | 用途 | 关键文件 | V0 状态 |
|------|------|---------|---------|
| `packages/shared/` | 类型定义和共享工具，被 local 和 cloud 共同依赖 | `types/`, `utils/`, `constants/` | **必须实现** |
| `packages/local/` | MCP 中间件核心，运行在本地的代理层 | `proxy/`, `detection/`, `decision/`, `logging/`, `config/` | **必须实现** |
| `packages/cloud/` | 云端服务，V0 仅保留占位结构 | `api/`, `storage/`, `ingestion/` | **V0 占位**，仅实现事件接收接口 |
| `configs/` | 配置模板和示例 | `config.yaml.example`, `mcp-config.json.example` | **必须实现** |
| `docs/` | 项目文档 | `architecture.md`, `deployment.md` | **必须实现** |

---

## 4. Cursor AI 提示词模板

### 4.1 MCP Proxy Core

```markdown
# Cursor AI Prompt: MCP Proxy Core

## 模块职责
MCP Proxy Core 是 AgentWatch 的中间件入口，负责在 MCP Client 和 MCP Server 之间透传 JSON-RPC 消息，同时在请求链路中嵌入检测逻辑。它是整个系统的"网关"。

## 架构文档引用
- **MCP 消息协议**: 行 250-400
- **代理拦截机制**: 行 1200-1350
- **传输层封装**: 行 1350-1500
- **会话管理**: 行 1500-1650
- **检测引擎集成**: 行 2850-3001 (DetectionOrchestrator)
- **部署配置**: 行 6000-6150

## 输入接口
- STDIO 输入：来自 MCP Client 的 JSON-RPC 2.0 消息
- 配置文件：`~/.agentwatch/config.yaml` (行 6020-6129)
- 环境变量：OKX_API_KEY, OKX_SECRET_KEY, OKX_PASSPHRASE, AGENTWATCH_API_KEY

## 输出接口
- STDIO 输出：转发给 MCP Server 的 JSON-RPC 消息
- 检测事件：调用 `DetectionOrchestrator.detect(event)`
- 日志事件：调用 `ILogger.logBlocked()` 或 `ILogger.logAllowed()`

## 性能要求
- 消息透传延迟：< 1ms（不含检测）
- 含检测的总延迟：< 50ms（L0+L1）
- 内存占用：< 50MB
- 支持并发：10+ 并发会话

## 测试要求
- [ ] JSON-RPC 消息透传正确性（请求/响应 ID 匹配）
- [ ] 工具调用拦截触发检测流程
- [ ] BLOCK 决策时正确拒绝请求并返回错误响应
- [ ] WARN 决策时允许请求但记录告警
- [ ] 配置热加载（修改 config.yaml 后生效）
- [ ] 错误恢复（MCP Server 崩溃后自动重启）

## 依赖的其他模块
- DetectionOrchestrator (packages/local/src/detection/orchestrator.ts)
- ILogger (packages/shared/src/types/api.ts)
- ConfigManager (packages/local/src/config/config-manager.ts)

## 代码约束
- 使用 TypeScript 5.x
- 不引入第三方 JSON-RPC 库（自行解析，减少依赖）
- STDIO 传输必须正确处理二进制数据和 Unicode
- 所有异步操作必须有超时控制
```

---

### 4.2 L0 Rule Engine

```markdown
# Cursor AI Prompt: L0 Rule Engine

## 模块职责
L0 Rule Engine 是 AgentWatch 的第一道防线，基于预定义规则进行快速模式匹配。规则覆盖意图劫持、参数篡改、工具链滥用、频率异常等 10 大检测场景。L0 必须在 < 10ms 内完成所有规则匹配，是系统的"硬拦截"层。

## 架构文档引用
- **规则引擎设计**: 行 1650-1850
- **规则 Schema 定义**: 行 1850-2100
- **规则匹配算法**: 行 2100-2300
- **默认规则集**: 行 2300-2500
- **DetectionOrchestrator L0 集成**: 行 2888-2899
- **部署配置（规则引擎）**: 行 6044-6049

## 输入接口
- `DetectionEvent`：{ toolName, arguments, timestamp, userId, sessionId }
- `RuleSet`：加载的规则集（YAML/JSON 格式）
- 配置：enabled, maxMatchTimeMs, rulesPath

## 输出接口
- `RuleMatchResult[]`：每条匹配结果含 ruleId, action ('ALLOW'|'BLOCK'|'WARN'), confidence, severity
- BLOCK 规则会直接触发拦截（DetectionOrchestrator 行 2892-2898）

## 性能要求
- 单条规则匹配：< 0.1ms
- 全量规则匹配：< 10ms（硬性，超时降级）
- 规则集加载：< 100ms
- 内存中规则缓存：无 IO 依赖

## 测试要求
- [ ] 每条默认规则至少 2 个测试用例（命中/未命中）
- [ ] 参数篡改检测：数值偏离、类型异常、敏感参数
- [ ] 工具链滥用：禁止链、高风险转移
- [ ] 意图劫持：关键词匹配、语义分析
- [ ] 规则优先级：BLOCK > WARN > ALLOW
- [ ] 超时降级：超过 10ms 时返回部分结果
- [ ] 规则热加载：修改规则文件后 30s 内生效

## 依赖的其他模块
- shared/types/detection.ts (DetectionEvent, RuleMatchResult 类型)
- shared/constants/scenarios.ts (场景枚举)
- config-manager (获取规则配置)

## 代码约束
- 规则匹配使用高效的字符串/正则匹配（避免回溯灾难）
- 规则按优先级排序，BLOCK 规则优先匹配
- 支持规则条件组合（AND/OR/NOT）
- 规则文件使用 YAML 格式，支持注释
```

---

### 4.3 L1 Statistical Engine

```markdown
# Cursor AI Prompt: L1 Statistical Engine

## 模块职责
L1 Statistical Engine 是 AgentWatch 的第二道防线，基于用户行为基线进行统计异常检测。实现 5 大统计算法：Z-Score、CUSUM、EWMA、Markov 链、频率分析。L1 在 < 50ms 内完成计算，是系统的"智能检测"层。

## 架构文档引用
- **统计引擎架构**: 行 2500-2850
- **6维行为画像模型**: 行 3004-3300
- **行为基线系统**: 行 3300-3800
- **统计算法实现**: 行 3800-4350
- **DetectionOrchestrator L1 集成**: 行 2901-2909
- **L1 接口定义**: 行 2964-2984 (L1StatisticalEngine, L1DetectionResult)
- **部署配置（统计引擎）**: 行 6051-6058

## 输入接口
- `ToolCallEvent`：{ toolName, timestamp, chainDepth, argumentCount, arguments, userId, sessionId, agentId }
- `BaselineCache`：用户行为基线（6 维数据）
- 配置：zScoreThreshold=3.0, cusumThreshold=5.0, ewmaLambda=0.2, markovOrder=2, windowSizeMs=300000

## 输出接口
- `L1DetectionResult`：{
    zScore: ZScoreResult,
    cusum: Record<string, CUSUMResult>,
    ewma: Record<string, EWMAResult>,
    frequency: FrequencyResult,
    markov: MarkovResult,
    combinedScore: number,      // [0, 1]
    isAnomaly: boolean,
    latencyMs: number
  }

## 性能要求
- Z-Score 计算：< 1ms
- CUSUM 计算：< 1ms
- EWMA 计算：< 1ms
- Markov 链计算：< 2ms
- 频率分析：< 1ms
- 总计算时间：< 50ms（含基线加载）
- 冷启动：前 30 次调用仅采集数据，不报警

## 测试要求
- [ ] Z-Score：正常值在 [-3, 3] 内不报警，超出时报警
- [ ] CUSUM：累积和超过阈值时报警
- [ ] EWMA：平滑后的值偏离正常范围时报警
- [ ] Markov：低概率转移（< 0.05）时报警
- [ ] 频率：1分钟/5分钟频率超过历史 P95 时报警
- [ ] 冷启动：调用次数 < 30 时不触发 isAnomaly=true
- [ ] 基线更新：调用 `updateBaseline()` 后基线正确更新
- [ ] 综合得分：combinedScore 在 [0, 1] 范围内

## 依赖的其他模块
- shared/types/detection.ts (ToolCallEvent, L1DetectionResult)
- shared/types/profile.ts (BaselineCache)
- shared/utils/math.ts (统计计算工具)
- baseline/ (基线管理模块)

## 代码约束
- 所有统计算法使用增量更新（避免全量重算）
- 浮点运算注意精度问题（使用 epsilon 比较）
- 基线数据使用内存缓存 + 本地文件持久化
- Markov 链使用稀疏矩阵存储
```

---

### 4.4 Decision Router

```markdown
# Cursor AI Prompt: Decision Router

## 模块职责
Decision Router 是 AgentWatch 的决策中枢，负责将多层检测结果融合为最终决策。核心包含三个组件：RiskFusionEngine（加权融合 + 组合增强）、FalsePositiveController（动态阈值调整）、OutputFormatter（决策格式化输出）。Decision Router 的延迟预算仅 0.01ms。

## 架构文档引用
- **RiskFusionEngine**: 行 5612-5760
- **加权评分公式**: 行 5614-5642
- **组合增强逻辑**: 行 5788-5798
- **FalsePositiveController**: 行 5800-5880
- **动态阈值调整**: 行 5751-5759
- **最终评分输出**: 行 5892-5994
- **DetectionOrchestrator 决策集成**: 行 2901-2920
- **部署配置（决策）**: 行 6066-6071

## 输入接口
- `Map<string, ScenarioScore>`：各检测场景的得分（来自 L0/L1/L2/L3）
  - ScenarioScore: { scenario, score [0,1], isAnomaly, indicators[] }
- `ThresholdAdjustment`：FalsePositiveController 的阈值调整结果
- 配置：blockThreshold=0.8, warnThreshold=0.5, ruleWeight=0.6, statWeight=0.4

## 输出接口
- `FusionResult`：{
    baseScore: number,           // 基础加权得分
    enhancedScore: number,       // 组合增强后得分
    finalDecision: 'ALLOW'|'BLOCK'|'WARN',
    threshold: { block, warn },
    activeScenarios: string[],
    triggeredCombinations: string[],
    scenarioBreakdown: Record<string, ScenarioScore>,
    confidence: number
  }
- 标准 JSON 输出格式（行 5894-5994）

## 性能要求
- 加权融合计算：O(N_scenarios * N_rules) ~ 0.01ms
- 组合增强检测：O(N_rules) ~ 0.005ms
- 阈值判定：O(1) ~ 0.001ms
- 总延迟：< 0.05ms（含格式化）
- 内存：无动态分配（使用预分配数组）

## 测试要求
- [ ] 10 场景加权融合：权重和为 1，计算正确
- [ ] 组合增强：high_value_transfer (参数篡改>=0.6 + 工具链>=0.4) → 1.5x
- [ ] 组合增强：coordinated_attack (意图劫持>=0.5 + Prompt注入>=0.4) → 1.4x
- [ ] 组合增强：rapid_probing (权限试探>=0.6 + 频率>=0.5) → 1.3x
- [ ] 多条规则同时触发时取乘积增强
- [ ] 阈值判定：score>=0.8 → BLOCK; score>=0.5 → WARN; else ALLOW
- [ ] 关键场景兜底：goal_hijacking/parameter_tampering 活跃 + score>=0.5 → WARN
- [ ] 误报率控制：FPR>7.5% 时阈值+0.02; FPR<2.5% 时阈值-0.02
- [ ] 置信度计算：活跃场景数/3，上限 1.0
- [ ] 输出 JSON 严格匹配 schema（行 5894-5994）

## 依赖的其他模块
- shared/types/fusion.ts (ScenarioScore, FusionResult, CombinationRule)
- L0 Rule Engine (rule match results)
- L1 Statistical Engine (combinedScore)
- Config Manager (threshold config)

## 代码约束
- 融合计算使用 double 精度（避免精度丢失）
- 组合增强的 boostFactor 乘法注意溢出上限（maxBoostedScore）
- 阈值调整后需同步更新 RiskFusionEngine 实例
- 所有决策结果必须包含完整的 scenarioBreakdown（用于审计）
```

---

### 4.5 Async Logger

```markdown
# Cursor AI Prompt: Async Logger

## 模块职责
Async Logger 是 AgentWatch 的日志基础设施，负责将检测事件以 JSON Lines 格式本地持久化，并支持批量异步上报云端。核心功能：本地存储、日志轮转、参数脱敏、HMAC 链式校验、云端批量上报。日志系统必须保证"零丢日志"——即使系统崩溃，已产生的日志也不能丢失。

## 架构文档引用
- **BehaviorLogEntry 接口**: 行 4350-4392
- **ILogger 接口**: 行 5049-5062
- **DataMasker / 4级脱敏**: 行 4744-4841
- **HMAC 链式校验**: 行 4847-4919
- **加密方案**: 行 4922-4967
- **云端批量上报 API**: 行 5260-5279
- **部署配置（日志）**: 行 6081-6099

## 输入接口
- `JSONRPCRequest` + `DetectionResult` → logBlocked() / logAllowed()
- `AlertRecord` → logAlert()
- `LogFilter` → queryLogs()
- 配置：level, format, output, maxSizeMB, maxFiles, mask.enabled, mask.level, mask.sensitiveFields

## 输出接口
- 本地文件：`~/.agentwatch/log.jsonl`（JSON Lines 格式，每行一条日志）
- 云端上报：HTTP POST /v1/events/batch（异步）
- 查询结果：`BehaviorLogEntry[]`

## 性能要求
- 单条日志写入：< 1ms（含序列化）
- 批量上报延迟：不阻塞检测流程（后台线程）
- 缓冲区大小：默认 100 条（可配置）
- 内存占用：缓冲区 + 当前文件句柄 < 10MB
- 写入模式：追加写（append），无锁或轻量锁

## 测试要求
- [ ] JSON Lines 格式：每行有效 JSON，无换行符污染
- [ ] 日志轮转：每日轮转，保留 7 天，超期 gzip 压缩
- [ ] 参数脱敏 4 级：FULL(0)/HASH(1)/TYPE(2)/DROP(3) 正确应用
- [ ] 敏感字段脱敏：apiKey, secret, privateKey, password, mnemonic
- [ ] HMAC 链式校验：签名正确，篡改可检测
- [ ] 批量上报：100 条批量 flush，5s 间隔
- [ ] 网络故障：失败时退避重试，缓冲到本地
- [ ] 进程退出：SIGTERM 时 flush 剩余日志
- [ ] 并发写入：100 并发事件不丢日志

## 依赖的其他模块
- shared/types/logging.ts (BehaviorLogEntry, MaskedParams, MaskLevel)
- shared/types/api.ts (ILogger, LogFilter, AlertRecord)
- shared/utils/jsonl.ts (JSON Lines 序列化)
- shared/utils/crypto.ts (SHA-256, HMAC)
- Config Manager (日志配置)

## 代码约束
- 日志写入使用同步文件追加（fs.appendFileSync）保证持久化
- 云端上报使用异步 HTTP 客户端（不阻塞主流程）
- 脱敏在写入前完成（敏感数据不进入日志文件）
- 缓冲区使用环形缓冲区（ring buffer）避免 GC 压力
- 所有文件路径支持 tilde 展开（~/.agentwatch/）
```

---

### 4.6 Config Manager

```markdown
# Cursor AI Prompt: Config Manager

## 模块职责
Config Manager 是 AgentWatch 的配置中枢，负责加载、校验、热更新所有配置项。配置来源：YAML 配置文件 (~/.agentwatch/config.yaml)、环境变量、默认值。配置变更时需要通知相关模块（如阈值调整后通知 RiskFusionEngine）。

## 架构文档引用
- **IConfigManager 接口**: 行 5064-5074
- **配置文件格式**: 行 6020-6129
- **部署配置**: 行 6000-6150
- **MCP 配置集成**: 行 6133-6149

## 输入接口
- 配置文件路径：`~/.agentwatch/config.yaml`
- 环境变量：${OKX_API_KEY}, ${OKX_SECRET_KEY}, ${OKX_PASSPHRASE}, ${AGENTWATCH_API_KEY}
- 程序化接口：`get<T>(key: string): T`, `set<T>(key: string, value: T): void`, `reload(): void`

## 输出接口
- 配置对象：完整的 AgentWatchConfig（包含 agentId, userId, proxy, performance, detection, baseline, logging, cloud, scenarios 等全部配置节）
- 变更通知：订阅者模式（模块可订阅特定配置键的变更）

## 性能要求
- 配置加载：< 50ms（首次启动）
- 配置读取：O(1)，内存访问（无 IO）
- 热重载：< 100ms（文件变更检测 + 重新加载 + 通知）
- 文件监听：使用 fs.watch 或轮询（fallback）

## 测试要求
- [ ] YAML 解析正确：支持嵌套配置、数组、注释
- [ ] 环境变量展开：${VAR} 语法正确替换
- [ ] 默认值回退：未配置项使用默认值
- [ ] 配置校验：无效值抛异常并给出明确错误信息
- [ ] 热重载：修改 config.yaml 后 30s 内生效
- [ ] 变更通知：订阅者收到正确的变更事件
- [ ] 嵌套读取：get('detection.ruleEngine.enabled') 返回正确值

## 依赖的其他模块
- shared/types/ (类型定义)
- 无运行时依赖（纯本地文件操作）

## 代码约束
- 配置文件使用 YAML 格式（支持注释，便于用户编辑）
- 配置键使用点号分隔的嵌套路径（如 detection.ruleEngine.enabled）
- 敏感值（API Key）从环境变量读取，不硬编码到配置文件
- 配置变更时先校验再应用（无效配置不生效）
- 支持配置分层：默认值 < 配置文件 < 环境变量 < 程序设置
```

---

## 5. 代码状态总览表

### 模块级别统计

| 模块 | 架构代码行数 | 可直接用行数 | 需补全行数 | 完成度% | 说明 |
|------|------------|------------|-----------|--------|------|
| **RiskFusionEngine** | 170 | 120 | 50 | **70%** | `fuse()`/`checkCombination()`/`decide()` 逻辑完整；需补全 `calculateConfidence()`、边界 case、阈值同步机制 |
| **FalsePositiveController** | 90 | 70 | 20 | **78%** | `recordFeedback()`/`adjustThresholds()` 完整；需补全定时调度、阈值变更事件通知、持久化 |
| **DetectionOrchestrator** | 100 | 80 | 20 | **80%** | 主检测流程完整（L0→L1→L2→L3）；需补全超时降级、错误恢复、L3 异步结果回调 |
| **BehaviorLogEntry (Schema)** | 45 | 45 | 0 | **100%** | 接口定义完整，可直接作为类型使用 |
| **ILogger (Interface)** | 15 | 15 | 0 | **100%** | 接口定义完整，需实现类 |
| **DataMasker** | 70 | 50 | 20 | **71%** | `maskParams()` 核心逻辑完整；需补全配置加载、工具级别规则匹配 |
| **HMACChainVerifier** | 70 | 55 | 15 | **79%** | 签名/验证逻辑完整；需补全密钥管理（系统密钥环集成） |
| **L1 Statistical Engine** | ~200 | 120 | 80 | **60%** | 算法接口和架构清晰；5 大算法需逐一实现（Z-Score/CUSUM/EWMA/Markov/频率） |
| **L0 Rule Engine** | ~150 | 80 | 70 | **53%** | 规则匹配接口清晰；需实现规则解析器、匹配引擎、规则热加载 |
| **Config Manager** | 15 | 15 | 0 (接口) | **100%** (接口) | 接口定义完整；实现需全新编写 |
| **LocalDataEncryption** | 35 | 25 | 10 | **71%** | 加密/解密逻辑完整；需补全密钥管理（系统密钥环） |
| **Cloud Upload (HTTP)** | 0 | 0 | ~80 | **0%** | V0 需全新实现 HTTP 批量上报客户端 |
| **JSON Lines Storage** | 0 | 0 | ~60 | **0%** | V0 需全新实现本地存储引擎 |
| **Log Rotation** | 0 | 0 | ~50 | **0%** | V0 需全新实现日志轮转 |
| **MCP Proxy Core** | ~100 | 60 | 40 | **60%** | 架构代码定义了流程；需实现 STDIO 透传、JSON-RPC 解析、拦截器 |

### 汇总

| 分类 | 架构代码总行数 | 可直接用总行数 | 需补全总行数 | 综合完成度 |
|------|-------------|-------------|------------|-----------|
| **接口/类型定义** | 105 | 105 | 0 | **100%** |
| **决策路由 (Decision Router)** | 260 | 190 | 70 | **73%** |
| **异步日志 (Async Logger)** | 220 | 165 | 155 | **52%** (含全新实现模块) |
| **检测引擎 (L0/L1)** | 350 | 200 | 150 | **57%** |
| **MCP Proxy** | 100 | 60 | 40 | **60%** |
| **配置管理** | 15 | 15 | ~40 (实现) | **27%** (接口完成，实现待写) |
| **总计** | **1050** | **735** | **455** | **~57%** |

### V0 优先级实现路线图

```
Phase 1 (Week 1-2): 基础设施
  ├── shared/ 类型和工具函数（100% 需新建）
  ├── Config Manager（接口 100%，实现 0%）
  └── JSON Lines 本地存储（0%，全新实现）

Phase 2 (Week 2-3): 检测引擎
  ├── L0 Rule Engine（53%，核心匹配逻辑）
  ├── L1 Statistical Engine（60%，5 大算法）
  └── DetectionOrchestrator（80%，流程编排）

Phase 3 (Week 3-4): 决策 + 日志
  ├── RiskFusionEngine（70%，融合 + 增强）
  ├── FalsePositiveController（78%，阈值调整）
  ├── DataMasker（71%，脱敏）
  ├── Log Rotation（0%，全新实现）
  └── Cloud Upload（0%，HTTP 简化版）

Phase 4 (Week 4): 集成
  ├── MCP Proxy Core（60%，消息透传 + 拦截）
  ├── 端到端测试
  └── 性能调优
```

---

## Week1 Day7 源码落地同步

| 模块 | 源码 | 完成度 (Week1) |
|------|------|----------------|
| DecisionRouter | `detection/DecisionRouter.ts` | DR-001~003 融合 + 3 组合规则 ✅ |
| AsyncLogger | `logging/AsyncLogger.ts` | JSON Lines + 脱敏 + 背压 ✅ |
| DataMasker | 同文件 | AL-004 ✅ |
| Log Rotation | — | ⏸ Week2-3 |
| Cloud Upload | — | ⏸ Week2-3 |
| AL-008 perf 字段 | BehaviorLogEntry | dur_ms / l0_rules / l1_scores ✅ |

### 背压 / 队列常量

`DEFAULT_MAX_QUEUE_SIZE=1000`、`MAX_PERSISTED_MEMORY_BYTES=50MB`、`DEFAULT_WRITE_BUDGET_MS=10` — 见 `packages/shared/constants.ts`。

---

*本报告基于架构文档 `/mnt/agents/upload/agentwatch_architecture.md` 的严格分析，所有接口定义和代码行数引用均来自原文档，未臆造任何不存在的功能。*
