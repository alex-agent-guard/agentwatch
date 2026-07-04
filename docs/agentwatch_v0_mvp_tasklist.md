# AgentWatch V0 MVP — 可执行工程任务清单

> **来源文档**: `agentwatch_architecture.md` (v1.0-final, ~6700 行)
> **分析日期**: 2025-07-03
> **文档版本**: V0 MVP (黑客松 7 天版本)

---

## 0. 执行摘要

| 维度 | 数据 |
|------|------|
| **架构文档总代码行数** | ~1050 行 (含接口/类型/算法实现) |
| **可直接使用** | ~735 行 (70%) — 接口定义、Trie/AC/LRU 算法、内置规则库、Welford Z-score、DataMasker |
| **需补全实现** | ~455 行 (30%) — 空方法体、伪代码、省略边界处理 |
| **V0 需全新实现** | ~200 行 — Config Manager、JSON Lines 存储、日志轮转、HTTP 上报、CLI 入口 |
| **V0 总任务数** | 63 项 (P0: 35, P1: 21, P2: 7) |
| **V0 模块数** | 6 个核心模块 |

### V0 MVP 功能边界

```
V0 必须实现:                    V0 不实现 (defer 到 V1/V2):
├── MCP Proxy Core (stdio 转发)  ├── CUSUM 检测 (V1)
├── L0 规则引擎 (Trie + AC)      ├── EWMA 检测 (V1)
├── L1 统计引擎 (Z-score + 频率) ├── 增量基线学习 (V1)
├── Markov 链 (P1, 推荐)         ├── WebSocket 实时通道 (V1)
├── 决策路由器 (加权融合)         ├── 云端 Dashboard (V1)
├── 异步日志 (JSON Lines)         ├── L2 孤立森林 (V2)
├── 参数脱敏 (4级)               ├── L3 深度学习 (V2)
└── 配置管理 (YAML)              └── 多租户/SSO (V2)
```

---

## 1. MCP Proxy Core (12 项任务)

> **架构文档行号**: 260-410 (接口), 410-588 (核心实现), 5000-5075 (本地 API)

| 任务ID | 任务名称 | 优先级 | 输入接口 | 输出接口 | 依赖模块 | 代码状态 | 测试验收标准 |
|--------|---------|--------|---------|---------|---------|---------|-------------|
| MPC-01 | `ProxyConfig` / `ProxySession` / `JSONRPCRequest` / `JSONRPCResponse` 接口定义 | P0 | 无 | 4个核心接口 | 无 | `可直接用` | TypeScript 编译通过，接口字段与文档 (L341-L407) 一致 |
| MPC-02 | `DetectionResult` / `TriggeredRule` / `StatAnomaly` / `SecurityMarker` 接口定义 | P0 | 无 | 4个检测结果接口 | 无 | `可直接用` | TypeScript 编译通过，包含所有文档定义字段 (L559-L587) |
| MPC-03 | `MCPProxyCore` 类构造函数与 `start()` 方法 | P0 | `ProxyConfig` | `ProxySession` | Config Manager, Rule Engine, AsyncLogger, DecisionRouter | `需补全` | ① 成功 spawn 子进程 ② session 对象组装正确 ③ 错误时抛出并清理 |
| MPC-04 | `startRelay()` 双向管道中继 | P0 | `Readable` (clientIn, serverOut) | `Writable` (clientOut, serverIn) | `byline` 库 | `需补全` | ① Client→Server 正确解析 JSON-RPC ② 非 tools/call 直接转发 ③ Server→Client 响应正确回传 |
| MPC-05 | `handleToolCall()` 工具调用拦截与检测调度 | P0 | `JSONRPCRequest` | `DetectionResult` | RuleEngine, StatisticalEngine, DecisionRouter | `需补全` | ① 正确提取 tool_name 和 arguments ② Promise.all 并行调用双引擎 ③ 结果包含 score/decision/triggeredRules ④ 延迟 < 50ms |
| MPC-06 | `buildBlockResponse()` 拦截响应构造 | P0 | `JSONRPCRequest`, `DetectionResult` | `JSONRPCResponse` (error) | 无 | `可直接用` | ① error.code = -32000 ② error.data 包含 reason/rules/score/timestamp ③ JSON-RPC 2.0 格式正确 |
| MPC-07 | `injectSecurityMarkers()` 安全标记注入 | P1 | `JSONRPCResponse` | `JSONRPCResponse` (enhanced) | 无 | `需补全` | ① V0 在 response.result.content 追加审计标记 ② 不破坏原始响应结构 |
| MPC-08 | `gracefulShutdown()` 优雅关闭 | P1 | `ProxySession` | `void` | 无 | `需补全` | ① 正确 kill 子进程 ② 关闭管道流 ③ 清理资源不抛异常 |
| MPC-09 | `tools/list` 直接转发 | P0 | `JSONRPCRequest` (method=tools/list) | 原样转发到 Server | 无 | `可直接用` | tools/list 请求不触发检测，直接写到 serverIn |
| MPC-10 | 非工具调用消息 (`resources/*`, `prompts/*`, `notifications/*`) 直接转发 | P0 | `JSONRPCRequest` | 原样转发 | 无 | `可直接用` | 所有非 tools/call 请求直接转发 |
| MPC-11 | 序列号生成 (`sequence_no`) | P1 | 无 | 递增序号 | 无 | `待实现` | 每个 tools/call 分配递增 sequence_no，支持会话级重置 |
| MPC-12 | Session ID 生成 (`generateULID`) | P0 | 无 | ULID 字符串 | `ulid` 库或自实现 | `待实现` | 生成唯一 sessionId，启动时分配 |

### 代码状态标注 (MCP Proxy Core)

| 代码块 | 行号 | 完成度 | 状态 | 需补充内容 |
|--------|------|--------|------|-----------|
| 接口定义 (4个) | 341-407 | 100% | `可直接用` | 无 |
| MCPProxyCore 类实现 | 411-588 | 75% | `需补全` | 12处具体问题：方法名不一致、依赖类未定义、错误处理缺失 |
| 本地 API 接口 (5个) | 5006-5075 | 100% | `可直接用` (契约) | 需各模块实现类 |

### 关键跨模块依赖问题

```
⚠️ 方法名不一致（必须修复）:
  - Proxy 调用: ruleEngine.evaluate() → IRuleEngine 定义: match()
  - Proxy 调用: statEngine.evaluate() → IStatEngine 定义: processEvent()
  - Proxy 调用: statEngine.update() → IStatEngine 未定义 update()

⚠️ 未定义的依赖类:
  - loadRules() 函数 (第428行)
  - loadThresholds() 函数 (第429行)
  - AsyncLogger 类 (第430行)
  - DecisionRouter 类 (第431行)
  - generateULID() 函数 (第435行)
```

---

## 2. L0 Rule Engine (29 项任务)

> **架构文档行号**: 751-1236 (核心实现), 1238-1377 (Trie/AC), 1380-1630 (内置规则库)

### 2.1 核心引擎

| 任务ID | 任务名称 | 优先级 | 输入接口 | 输出接口 | 依赖模块 | 代码状态 | 测试验收标准 |
|--------|---------|--------|---------|---------|---------|---------|-------------|
| L0-ENG-01 | `L0RuleEngine` 主类框架 | P0 | `RuleSet`, `DetectionEvent` | `RuleMatchResult[]` | 无 | `需补全` | 类可实例化，所有索引结构正确初始化 |
| L0-ENG-02 | `compileRuleSet()` 规则集编译 | P0 | `RuleSet` | `void` (填充索引) | L0-IDX-01~06 | `可直接用` | 编译 1000 条规则 < 100ms，跳过 disabled 规则 |
| L0-ENG-03 | `compileCondition()` 条件编译 | P0 | `RuleCondition` | `MatcherFn` | LRUCache | `可直接用` | 支持 9 种 MatchType: EXACT/PREFIX/CONTAINS/REGEX/SET/NUMERIC_RANGE/SEMVER_RANGE/GLOB/FUNCTION |
| L0-ENG-04 | `match()` 核心匹配入口 | P0 | `DetectionEvent` | `RuleMatchResult[]` | L0-ENG-05~09 | `可直接用` | P99 延迟 < 10ms，典型场景 0.5-3ms |
| L0-ENG-05 | `matchExactIndex()` 精确匹配 | P0 | `DetectionEvent` | 填充 results | L0-IDX-01 | `可直接用` | O(1) 查找，CRITICAL 短路返回 |
| L0-ENG-06 | `matchTrieIndex()` Trie 前缀匹配 | P0 | `DetectionEvent` | 填充 results | L0-IDX-02 | `可直接用` | O(L) 搜索，正确调用 TrieMatcher.search() |
| L0-ENG-07 | `matchACIndex()` AC 多模式匹配 | P0 | `DetectionEvent` | 填充 results | L0-IDX-03 | `可直接用` | O(N+M) 搜索，多字段拼接以 `\x00` 分隔 |
| L0-ENG-08 | `matchNumericRules()` 数值范围匹配 | P1 | `DetectionEvent` | 填充 results | 无 | `待实现` | 遍历 numericRules，解析并匹配数值范围 |
| L0-ENG-09 | `matchFunctionRules()` 自定义函数匹配 | P2 | `DetectionEvent` | 填充 results | 无 | `待实现` | V0 无 FUNCTION 规则，可留空 |
| L0-ENG-10 | `evaluateRule()` 规则评估 (AND/OR/NOT/MAJORITY/WEIGHTED_SUM) | P0 | `CompiledRule`, `DetectionEvent` | `RuleMatchResult \| null` | L0-ENG-11 | `可直接用` | 5 种逻辑正确实现 |
| **L0-ENG-11** | **`getFieldValue()` 字段提取** | **P0** | `DetectionEvent`, `FieldSource` | `unknown` | 无 | **待实现** | **阻塞项: 所有规则评估的基础，当前返回 undefined** |
| **L0-ENG-15** | **`indexRule()` 规则索引分发** | **P0** | `CompiledRule`, `Rule` | `void` | 所有索引 | **待实现** | **阻塞项: 当前为空函数，规则不进任何索引** |
| L0-ENG-12 | `extractFields()` 全字段提取 | P1 | `DetectionEvent` | `[string, unknown][]` | L0-ENG-11 | `待实现` | 提取 event 中所有可索引字段对 |
| L0-ENG-13 | `extractStringFields()` 字符串字段提取 | P1 | `DetectionEvent` | `[string, string][]` | L0-ENG-11 | `待实现` | 提取用于 Trie 匹配的字符串字段 |
| L0-ENG-14 | `extractTextFields()` 文本字段提取 | P1 | `DetectionEvent` | `[string, string][]` | L0-ENG-11 | `待实现` | 提取用于 AC 匹配的文本字段 |
| L0-ENG-16 | `parseNumericRange()` 数值范围解析 | P1 | `string` (如 `'[100000,Infinity)'`) | `{min, max}` | 无 | `待实现` | 支持 `[min,max)`, `(min,max]` 等区间格式 |
| L0-ENG-17 | `parseSemverRange()` 语义版本范围解析 | P2 | `string` | `any` | 无 | `待实现` | 支持 `^x.x.x`, `~x.x.x`, `>=x.x.x` 等 |
| L0-ENG-18 | `checkSemverInRange()` 版本范围检查 | P2 | `string`, `any` | `boolean` | L0-ENG-17 | `待实现` | 正确判断版本是否在指定范围内 |
| L0-ENG-19 | `globToRegex()` Glob 转正则 | P2 | `string` (glob 模式) | `string` (正则) | 无 | `待实现` | 支持 `*`, `?`, `**`, `[abc]` 等 |
| L0-ENG-20 | `updateLatencyStats()` 延迟统计 | P1 | `number` | `void` | 无 | `可直接用` | EWMA 平均延迟 + P99 估计 |

### 2.2 索引组件

| 任务ID | 任务名称 | 优先级 | 代码状态 | 测试验收标准 |
|--------|---------|--------|---------|-------------|
| L0-IDX-01 | `exactIndex` - Hash 精确索引 | P0 | `可直接用` | Map.get O(1)，内存 < 2MB/1000 规则 |
| L0-IDX-02 | `TrieMatcher` - Trie 前缀索引 | P0 | `可直接用` | 插入/搜索 O(L)，代码完整 (L1248-L1283) |
| L0-IDX-03 | `AhoCorasickMatcher` - AC 多模式索引 | P0 | `可直接用` | **需修复 AC-02: addPattern() 后不重置 built 标志** |
| L0-IDX-04 | `regexCache` - LRU 正则缓存 | P0 | `可直接用` | 缓存命中 O(1)，最大 1000 条 |
| L0-IDX-05 | `numericRules` - 数值范围规则数组 | P1 | `可直接用` | 线性遍历 |
| L0-IDX-06 | `functionRules` - 自定义函数规则数组 | P2 | `可直接用` | 线性遍历 |

### 2.3 V0 内置规则库

| 任务ID | 任务名称 | 优先级 | 代码状态 | 说明 |
|--------|---------|--------|---------|------|
| L0-RULE-01 | `V0_BUILTIN_RULES` 常量 (7条规则) | P0 | `可直接用` | 代码完整 (L1387-L1629) |
| L0-RULE-02 | `GOAL_HIJACK_001` - 关键词劫持检测 | P0 | `可直接用` | 含 "ignore previous instruction" 时 BLOCK |
| L0-RULE-03 | `GOAL_HIJACK_002` - 角色覆盖检测 | P0 | `可直接用` | 正则 + CONTAINS 双条件 OR 逻辑 |
| L0-RULE-04 | `PARAM_TAMPER_001` - 大额转账检测 | P0 | `可直接用` | 工具名=transfer + 金额 >= 100000 |
| L0-RULE-05 | `CHAIN_ABUSE_001` - 工具链滥用检测 | P1 | `可直接用` | 敏感工具 + 链深度 >= 3 |
| L0-RULE-06 | `PERM_PROBE_001` - 权限探测检测 | P1 | `需补全` | 连续失败 >= 3 次; FieldSource 需扩展 |
| L0-RULE-07 | `SUPPLY_CHAIN_001` - 供应链来源检测 | P1 | `可直接用` | 来源不在白名单时 WARN |
| L0-RULE-08 | `FREQ_001` - 极端频率检测 | P0 | `可直接用` | 1分钟调用 >= 100 次时 BLOCK |
| L0-RULE-09 | `PROMPT_INJ_001` - 分隔符注入检测 | P1 | `需补全` | 正则转义需验证 |

### 2.4 伪代码/省略清单 (L0)

| 行号 | 方法 | 当前状态 | 需补充逻辑 | 优先级 |
|------|------|---------|-----------|--------|
| 1216 | `extractFields()` | `return []` | 从 DetectionEvent 提取所有可索引字段对 | P1 |
| 1217 | `extractStringFields()` | `return []` | 提取所有字符串类型字段 | P1 |
| 1218 | `extractTextFields()` | `return []` | 提取所有长文本字段 | P1 |
| **1219** | **`getFieldValue()`** | **`return undefined`** | **按 FieldSource 路径从 DetectionEvent 取值 (如 `'argument.value'` → `event.argument.value`)** | **P0 阻塞** |
| 1220 | `parseNumericRange()` | `return {min:0, max:Infinity}` | 解析数值区间字符串 | P1 |
| 1221 | `parseSemverRange()` | `return null` | 解析语义版本范围 | P2 |
| 1222 | `checkSemverInRange()` | `return true` | 检查版本是否在范围内 | P2 |
| 1223 | `globToRegex()` | `return ''` | Glob 转正则表达式 | P2 |
| **1224** | **`indexRule()`** | **`空函数体`** | **根据 matchType 将规则分发到对应索引结构** | **P0 阻塞** |
| 1225 | `matchNumericRules()` | 空函数体 | 遍历 numericRules 数组匹配 | P1 |
| 1226 | `matchFunctionRules()` | 空函数体 | 遍历 functionRules 数组匹配 | P2 |

### 2.5 已知问题 (必须修复)

| 问题ID | 位置 | 严重程度 | 说明 | 修复方式 |
|--------|------|---------|------|---------|
| **AC-02** | `AhoCorasickMatcher.addPattern()` | **Moderate** | build() 后添加新模式不重置 `built` 标志，增量更新失效 | `addPattern()` 开头添加 `this.built = false;` |
| **FieldSource** | 第 811-826 行 | **Moderate** | 未包含 `metadata.consecutive_failures`，但 PERM_PROBE_001 规则使用了该字段 | 扩展 FieldSource 联合类型 |

---

## 3. L1 Statistical Engine (7 项任务)

> **架构文档行号**: 1632-2263

| 任务ID | 任务名称 | 优先级 | 输入接口 | 输出接口 | 依赖模块 | 代码状态 | 测试验收标准 |
|--------|----------|--------|----------|----------|----------|----------|--------------|
| L1-001 | `WelfordStats` - 在线均值方差计算 | P0 | `update(value: number)` | `getMean()`, `getVariance()`, `zScore()`, `anomalyScore()` | 无 | `可直接用` | 均值精度正确; std=0 时 zScore 返回 0; sigmoid 映射正确 |
| L1-002 | `ZScoreDetector` - 多维度 Z-score 检测 | P0 | `updateBaseline()`, `detect(dimensions)` | `ZScoreResult` | L1-001 | `可直接用` | 冷启动 (<30 样本) 保守评分; zScore>3 标记 anomaly; combinedScore>0.7 触发 |
| L1-003 | `SlidingWindowFrequency` - 滑动窗口频率 | P0 | `record(toolName, timestamp?)` | `getFrequency()`, `getAllFrequencies()` | 无 | `需补全` | 动态创建 bucket; advanceBuckets 环绕清零正确; 内存上限验证 |
| L1-004 | `MultiGranularityFrequency` - 多粒度频率 | P0 | `record(toolName, timestamp?)` | `getFrequency(toolName, window)` | L1-003 | `需补全` | 四窗口同时更新; 内存 ~40KB; 需补 `getAllFrequencies()` |
| L1-005 | `MarkovChainDetector` - Markov 链序列检测 | P1 | `train(sequence)`, `scoreSequence()`, `scoreTransition()` | `MarkovResult` | 无 | `需补全` | 1-gram/2-gram/3-gram 训练正确; unknownRatio>0.5 触发; alpha=0.1 smoothing |
| L1-006 | `CUSUMDetector` - 累积和检测 | **V1 Deferred** | `update(value)` | `CUSUMResult` | 无 | `可直接用` | 代码完整 (L1860-L1925)，V0 不启用 |
| L1-007 | `EWMADetector` - 指数加权移动平均 | **V1 Deferred** | `update(value)` | `EWMAResult` | 无 | `可直接用` | 代码完整 (L1951-L1999)，V0 不启用 |

### V0 简化版范围

```
V0 L1 Statistical Engine (简化版)
├── ✅ WelfordStats           P0, 可直接用, 100%
├── ✅ ZScoreDetector         P0, 可直接用, 95%
├── ⚠️ SlidingWindowFrequency P0, 需补全, 80% (缺序列化/时钟回拨处理)
├── ⚠️ MultiGranularityFrequency P0, 需补全, 70% (缺序列化/batch查询)
└── ⚠️ MarkovChainDetector    P1, 需补全, 85% (缺序列化/增量训练)

V1 新增 (V0 不包含):
├── ❌ CUSUMDetector          代码完整但 V0 不启用
└── ❌ EWMADetector           代码完整但 V0 不启用
```

### 关键接口清单 (L1)

| 行号 | 接口/类 | 说明 |
|------|---------|------|
| L1677 | `WelfordStats` class | 在线均值方差, 8 个方法 |
| L1739 | `ZScoreDetector` class | 多维度 Z-score 检测 |
| L1827 | `DimensionScore` interface | 单维度评分结果 |
| L1837 | `ZScoreResult` interface | Z-score 综合检测结果 |
| L1927 | `CUSUMResult` interface | CUSUM 检测结果 (V1) |
| L2002 | `EWMAResult` interface | EWMA 检测结果 (V1) |
| L2022 | `SlidingWindowFrequency` class | 滑动窗口频率统计 |
| L2096 | `MultiGranularityFrequency` class | 多粒度频率管理 |
| L2132 | `MarkovChainDetector` class | Markov 链序列检测 |
| L2255 | `MarkovResult` interface | Markov 评分结果 |

---

## 4. Decision Router (7 项任务)

> **架构文档行号**: 5612-5760 (RiskFusionEngine), 5800-5880 (FalsePositiveController), 2850-3001 (DetectionOrchestrator)

| 任务ID | 任务名称 | 优先级 | 输入接口 | 输出接口 | 依赖模块 | 代码状态 | 测试验收标准 |
|--------|---------|--------|---------|---------|---------|---------|-------------|
| DR-001 | `RiskFusionEngine.fuse()` 核心融合算法 | P0 | `Map<string, ScenarioScore>` | `FusionResult` (baseScore, enhancedScore, finalDecision) | L0, L1 | `需补全` | 10 场景加权融合误差 < 1e-6; 空 Map 返回 ALLOW; 延迟 < 0.01ms |
| DR-002 | 场景权重配置管理 | P1 | 配置文件 | 权重 Map | Config Manager | `需补全` | 默认权重和=1.0; 支持运行时更新; 异常时降级默认权重 |
| DR-003 | 组合增强逻辑 (3/5 条规则) | P0 | `Map<string, ScenarioScore>` | enhancedScore + triggeredCombinations | DR-001 | `需补全` | high_value_transfer 1.5x; coordinated_attack 1.4x; rapid_probing 1.3x |
| DR-004 | `FalsePositiveController` 动态阈值调整 | P0 | 用户反馈记录 | `ThresholdAdjustment` | 日志系统 | `需补全` | FPR>7.5% 阈值+0.02; FPR<2.5% 阈值-0.02; block∈[0.5,0.95], warn∈[0.2,0.8] |
| DR-005 | 最终决策输出格式化 | P1 | `FusionResult` + 各层结果 | 标准 JSON (L5894-L5994 格式) | DR-001 | `需补全` | JSON 严格匹配 schema; 含 fusion_result/scenario_scores/combination_analysis/detection_latency_ms |
| DR-006 | 关键场景兜底告警 | P1 | enhancedScore + activeScenarios | 可能覆盖为 WARN | DR-001 | `可直接用` | goal_hijacking/parameter_tampering 活跃 + score>=0.5 → WARN (L5739-L5741) |
| DR-007 | 检测延迟预算管控 | P0 | 各层检测耗时 | 总延迟 + 是否超预算 | 所有检测层 | `需补全` | L0<10ms; L0+L1<50ms; 超预算自动降级 |

### 代码状态 (Decision Router)

| 代码块 | 行号 | 完成度 | 状态 |
|--------|------|--------|------|
| RiskFusionEngine | 5628-5760 | 70% | `fuse()` 可用，需补全 confidence 计算 |
| 组合增强规则 | 5644-5672 | 75% | 3 条规则完整，缺 2 条 |
| FalsePositiveController | 5814-5880 | 78% | 核心算法完整，缺定时调度 |
| DetectionOrchestrator | 2856-2943 | 80% | 主流程完整，缺超时降级 |

---

## 5. Async Logger (8 项任务)

> **架构文档行号**: 4350-4392 (BehaviorLogEntry), 4744-4841 (DataMasker), 4847-4919 (HMAC), 5049-5062 (ILogger), 5260-5279 (云端上报 API)

| 任务ID | 任务名称 | 优先级 | 输入接口 | 输出接口 | 依赖模块 | 代码状态 | 测试验收标准 |
|--------|---------|--------|---------|---------|---------|---------|-------------|
| AL-001 | JSON Lines 本地存储引擎 | P0 | `BehaviorLogEntry` | `~/.agentwatch/log.jsonl` | 无 | `待实现` | 每条单行 JSON; 写入失败不丢日志; 支持并发; 路径可配置 |
| AL-002 | 日志轮转 (Rotation) | P0 | 日志文件 + 配置 | gzip 归档 | AL-001 | `待实现` | 每日轮转; 保留 7 天; 超期 gzip; maxSizeMB=100 时额外轮转 |
| AL-003 | 批量云端上报 (HTTP 简化版) | P1 | `BehaviorLogEntry[]` | HTTP POST `/v1/events/batch` | Config Manager | `待实现` | 批量最多 100 条; flush 间隔 5s; 退避重试 3 次; 异步不阻塞检测 |
| AL-004 | 参数脱敏 (DataMasker) | P0 | toolName + params + MaskingConfig | `MaskedParams` | Config Manager | `可直接用` | 4 级脱敏: FULL(0)/HASH(1)/TYPE(2)/DROP(3); 敏感字段列表正确 |
| AL-005 | HMAC 链式校验 | P2 | `BehaviorLogEntry` | 带 HMAC 签名的条目 | AL-001 | `可直接用` | 链式签名; 篡改可检测定位 (L4854-L4919 完整) |
| AL-006 | 日志查询接口 | P2 | `LogFilter` | `BehaviorLogEntry[]` | AL-001 | `待实现` | 按时间/sid/tid/tool/dec 过滤; 查询 < 100ms; 支持分页 |
| AL-007 | 日志缓冲区管理 | P1 | 实时事件流 | 缓冲的日志条目 | AL-001, AL-003 | `待实现` | 内存缓冲区默认 100 条; 满时自动 flush; 进程退出时 flush 剩余 |
| AL-008 | 性能指标采集 | P2 | 检测引擎运行时数据 | dur_ms, l0_rules, l1_scores | 所有检测层 | `需补全` | 调用耗时精确到 1ms; 命中规则 ID 和严重级别记录; L1 各算法得分 |

### 代码状态 (Async Logger)

| 代码块 | 行号 | 完成度 | 状态 |
|--------|------|--------|------|
| BehaviorLogEntry (Schema) | 4350-4392 | 100% | `可直接用` |
| ILogger (Interface) | 5049-5062 | 100% | `可直接用` |
| DataMasker.maskParams() | 4769-4834 | 71% | `可直接用` (核心逻辑完整) |
| HMACChainVerifier | 4854-4919 | 79% | `可直接用` (需补密钥管理) |
| JSON Lines Storage | — | 0% | `待实现` (全新实现) |
| Log Rotation | — | 0% | `待实现` (策略有定义，无实现) |
| Cloud Upload (HTTP) | — | 0% | `待实现` (V0 简化版) |

---

## 6. Config Manager (8 项任务)

> **架构文档行号**: 5065-5074 (IConfigManager 接口), 6000-6150 (部署配置)

| 任务ID | 任务名称 | 优先级 | 输入接口 | 输出接口 | 依赖模块 | 代码状态 | 测试验收标准 |
|--------|---------|--------|---------|---------|---------|---------|-------------|
| CFG-01 | `IConfigManager.get<T>(key)` 实现 | P0 | `string` (点号路径) | `T` | 无 | `待实现` | 支持 `detection.ruleEngine.enabled` 路径; 类型安全; 不存在返回 undefined |
| CFG-02 | `IConfigManager.set<T>(key, value)` 实现 | P1 | `string`, `T` | `void` | 无 | `待实现` | 运行时修改即时生效; 不自动持久化 |
| CFG-03 | `IConfigManager.reload()` 实现 | P1 | 无 | `void` | YAML 解析器 | `待实现` | 重新读取配置文件; 失败保留旧配置; 成功替换内存配置 |
| CFG-04 | YAML 配置文件解析器 | P0 | `~/.agentwatch/config.yaml` | 配置对象 | `js-yaml` | `待实现` | 正确解析 YAML; 支持 `${ENV}` 替换; `~` 展开; 文件不存在抛错 |
| CFG-05 | 配置 Schema 验证 | P0 | 解析后的配置对象 | 验证后配置 | `zod` 或 `joi` | `待实现` | 必填字段存在; 默认值填充; 无效配置清晰错误 |
| CFG-06 | CLI 参数解析 (`--config` 路径) | P0 | `process.argv` | 配置文件路径 | `commander` | `待实现` | `--config <path>`; 无参时默认路径; `--` 后是被代理命令 |
| CFG-07 | 配置热加载 (文件监听) | P2 | 配置文件路径 | 自动 reload 事件 | `fs.watch` | `待实现` | V0 可 defer; 变更后自动 reload; 防抖 500ms |
| CFG-08 | MCP 配置集成辅助 | P2 | `ProxyConfig` | JSON 配置片段 | 无 | `待实现` | 输出符合 Cursor/Claude MCP 配置格式 |

### 关键说明

**Config Manager 架构文档仅有接口定义 (IConfigManager, 3 个方法)，无任何实现代码。V0 需 100% 全新实现。**

---

## 7. Monorepo 项目目录结构

```
agentwatch/
├── README.md
├── package.json                    # workspaces 配置
├── tsconfig.json
├── tsconfig.base.json
├── pnpm-workspace.yaml
├── .cursorrules                    # Cursor AI 全局规则
│
├── packages/
│   ├── shared/                     # ======== 共享层 ========
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── types/
│   │   │   │   ├── index.ts
│   │   │   │   ├── detection.ts    # ToolCallEvent, DetectionEvent, DetectionResult
│   │   │   │   ├── rules.ts        # Rule, RuleCondition, RuleMatchResult, RuleSet
│   │   │   │   ├── stats.ts        # ZScoreResult, CUSUMResult, EWMAResult, MarkovResult
│   │   │   │   ├── fusion.ts       # ScenarioScore, FusionResult, CombinationRule
│   │   │   │   ├── logging.ts      # BehaviorLogEntry, MaskedParams, MaskLevel
│   │   │   │   ├── profile.ts      # UserProfile, UserConfig, BaselineCache
│   │   │   │   └── api.ts          # ILogger, IConfigManager, IDetectionEngine, IRuleEngine
│   │   │   ├── utils/
│   │   │   │   ├── crypto.ts       # SHA-256, HMAC
│   │   │   │   ├── jsonl.ts        # JSON Lines 序列化
│   │   │   │   └── math.ts         # 统计计算工具
│   │   │   └── constants/
│   │   │       ├── index.ts        # 阈值默认值
│   │   │       └── scenarios.ts    # 检测场景枚举
│   │   └── tests/
│   │
│   ├── local/                      # ======== 本地层 (MCP 中间件) ========
│   │   ├── package.json            # 依赖: shared, byline, js-yaml, ulid
│   │   ├── tsconfig.json
│   │   ├── cli.ts                  # CLI 入口 (npx @agentwatch/mcp-proxy)
│   │   └── src/
│   │       ├── proxy/
│   │       │   ├── index.ts        # MCPProxyCore 类 (L411-L588)
│   │       │   └── session.ts      # 会话管理 (generateULID 等)
│   │       ├── detection/
│   │       │   ├── orchestrator.ts # DetectionOrchestrator (L2856-2943)
│   │       │   ├── l0-rule-engine.ts   # L0RuleEngine + TrieMatcher + AhoCorasickMatcher + LRUCache
│   │       │   ├── l1-stat-engine.ts   # WelfordStats + ZScoreDetector + SlidingWindowFrequency + Markov
│   │       │   └── rules/
│   │       │       └── builtin.ts  # V0_BUILTIN_RULES (L1387-L1629)
│   │       ├── decision/
│   │       │   ├── fusion-engine.ts    # RiskFusionEngine (L5628-5760)
│   │       │   ├── fp-controller.ts    # FalsePositiveController (L5814-5880)
│   │       │   └── formatter.ts        # 最终输出格式化 (L5894-5994)
│   │       ├── logging/
│   │       │   ├── async-logger.ts     # AsyncLogger (实现 ILogger)
│   │       │   ├── local-store.ts      # JSON Lines 本地存储 (V0 全新实现)
│   │       │   ├── rotation.ts         # 日志轮转 (V0 全新实现)
│   │       │   ├── cloud-uploader.ts   # HTTP 批量上报 (V0 简化版)
│   │       │   ├── data-masker.ts      # DataMasker (L4769-4834)
│   │       │   └── hmac-chain.ts       # HMACChainVerifier (L4854-4919)
│   │       ├── config/
│   │       │   ├── config-manager.ts   # ConfigManager (实现 IConfigManager, V0 全新实现)
│   │       │   ├── loader.ts           # YAML 加载 + 环境变量替换
│   │       │   ├── validator.ts        # Schema 验证
│   │       │   └── schema.ts           # TypeScript Config 类型定义
│   │       └── utils/
│   │           └── paths.ts            # ~/.agentwatch/ 路径管理
│   │
│   └── cloud/                      # ======== 云端层 (V0 占位) ========
│       ├── package.json
│       └── src/
│           └── ingestion/
│               └── events.ts       # V0: 仅实现 /v1/events/batch 接收接口
│
├── configs/
│   ├── config.yaml.example         # 配置模板 (L6020-L6129)
│   └── mcp-config.json.example     # MCP 配置模板 (L6133-L6149)
│
└── scripts/
    └── build.sh
```

---

## 8. 代码状态总览

### 8.1 按模块统计

| 模块 | 架构代码行数 | 可直接用行数 | 需补全行数 | 待实现行数 | 完成度 |
|------|------------|------------|-----------|-----------|--------|
| **接口/类型定义** | ~105 | ~105 | 0 | 0 | **100%** |
| **MCP Proxy Core** | ~178 | ~100 | ~60 | ~18 | **75%** |
| **L0 Rule Engine** | ~400 | ~280 | ~50 | ~70 | **70%** |
| **L1 Statistical Engine** | ~350 | ~250 | ~80 | ~20 | **71%** |
| **Decision Router** | ~260 | ~190 | ~70 | 0 | **73%** |
| **Async Logger** | ~220 | ~65 | ~10 | ~145 | **30%** |
| **Config Manager** | ~15 | ~15 | 0 | ~40 | **27%** |
| **总计** | **~1528** | **~1005** | **~270** | **~293** | **~66%** |

### 8.2 伪代码 vs 可用代码清单

| 状态 | 说明 | 代表性代码块 |
|------|------|------------|
| `可直接用` | 代码完整，可直接复制到项目中 | 所有接口定义; WelfordStats; ZScoreDetector; TrieMatcher; AhoCorasickMatcher (需修复AC-02); LRUCache; V0_BUILTIN_RULES; DataMasker; HMACChainVerifier; RiskFusionEngine.fuse(); FalsePositiveController |
| `需补全` | 核心逻辑完整，有省略边界处理 | MCPProxyCore 类 (缺错误处理); L0RuleEngine (3个空方法); SlidingWindowFrequency (缺序列化); ZScoreDetector (stat['count'] 访问私有字段) |
| `待实现` | 只有接口/文档，无实现代码 | ConfigManager (100% 待实现); JSON Lines 存储; 日志轮转; HTTP 云端上报; ULID 生成; getFieldValue(); indexRule() |

---

## 9. Cursor 提示词模板

### 9.1 MCP Proxy Core

```markdown
# Cursor AI Prompt: MCP Proxy Core

## 模块职责
MCP Proxy Core 是 AgentWatch 的中间件入口，负责在 MCP Client 和 MCP Server 之间透传 JSON-RPC 消息，拦截 tools/call 请求并调用检测引擎。采用 stdio 代理模式，对用户完全透明。

## 架构文档引用
- 接口定义: 行 341-407 (ProxyConfig, ProxySession, JSONRPCRequest, JSONRPCResponse)
- 核心实现: 行 411-588 (MCPProxyCore 类)
- 本地 API 接口: 行 5006-5075 (IDetectionEngine, IRuleEngine, IStatisticalEngine, ILogger, IConfigManager)
- 部署配置: 行 6000-6150

## 输入接口
- STDIO: MCP Client 发来的 JSON-RPC 2.0 消息
- 配置文件: ~/.agentwatch/config.yaml (行 6020-6129)
- 环境变量: OKX_API_KEY, OKX_SECRET_KEY, OKX_PASSPHRASE, AGENTWATCH_API_KEY

## 输出接口
- STDIO: 转发给 MCP Server / 返回给 MCP Client
- 检测事件: 调用 DetectionOrchestrator.detect(event)
- 日志: 调用 ILogger.logBlocked() / logAllowed()

## 性能要求
- 消息透传延迟: < 1ms (不含检测)
- 含检测总延迟: < 50ms (L0+L1)
- 内存: < 50MB

## 测试要求
- [ ] JSON-RPC 透传正确性 (请求/响应 ID 匹配)
- [ ] tools/call 拦截触发检测流程
- [ ] BLOCK 决策正确拒绝请求
- [ ] 非 tools/call 请求直接转发
- [ ] 子进程崩溃后优雅恢复

## 依赖模块
- packages/local/src/detection/orchestrator.ts
- packages/shared/src/types/api.ts (ILogger)
- packages/local/src/config/config-manager.ts

## 代码约束
- TypeScript 5.x, Node.js >= 18
- 使用 byline 库处理 STDIO 逐行读取
- 所有异步操作有超时控制
- 方法名统一: Proxy 中使用 match() 对应 IRuleEngine, processEvent() 对应 IStatisticalEngine

## 已知问题 (需修复)
1. 行 500-507: ruleEngine.evaluate() → 应改为 match() (与 IRuleEngine 接口一致)
2. 行 500-507: statEngine.evaluate() → 应改为 processEvent() (与 IStatEngine 接口一致)
3. 行 480: statEngine.update(request) → 方法未在接口定义中声明
4. 行 435: generateULID() → 需引入 ulid 库实现
```

### 9.2 L0 Rule Engine

```markdown
# Cursor AI Prompt: L0 Rule Engine

## 模块职责
L0 Rule Engine 是 AgentWatch 的第一道防线，基于预定义规则对工具调用进行快速模式匹配。必须在 < 10ms 内完成所有规则匹配，是系统的"硬拦截"层。

## 架构文档引用
- 规则定义: 行 792-894 (RuleSeverity, RuleAction, MatchType, FieldSource, RuleCondition, Rule, RuleMatchResult, RuleSet)
- 编译后类型: 行 905-924 (CompiledRule, CompiledCondition, MatcherFn)
- 核心实现: 行 926-1227 (L0RuleEngine 类)
- Trie 实现: 行 1248-1283 (TrieMatcher)
- AC 实现: 行 1296-1377 (AhoCorasickMatcher)
- LRU 缓存: 行 1230-1235 (LRUCache)
- 内置规则: 行 1387-1629 (V0_BUILTIN_RULES)

## 输入接口
- DetectionEvent: { toolName, arguments, timestamp, userId, sessionId }
- RuleSet: 加载的规则集 (YAML/JSON)
- 配置: enabled, maxMatchTimeMs

## 输出接口
- RuleMatchResult[]: 命中结果含 ruleId, action, confidence, severity

## 性能要求
- 单条规则匹配: < 0.1ms
- 全量规则匹配: < 10ms (硬性)
- 1000 条规则编译: < 100ms

## 测试要求
- [ ] 每条内置规则至少 2 个用例 (命中/未命中)
- [ ] Trie 前缀匹配边界 (空模式/空文本/Unicode)
- [ ] AC 多模式匹配 (需修复 AC-02: addPattern 后重置 built)
- [ ] 规则优先级: BLOCK > WARN > ALLOW
- [ ] 5 种条件逻辑: AND/OR/NOT/MAJORITY/WEIGHTED_SUM

## 阻塞项 (P0, 必须实现)
1. getFieldValue() (行 1219): 当前返回 undefined, 需实现 FieldSource 路径解析
2. indexRule() (行 1224): 当前空实现, 需按 matchType 分发到对应索引

## 代码约束
- 9 种 MatchType: EXACT/PREFIX/CONTAINS/REGEX/SET/NUMERIC_RANGE/SEMVER_RANGE/GLOB/FUNCTION
- 使用 Trie + Aho-Corasick + Hash Map 多维索引
- LRUCache 缓存正则表达式 (最大 1000)
- 短路优化: CRITICAL 规则命中立即返回
```

### 9.3 L1 Statistical Engine

```markdown
# Cursor AI Prompt: L1 Statistical Engine

## 模块职责
L1 Statistical Engine 是 AgentWatch 的第二道防线，基于用户行为基线进行统计异常检测。V0 实现 Z-score + 滑动窗口频率 + Markov 链 (P1)。

## 架构文档引用
- WelfordStats: 行 1677-1731
- ZScoreDetector: 行 1739-1825
- SlidingWindowFrequency: 行 2022-2088
- MultiGranularityFrequency: 行 2096-2115
- MarkovChainDetector: 行 2132-2252
- 接口: 行 1827, 1837, 2002, 2255 (DimensionScore, ZScoreResult, EWMAResult, MarkovResult)
- V0 简化声明: 行 6548-6549 (无 CUSUM/EWMA, 静态阈值)

## 输入接口
- ToolCallEvent: { toolName, timestamp, chainDepth, argumentCount, arguments, userId, sessionId, agentId }
- 配置: zScoreThreshold=3.0, windowSizeMs=300000

## 输出接口
- L1DetectionResult: { zScore, frequency, markov, combinedScore, isAnomaly, latencyMs }

## V0 范围 (重要)
```
V0 保留: WelfordStats(P0), ZScoreDetector(P0), SlidingWindowFrequency(P0), MultiGranularityFrequency(P0), MarkovChainDetector(P1)
V0 不实现: CUSUMDetector(V1), EWMADetector(V1)
```

## 测试要求
- [ ] Welford: 均值/方差/Z-score 数值正确; std=0 时 zScore 返回 0
- [ ] ZScore: 冷启动 (<30 样本) 保守评分; zScore>3 标记 anomaly
- [ ] SlidingWindow: 桶跨越清零正确; 环绕处理; 内存上限
- [ ] Markov: 1-gram/2-gram 训练; unknownRatio>0.5 触发

## 已知代码问题
1. ZScoreDetector 行 1766: stat['count'] 用字符串索引访问 private 字段 → 改为 getter
2. SlidingWindowFrequency: 缺序列化/反序列化 (V0 可 defer)
3. MarkovChainDetector: 热路径上 Array.from().reduce() 应缓存优化
```

### 9.4 Decision Router

```markdown
# Cursor AI Prompt: Decision Router

## 模块职责
Decision Router 是检测系统的决策中枢，将 L0/L1/L2/L3 的多维检测结果融合为统一的 ALLOW/BLOCK/WARN 决策。延迟预算仅 0.01ms。

## 架构文档引用
- RiskFusionEngine: 行 5628-5760
- 组合增强: 行 5788-5798
- FalsePositiveController: 行 5800-5880
- 输出格式: 行 5892-5994
- 部署配置: 行 6066-6071

## 输入接口
- Map<string, ScenarioScore>: 各场景得分
- 配置: blockThreshold=0.8, warnThreshold=0.5, ruleWeight=0.6, statWeight=0.4

## 输出接口
- FusionResult: { baseScore, enhancedScore, finalDecision, threshold, activeScenarios, triggeredCombinations, scenarioBreakdown, confidence }

## 测试要求
- [ ] 10 场景加权融合权重和=1
- [ ] 组合增强: high_value_transfer 1.5x, coordinated_attack 1.4x, rapid_probing 1.3x
- [ ] 阈值: score>=0.8 → BLOCK; score>=0.5 → WARN
- [ ] 兜底: goal_hijacking/parameter_tampering 活跃 + score>=0.5 → WARN
- [ ] FPR 控制: >7.5% 阈值+0.02; <2.5% 阈值-0.02

## 需补全
1. calculateConfidence() 具体实现
2. 2 条缺失的组合增强规则
3. FalsePositiveController 定时调度 (每 24h)
```

### 9.5 Async Logger

```markdown
# Cursor AI Prompt: Async Logger

## 模块职责
异步日志系统，将检测事件以 JSON Lines 格式本地持久化，支持批量云端上报。保证"零丢日志"。

## 架构文档引用
- BehaviorLogEntry: 行 4350-4392
- ILogger: 行 5049-5062
- DataMasker: 行 4744-4841
- HMAC: 行 4847-4919
- 云端 API: 行 5260-5279
- 部署配置: 行 6081-6099

## 输入接口
- JSONRPCRequest + DetectionResult → logBlocked/logAllowed
- 配置: level, format, output, maxSizeMB, maxFiles, mask.level

## 输出接口
- 本地: ~/.agentwatch/log.jsonl
- 云端: HTTP POST /v1/events/batch (异步, V0 简化版)

## 性能要求
- 单条写入: < 1ms
- 批量上报: 不阻塞检测流程
- 缓冲区: 默认 100 条

## V0 范围
- DataMasker.maskParams(): `可直接用` (行 4769-4834)
- HMACChainVerifier: `可直接用` (行 4854-4919)
- JSON Lines 存储: `待实现` (全新)
- 日志轮转: `待实现` (全新)
- HTTP 上报: `待实现` (简化版)

## 测试要求
- [ ] JSON Lines 格式正确
- [ ] 4 级脱敏: FULL/HASH/TYPE/DROP
- [ ] 日志轮转: 每日 + 保留 7 天 + gzip
- [ ] 批量: 100 条 flush, 5s 间隔
- [ ] 故障: 退避重试, 本地缓冲
- [ ] 进程退出: SIGTERM 时 flush 剩余
```

### 9.6 Config Manager

```markdown
# Cursor AI Prompt: Config Manager

## 模块职责
配置中枢，加载/校验/热更新所有配置。配置来源: YAML 文件 (~/.agentwatch/config.yaml) / 环境变量 / 默认值。

## 架构文档引用
- IConfigManager: 行 5065-5074 (3 个方法: get/set/reload)
- 配置格式: 行 6020-6129
- MCP 集成: 行 6133-6149

## 输入接口
- 文件: ~/.agentwatch/config.yaml
- 环境变量: ${OKX_API_KEY}, ${OKX_SECRET_KEY}, ${OKX_PASSPHRASE}, ${AGENTWATCH_API_KEY}
- CLI: --config <path>

## 输出接口
- 配置对象: AgentWatchConfig (完整类型)
- 变更通知: 订阅者模式

## V0 范围 (100% 待实现)
架构文档仅有接口定义，无任何实现代码。需实现:
1. YAML 解析 (js-yaml)
2. 环境变量替换 (${VAR} → process.env.VAR)
3. 路径展开 (~ → os.homedir())
4. Schema 验证 (zod)
5. 默认值填充
6. 点号路径访问 (get('detection.ruleEngine.enabled'))

## 测试要求
- [ ] YAML 解析正确
- [ ] 环境变量替换
- [ ] 默认值回退
- [ ] 配置校验
- [ ] 嵌套读取
```

---

## 10. V0 MVP 实施路线图

### Phase 1 — 基础设施 (Day 1-2)

```
Day 1:
  [ ] 搭建 monorepo 结构 (package.json, tsconfig, pnpm-workspace)
  [ ] 实现 shared/types/* (所有接口定义 — 可直接用)
  [ ] CFG-04: YAML 配置解析器
  [ ] CFG-05: Schema 验证
  [ ] CFG-06: CLI 参数解析

Day 2:
  [ ] CFG-01: ConfigManager.get() 实现
  [ ] AL-001: JSON Lines 本地存储 (全新实现)
  [ ] AL-004: DataMasker 集成 (代码可直接用)
  [ ] 基础工具函数 (crypto, jsonl, math)
```

### Phase 2 — 检测引擎 (Day 2-4)

```
Day 2-3 (L0 Rule Engine — 阻塞项优先):
  [ ] L0-ENG-11: getFieldValue() 实现 *** P0 阻塞
  [ ] L0-ENG-15: indexRule() 实现 *** P0 阻塞
  [ ] L0-ENG-12~14: extract*Fields() 实现
  [ ] 修复 AC-02: AhoCorasickMatcher built 标志
  [ ] 扩展 FieldSource: 添加 metadata.consecutive_failures

Day 3-4 (L0 完善 + L1 核心):
  [ ] L0-ENG-08: matchNumericRules() 实现
  [ ] L0-ENG-16: parseNumericRange() 实现
  [ ] L0-RULE-01~09: 内置规则集成测试
  [ ] L1-001: WelfordStats (可直接用)
  [ ] L1-002: ZScoreDetector (可直接用)
  [ ] L1-003: SlidingWindowFrequency (需补全边界)
```

### Phase 3 — 决策 + 日志完善 (Day 4-5)

```
Day 4:
  [ ] L1-004: MultiGranularityFrequency
  [ ] L1-005: MarkovChainDetector (P1)
  [ ] DR-001: RiskFusionEngine.fuse()
  [ ] DR-003: 组合增强逻辑 (3 条规则)
  [ ] DR-004: FalsePositiveController

Day 5:
  [ ] MPC-01~02: 接口定义
  [ ] MPC-03~04: MCPProxyCore 构造函数 + startRelay
  [ ] MPC-05: handleToolCall (检测调度)
  [ ] 修复方法名不一致 (evaluate→match, evaluate→processEvent)
```

### Phase 4 — 集成 + 测试 (Day 5-7)

```
Day 5-6:
  [ ] AL-002: 日志轮转
  [ ] AL-003: HTTP 批量上报 (简化版)
  [ ] DR-005: 输出格式化
  [ ] MPC-06~10: 响应处理 + 转发逻辑
  [ ] MPC-12: ULID 生成

Day 6-7:
  [ ] 端到端集成测试
  [ ] 性能基准测试 (L0 < 10ms, L0+L1 < 50ms)
  [ ] npm 包打包
  [ ] MCP 配置集成验证
```

---

## 11. 风险与阻塞项汇总

| 优先级 | 阻塞项 | 影响 | 解决方式 |
|--------|--------|------|---------|
| **P0** | `getFieldValue()` 返回 undefined | 所有规则评估永远 false | 实现 FieldSource 路径解析 |
| **P0** | `indexRule()` 空实现 | 规则不进任何索引，引擎无法工作 | 按 matchType 分发到索引 |
| **P0** | 方法名不一致 (evaluate vs match/processEvent) | 编译错误 | 统一方法名 |
| P1 | AC-02: addPattern 不重置 built | 增量更新规则后搜索失效 | 添加 `this.built = false` |
| P1 | FieldSource 缺 metadata.consecutive_failures | PERM_PROBE_001 规则无法工作 | 扩展联合类型 |
| P1 | ConfigManager 100% 待实现 | 所有模块依赖配置 | Phase 1 优先实现 |
| P1 | JSON Lines 存储 100% 待实现 | 日志无法持久化 | Phase 1 全新实现 |

---

## Week1 Day7 源码落地同步（2026-07-04）

### 全局常量收拢

所有性能阈值、RiskType、FIFO 参数、融合权重已收拢至 `packages/shared/constants.ts`（原 `constants/index.ts` 已合并）。

### 扩展能力（已实现，文档对齐）

| 扩展 | 源码位置 | 架构章节 |
|------|----------|----------|
| FIFO 双流管道 | `bootstrap.ts` GatewayClientInput + pumpExternalPipe | 产品架构 §5.1 |
| JSON 修复层 | `repairGatewayJsonSyntax` / `normalizeGatewayJsonLine` | 产品架构 §5.2 |
| Markov 会话 LRU | `StatEngine.evictSessionTrackersIfNeeded` | task_l1_engine L1-005 / 产品架构 §5 |
| 背压队列 | `AsyncLogger.enqueue` + `MAX_PERSISTED_MEMORY_BYTES` | task_router AL-002 |

### P0 阻塞项状态（Week1 已修复）

| 阻塞项 | 状态 | 源码 |
|--------|------|------|
| getFieldValue() | ✅ 已实现 | `RuleEngine.ts` |
| indexRule() | ✅ 已实现 | `RuleEngine.ts` |
| evaluate→match/processEvent | ✅ 已统一 | `MCPProxyCore.ts` |

### 测试 / 性能

- `npm run test`：**172** 项全通过  
- L0 P99 < 10ms、L1+L0 < 50ms：单元测试 + `[perf]` 埋点验证  

### 十大场景 V0 缺口明细

| 场景 | 落地 | 缺口 |
|------|------|------|
| 意图劫持 | L0 GOAL_HIJACK_* | 无 L2 语义 |
| 参数篡改 | L0 PARAM_TAMPER_001 | 仅 transfer 大额 |
| 工具链滥用 | L0 CHAIN_ABUSE_001 + L1 Markov | chain_depth 注入依赖 Proxy |
| 频率异常 | L0 FREQ_001 + L1 四窗口 | 无自适应基线 |
| 供应链投毒 | L0 SUPPLY_CHAIN_001 | 静态白名单 |
| Prompt Injection | L0 PROMPT_INJ_001 | 无 FP 控制器持久化 |
| A2A 风险 | — | **V1+ 未实现** |
| 权限试探 | L0 PERM_PROBE_001 | metadata.consecutive_failures |
| 耗时异常 | L1 latency 维度 | 无独立 L0 规则 |
| 基线偏离 | L1 Z-score | 无 SQLite / 增量学习 |

### Week1 完工结论

文档（README / operation_troubleshoot / npm_publish_guide）、打包配置（package.json / .npmignore / tsconfig.build.json）就绪，**可进入 Week2-3**（SQLite、云端上报、CLI 优化）。

---

*本任务清单严格基于架构文档 `agentwatch_architecture.md` 的逐行分析生成，所有接口定义、代码行号、完成度评估均来自原文档。未臆造任何不存在的接口或功能。*
