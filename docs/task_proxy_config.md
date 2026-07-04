# AgentWatch 工程任务清单：MCP Proxy Core + Config Manager

> 分析范围：V0 MVP
> 来源文档：`agentwatch_architecture.md`
> 分析行号范围：260-410, 410-588, 5000-5075, 6000-6150

---

## 1. MCP Proxy Core 工程任务清单

### 模块概述
MCP Proxy Core 是 AgentWatch 的入口和出口模块，采用 stdio 代理模式，负责拦截 MCP Client 发来的所有 JSON-RPC 请求，解析 `tools/call` 请求，调用检测引擎进行安全检测，根据检测结果决定放行、拦截或挑战，并将响应返回给 MCP Client。

| 任务ID | 任务名称 | 优先级 | 输入接口 | 输出接口 | 依赖模块 | 代码状态 | 测试验收标准 |
|--------|---------|--------|---------|---------|---------|---------|-------------|
| MPC-01 | `ProxyConfig` / `ProxySession` / `JSONRPCRequest` / `JSONRPCResponse` 接口定义 | P0 | 无 | 4个核心接口 | 无 | `可直接用` | TypeScript 编译通过，接口字段与文档一致 |
| MPC-02 | `DetectionResult` / `TriggeredRule` / `StatAnomaly` / `SecurityMarker` 接口定义 | P0 | 无 | 4个检测结果接口 | 无 | `可直接用` | TypeScript 编译通过，包含所有文档定义字段 |
| MPC-03 | `MCPProxyCore` 类构造函数与 `start()` 方法 | P0 | `ProxyConfig` | `ProxySession` | Config Manager(MPC-15), Rule Engine, Statistical Engine, AsyncLogger, DecisionRouter | `需补全` | ① 能成功 spawn 子进程 ② session 对象组装正确 ③ 错误时抛出并清理 |
| MPC-04 | `startRelay()` 双向管道中继 | P0 | `Readable` (clientIn, serverOut) | `Writable` (clientOut, serverIn) | `byline` 库 | `需补全` | ① Client->Server 方向能正确解析 JSON-RPC ② 非 tools/call 请求直接转发 ③ Server->Client 方向响应正确回传 |
| MPC-05 | `handleToolCall()` 工具调用拦截与检测调度 | P0 | `JSONRPCRequest` | `DetectionResult` | Rule Engine(`evaluate`), Statistical Engine(`evaluate`), Decision Router(`decide`) | `需补全` | ① 正确提取 tool_name 和 arguments ② Promise.all 并行调用双引擎 ③ 综合决策结果包含 score/decision/triggeredRules/statAnomalies ④ 延迟 < 50ms |
| MPC-06 | `buildBlockResponse()` 拦截响应构造 | P0 | `JSONRPCRequest`, `DetectionResult` | `JSONRPCResponse` (error) | 无 | `可直接用` | ① error.code = -32000 ② error.data 包含 reason/triggeredRules/score/timestamp/helpUrl ③ JSON-RPC 2.0 格式正确 |
| MPC-07 | `injectSecurityMarkers()` 安全标记注入 | P1 | `JSONRPCResponse` | `JSONRPCResponse` (enhanced) | 无 | `需补全` | ① V0 在 response.result.content 追加审计标记 ② 不破坏原始响应结构 ③ 注入文本符合格式 |
| MPC-08 | `gracefulShutdown()` 优雅关闭 | P1 | `ProxySession` | `void` | 无 | `需补全` | ① 正确 kill 子进程 ② 关闭管道流 ③ 清理 session 资源 ④ 不抛异常 |
| MPC-09 | 工具调用 `tools/list` 直接转发 | P0 | `JSONRPCRequest` (method=tools/list) | 原样转发到 Server | 无 | `可直接用` | ① tools/list 请求不触发检测 ② 直接写到 serverIn |
| MPC-10 | 非工具调用消息 (`resources/*`, `prompts/*`, `notifications/*`) 直接转发 | P0 | `JSONRPCRequest` | 原样转发 | 无 | `可直接用` | ① 所有非 tools/call 请求直接转发 ② 不修改消息内容 |
| MPC-11 | 行号序列号生成 (`sequence_no`) | P1 | 无 | 递增序号 | 无 | `待实现` | 每个 tools/call 请求分配递增 sequence_no，支持会话级重置 |
| MPC-12 | Session ID 生成 (`generateULID`) | P0 | 无 | ULID 字符串 | `ulid` 库或自实现 | `待实现` | 生成唯一 sessionId，启动时分配，停止后保留 |

---

## 2. Config Manager 工程任务清单

### 模块概述
Config Manager 负责加载、解析和管理 AgentWatch 的配置文件（YAML 格式），为 MCP Proxy Core 及各检测引擎提供配置数据。架构文档中仅有接口定义 `IConfigManager` 和 YAML 配置格式示例，**无任何实现代码**。

| 任务ID | 任务名称 | 优先级 | 输入接口 | 输出接口 | 依赖模块 | 代码状态 | 测试验收标准 |
|--------|---------|--------|---------|---------|---------|---------|-------------|
| CFG-01 | `IConfigManager` 接口实现 — `get<T>(key)` | P0 | `string` (配置键路径) | `T` (配置值) | 无 | `待实现` | ① 支持点号路径访问 (如 `detection.ruleEngine.enabled`) ② 类型安全返回 ③ key 不存在时返回 undefined |
| CFG-02 | `IConfigManager` 接口实现 — `set<T>(key, value)` | P1 | `string`, `T` | `void` | 无 | `待实现` | ① 支持运行时修改配置 ② 修改后内存中即时生效 ③ 不自动持久化（V0 范围） |
| CFG-03 | `IConfigManager` 接口实现 — `reload()` | P1 | 无 | `void` | YAML 解析器 | `待实现` | ① 重新从磁盘读取配置文件 ② 解析失败时保留旧配置并记录 warn 日志 ③ 解析成功后替换内存配置 |
| CFG-04 | YAML 配置文件解析器 | P0 | 文件路径 (`~/.agentwatch/config.yaml`) | 解析后的配置对象 | `js-yaml` 库 | `待实现` | ① 正确解析 YAML 为 JS 对象 ② 支持 `${ENV_VAR}` 环境变量替换 ③ 文件不存在时抛出明确错误 ④ 支持 `~` 家目录展开 |
| CFG-05 | 配置 schema 验证 | P0 | 解析后的配置对象 | 验证后的配置 / 错误 | `zod` 或 `joi` | `待实现` | ① 所有必填字段存在且类型正确 ② 默认值填充（如 maxDetectionLatencyMs 默认 50）③ 无效配置时输出清晰错误信息 |
| CFG-06 | CLI 参数解析 (`--config` 路径) | P0 | `process.argv` | 配置文件绝对路径 | `commander` 或 `minimist` | `待实现` | ① 支持 `--config <path>` 参数 ② 无参数时尝试默认路径 `~/.agentwatch/config.yaml` ③ `--` 之后的参数作为被代理 MCP Server 的命令 |
| CFG-07 | 配置热加载（文件监听） | P2 | 配置文件路径 | 自动 reload 事件 | `fs.watch` 或 `chokidar` | `待实现` | ① V0 可 defer，V1 实现 ② 文件变更后自动调用 reload() ③ 防抖处理（500ms） |
| CFG-08 | MCP 配置集成辅助 — 生成 mcpServers JSON 配置 | P2 | `ProxyConfig` | JSON 配置片段 | 无 | `待实现` | ① 输出符合 Claude Desktop / Cursor MCP 配置格式 ② args 中正确插入 `@agentwatch/mcp-proxy` 及 `--config` 参数 |

---

## 3. 关键 TypeScript 接口清单

### 3.1 MCP Proxy Core 接口

| 接口名称 | 行号 | 定义范围 | 说明 |
|---------|------|---------|------|
| `ProxyConfig` | 344-361 | 接口定义 | 被代理的 MCP Server 命令 + AgentWatch 配置 + 性能配置 + 连接配置 |
| `ProxySession` | 363-388 | 接口定义 | 会话状态：子进程引用、管道流、检测组件引用、start/stop/handleToolCall 方法 |
| `JSONRPCRequest` | 390-395 | 接口定义 | MCP JSON-RPC 2.0 请求格式 |
| `JSONRPCResponse` | 397-406 | 接口定义 | MCP JSON-RPC 2.0 响应格式（含 error 结构） |
| `DetectionResult` | 559-566 | 接口定义 | 检测结果：decision/score/triggeredRules/statAnomalies/markers/blockReason |
| `TriggeredRule` | 568-573 | 接口定义 | 触发规则详情：ruleId/ruleName/severity/matchedValue |
| `StatAnomaly` | 575-581 | 接口定义 | 统计异常详情：metricName/metricType/observedValue/expectedValue/deviation |
| `SecurityMarker` | 583-587 | 接口定义 | 安全标记：type/message/code |

### 3.2 本地 API 接口（模块间通信）

| 接口名称 | 行号 | 定义范围 | 说明 |
|---------|------|---------|------|
| `IDetectionEngine` | 5011-5023 | 接口定义 | 检测引擎统一接口：detect/getStatus/reloadRules/getMetrics |
| `IRuleEngine` | 5026-5035 | 接口定义 | 规则引擎接口：match/loadRuleSet/getStats |
| `IStatisticalEngine` | 5038-5047 | 接口定义 | 统计引擎接口：processEvent/updateBaseline/loadBaseline |
| `ILogger` | 5050-5062 | 接口定义 | 日志记录器接口：logBlocked/logAllowed/logAlert/queryLogs |
| `IConfigManager` | 5065-5074 | 接口定义 | 配置管理器接口：get/set/reload（**仅接口，无实现**） |

### 3.3 数据类型（由架构文档引用但未在当前范围内定义）

| 类型名称 | 引用位置 | 说明 |
|---------|---------|------|
| `RuleEngine` | ProxySession (line 379), start() (line 428) | 规则引擎类，需在 L0 规则引擎模块实现 |
| `StatisticalEngine` | ProxySession (line 380), start() (line 429) | 统计引擎类，需在 L1 统计引擎模块实现 |
| `AsyncLogger` | ProxySession (line 381), start() (line 430) | 异步日志类，需在日志模块实现 |
| `DecisionRouter` | ProxySession (line 382), start() (line 431) | 决策路由器类，需在决策模块实现 |
| `ChildProcess` | ProxySession (line 370) | Node.js `child_process.ChildProcess` |
| `Readable` / `Writable` | ProxySession (lines 373-376) | Node.js stream 类型 |
| `ToolCallEvent` | IDetectionEngine (line 5013) | 工具调用事件类型，需定义 |
| `EngineStatus` | IDetectionEngine (line 5016) | 引擎状态枚举/类型 |
| `EngineMetrics` | IDetectionEngine (line 5022) | 引擎性能指标类型 |
| `DetectionEvent` | IRuleEngine (line 5028) | 检测事件类型 |
| `RuleMatchResult` | IRuleEngine (line 5028) | 规则匹配结果类型 |
| `RuleSet` | IRuleEngine (line 5031) | 规则集类型 |
| `RuleEngineStats` | IRuleEngine (line 5034) | 规则引擎统计类型 |
| `L1DetectionResult` | IStatisticalEngine (line 5040) | L1 检测结果类型 |
| `BaselineCache` | IStatisticalEngine (line 5046) | 基线缓存类型 |
| `AlertRecord` | ILogger (line 5058) | 告警记录类型 |
| `LogFilter` | ILogger (line 5061) | 日志查询过滤条件类型 |
| `BehaviorLogEntry` | ILogger (line 5061) | 行为日志条目类型 |

---

## 4. 代码完成度分析

### 4.1 代码块详细分析

#### 代码块 1：核心接口定义 (lines 341-407)

```
行号范围: 341-407
内容: ProxyConfig / ProxySession / JSONRPCRequest / JSONRPCResponse 接口
完成度: 100%
代码状态: 可直接用
说明: 4个接口定义完整，字段类型明确，可直接复制到 TypeScript 项目中使用
需补充: 无
```

#### 代码块 2：MCPProxyCore 类实现 (lines 411-588)

```
行号范围: 411-588
内容: MCPProxyCore 完整类 + DetectionResult/TriggeredRule/StatAnomaly/SecurityMarker 接口
完成度: 75%
代码状态: 需补全
需补充的具体内容:
  1. [line 428] `await loadRules()` — loadRules() 函数未定义，需从规则文件加载规则集
  2. [line 429] `await loadThresholds()` — loadThresholds() 函数未定义，需加载统计阈值配置
  3. [line 430] `new AsyncLogger(this.config)` — AsyncLogger 类未定义，需实现异步日志
  4. [line 431] `new DecisionRouter()` — DecisionRouter 类未定义，需实现决策路由器
  5. [line 435] `generateULID()` — generateULID 函数未定义，需引入 ulid 库或自实现
  6. [line 448-449] ProxySession 的 start/stop 方法在构造时赋值，但类型定义中声明为方法，
     实际运行中 startRelay 和 gracefulShutdown 是 MCPProxyCore 的私有方法，需要确认绑定方式
  7. [line 458] `byline.createStream` — 需安装 byline 库 (npm install byline)
  8. [line 480] `this.session.statEngine.update(request)` — 接口中定义的是 processEvent/updateBaseline/loadBaseline，
     此处调用 update() 方法名不匹配，需统一
  9. [line 500] `request.params` 的解构 `{ name, arguments: args }` — 未做 null/undefined 安全检查
  10. [line 504-507] `this.session.ruleEngine.evaluate()` / `this.session.statEngine.evaluate()` —
      ProxySession 接口中声明的是 ruleEngine: RuleEngine 和 statEngine: StatisticalEngine，
      但本地 API 接口 (line 5026-5047) 定义的是 match/processEvent 方法，方法名不一致需统一
  11. [line 510] `this.session.decisionRouter.decide()` — DecisionRouter 类及 decide 方法未定义
  12. [line 552-556] gracefulShutdown() 仅为占位实现，需补充完整的资源清理逻辑
```

#### 代码块 3：本地 API 接口定义 (lines 5006-5075)

```
行号范围: 5006-5075
内容: IDetectionEngine / IRuleEngine / IStatisticalEngine / ILogger / IConfigManager 接口
完成度: 100%
代码状态: 可直接用（作为接口契约）
说明: 5个接口定义完整，是模块间的契约定义
需补充: 这些接口的实现类需要在各自模块中完成（Rule Engine、Stat Engine、Logger、Config Manager）
```

#### 代码块 4：YAML 配置格式示例 (lines 6020-6129)

```
行号范围: 6020-6129
内容: ~/.agentwatch/config.yaml 完整配置示例
完成度: 100%
代码状态: 可直接用（作为配置格式参考）
说明: 涵盖 agentId/userId/proxy/performance/detection/baseline/logging/cloud/scenarios 所有配置节
需补充:
  1. 对应的 TypeScript Config Schema 类型定义（用于运行时类型校验）
  2. 各配置项的默认值定义
  3. 环境变量 ${ENV_VAR} 替换逻辑
  4. YAML → TypeScript 对象的解析器实现
```

#### 代码块 5：MCP 配置集成 JSON (lines 6134-6150)

```
行号范围: 6134-6150
内容: Claude Desktop MCP 配置格式示例
完成度: 100%
代码状态: 可直接用（作为文档说明）
说明: 展示了如何在 mcpServers 中使用 @agentwatch/mcp-proxy 作为中间层
需补充: 无（这是用户配置文档，不是代码）
```

### 4.2 完成度汇总

| 模块 | 代码块 | 行号范围 | 完成度 | 状态 |
|------|--------|---------|--------|------|
| MCP Proxy Core | 接口定义 | 341-407 | 100% | `可直接用` |
| MCP Proxy Core | 类实现 | 411-588 | 75% | `需补全` |
| 本地 API | 接口定义 | 5006-5075 | 100% | `可直接用`（契约） |
| Config Manager | YAML 配置格式 | 6020-6129 | 0%（仅有示例无代码） | `待实现` |
| Config Manager | MCP 集成配置 | 6134-6150 | 100%（文档） | `可直接用`（文档） |

### 4.3 跨模块依赖关系

```
MCPProxyCore.start()
  ├── Config Manager  ← 读取 ProxyConfig
  ├── RuleEngine      ← loadRules() [未定义]
  ├── StatisticalEngine ← loadThresholds() [未定义]
  ├── AsyncLogger     ← new AsyncLogger(config) [未定义]
  ├── DecisionRouter  ← new DecisionRouter() [未定义]
  └── byline          ← 外部依赖 (npm)

MCPProxyCore.handleToolCall()
  ├── RuleEngine.evaluate()    ← 方法名与 IRuleEngine.match() 不一致
  ├── StatisticalEngine.evaluate() ← 方法名与 IStatisticalEngine.processEvent() 不一致
  └── DecisionRouter.decide()  ← 未定义

Config Manager (全部待实现)
  ├── js-yaml  ← 外部依赖 (npm)
  ├── fs (文件系统) ← Node.js 内置
  └── path ← Node.js 内置
```

### 4.4 V0 MVP 建议实施顺序

```
第1周: 基础设施
  ① CFG-04 (YAML 解析器) → CFG-05 (Schema 验证) → CFG-06 (CLI 参数)
  ② CFG-01 (IConfigManager.get 实现)

第2周: MCP Proxy Core 核心
  ③ MPC-01/02 (接口定义，可直接复制)
  ④ MPC-03 (MCPProxyCore 构造函数 + start)
  ⑤ MPC-04 (startRelay 双向管道)

第3周: 检测集成
  ⑥ MPC-05 (handleToolCall 检测调度)
  ⑦ MPC-06 (buildBlockResponse)
  ⑧ MPC-07/08 (injectSecurityMarkers + gracefulShutdown)

第4周: 联调测试
  ⑨ 端到端集成测试
  ⑩ MPC-11/12 (ULID 生成、序列号)
```

---

## Week1 Day7 源码落地同步

| 任务 | 源码状态 | 说明 |
|------|----------|------|
| MPC-03~08 | ✅ | `MCPProxyCore.ts` start/startRelay/handleToolCall/gracefulShutdown |
| MPC-11 sequence_no | ✅ | 内存递增 |
| MPC-12 ULID | ✅ | 自实现 generateULID |
| 方法名 evaluate | ✅ 已修复 | match / processEvent / detect |
| CFG-01~06 | ✅ | `config-manager.ts` |
| CFG-07 热重载 | ⏸ Week2-3 | TODO 注释保留 |
| FIFO 网关 | ✅ 扩展 | `bootstrap.ts` 双流 + 常量收拢 |

### 十大场景 Proxy 侧缺口

- **权限试探**：`consecutiveFailures` Map 已实现，需 MCP Server 返回授权错误才递增  
- **耗时异常**：`lastToolDurationMs` 已采集，未单独映射 L0 规则  
- **A2A**：Proxy 无 Agent 间消息模型（V1+）
