# L0 Rule Engine 工程分析报告

> 分析范围：架构文档第 751-1236 行（L0 规则引擎完整实现）、第 1380-1630 行（V0 内置规则库）
> 分析时间：V0 MVP 阶段

---

## 1. L0 Rule Engine 工程任务清单

### 1.1 核心引擎类

| 任务ID | 任务名称 | 优先级 | 输入接口 | 输出接口 | 依赖模块 | 代码状态 | 测试验收标准 |
|--------|---------|--------|---------|---------|---------|---------|-------------|
| L0-ENG-01 | `L0RuleEngine` 主类框架 | P0 | `RuleSet`, `DetectionEvent` | `RuleMatchResult[]` | 无 | **需补全** | 类可实例化，所有索引结构正确初始化 |
| L0-ENG-02 | `compileRuleSet()` 规则集编译 | P0 | `RuleSet` | `void` (副作用: 填充索引) | L0-IDX-01~06 | **可直接用** | 编译 1000 条规则 < 100ms，跳过 disabled 规则 |
| L0-ENG-03 | `compileCondition()` 条件编译 | P0 | `RuleCondition` | `MatcherFn` | L0-IDX-03 (RegexCache) | **可直接用** | 支持 EXACT/PREFIX/CONTAINS/REGEX/SET/NUMERIC_RANGE/SEMVER_RANGE/GLOB/FUNCTION 9 种类型 |
| L0-ENG-04 | `match()` 核心匹配入口 | P0 | `DetectionEvent` | `RuleMatchResult[]` | L0-ENG-05~09 | **可直接用** | P99 延迟 < 10ms，典型场景 0.5-3ms |
| L0-ENG-05 | `matchExactIndex()` 精确匹配阶段 | P0 | `DetectionEvent` | 填充 `results` | L0-IDX-01 | **可直接用** | O(1) 查找，CRITICAL 短路返回 |
| L0-ENG-06 | `matchTrieIndex()` Trie 前缀匹配阶段 | P0 | `DetectionEvent` | 填充 `results` | L0-IDX-02 | **可直接用** | O(L) 搜索，正确调用 TrieMatcher.search() |
| L0-ENG-07 | `matchACIndex()` AC 多模式匹配阶段 | P0 | `DetectionEvent` | 填充 `results` | L0-IDX-03 | **可直接用** | O(N+M) 搜索，多字段拼接以 `\x00` 分隔 |
| L0-ENG-08 | `matchNumericRules()` 数值范围匹配 | P1 | `DetectionEvent` | 填充 `results` | 无 | **待实现** | 遍历 numericRules，解析并匹配数值范围 |
| L0-ENG-09 | `matchFunctionRules()` 自定义函数匹配 | P2 | `DetectionEvent` | 填充 `results` | 无 | **待实现** | 遍历 functionRules，执行动态函数匹配 |
| L0-ENG-10 | `evaluateRule()` 规则评估 | P0 | `CompiledRule`, `DetectionEvent` | `RuleMatchResult \| null` | L0-ENG-11 | **可直接用** | 正确实现 AND/OR/NOT/MAJORITY/WEIGHTED_SUM 5 种逻辑 |
| L0-ENG-11 | `getFieldValue()` 字段提取 | P0 | `DetectionEvent`, `FieldSource` | `unknown` | 无 | **待实现** | 按 FieldSource 路径从 DetectionEvent 提取字段值 |
| L0-ENG-12 | `extractFields()` 全字段提取 | P1 | `DetectionEvent` | `[string, unknown][]` | L0-ENG-11 | **待实现** | 提取 event 中所有可索引字段 |
| L0-ENG-13 | `extractStringFields()` 字符串字段提取 | P1 | `DetectionEvent` | `[string, string][]` | L0-ENG-11 | **待实现** | 仅提取用于 Trie 匹配的字符串字段 |
| L0-ENG-14 | `extractTextFields()` 文本字段提取 | P1 | `DetectionEvent` | `[string, string][]` | L0-ENG-11 | **待实现** | 提取用于 AC 匹配的文本字段 |
| L0-ENG-15 | `indexRule()` 规则索引分发 | P0 | `CompiledRule`, `Rule` | `void` (副作用) | L0-IDX-01~06 | **待实现** | 根据条件 matchType 将规则分发到对应索引结构 |
| L0-ENG-16 | `parseNumericRange()` 数值范围解析 | P1 | `string` (如 `'[100000,Infinity)'`) | `{min: number; max: number}` | 无 | **待实现** | 支持 `[min,max)`, `(min,max]`, `[min,max]`, `(min,max)` 4 种区间格式 |
| L0-ENG-17 | `parseSemverRange()` 语义版本范围解析 | P2 | `string` | `any` (范围对象) | 无 | **待实现** | 支持 `^x.x.x`, `~x.x.x`, `>=x.x.x`, `x.x.x - x.x.x` 等格式 |
| L0-ENG-18 | `checkSemverInRange()` 版本范围检查 | P2 | `string`, `any` | `boolean` | L0-ENG-17 | **待实现** | 正确判断版本是否在指定范围内 |
| L0-ENG-19 | `globToRegex()` Glob 转正则 | P2 | `string` (glob 模式) | `string` (正则字符串) | 无 | **待实现** | 支持 `*`, `?`, `**`, `[abc]` 等 glob 语法 |
| L0-ENG-20 | `updateLatencyStats()` 延迟统计 | P1 | `number` (延迟 ms) | `void` (副作用) | 无 | **可直接用** | EWMA 平均延迟 + P99 估计更新正确 |

### 1.2 多维索引组件

| 任务ID | 任务名称 | 优先级 | 输入接口 | 输出接口 | 依赖模块 | 代码状态 | 测试验收标准 |
|--------|---------|--------|---------|---------|---------|---------|-------------|
| L0-IDX-01 | `exactIndex` - Hash 精确索引 | P0 | `field:value` 复合键 | `CompiledRule[]` | 无 | **可直接用** | Map.get O(1)，内存占用 < 2MB/1000 规则 |
| L0-IDX-02 | `TrieMatcher` - Trie 前缀索引 | P0 | `pattern: string`, `rule: CompiledRule` | `CompiledRule[]` (匹配结果) | 无 | **可直接用** | 插入 O(L)，搜索 O(L)，前缀匹配正确 |
| L0-IDX-03 | `AhoCorasickMatcher` - AC 多模式索引 | P0 | `pattern: string`, `rule: CompiledRule` | `CompiledRule[]` (匹配结果) | 无 | **可直接用** | 构建 O(总模式长度)，搜索 O(文本长度+匹配数) |
| L0-IDX-04 | `regexCache` - LRU 正则缓存 | P0 | `pattern: string` | `RegExp` | `LRUCache` | **可直接用** | 缓存命中 O(1)，最大 1000 条，LRU 淘汰策略正确 |
| L0-IDX-05 | `numericRules` - 数值范围规则数组 | P1 | `CompiledRule` (编译时插入) | 遍历匹配 | 无 | **可直接用** | 线性遍历，支持 NUMERIC_RANGE 和 SEMVER_RANGE |
| L0-IDX-06 | `functionRules` - 自定义函数规则数组 | P2 | `CompiledRule` (编译时插入) | 遍历匹配 | 无 | **可直接用** | 线性遍历，FUNCTION 类型规则存储 |

### 1.3 工具类

| 任务ID | 任务名称 | 优先级 | 输入接口 | 输出接口 | 依赖模块 | 代码状态 | 测试验收标准 |
|--------|---------|--------|---------|---------|---------|---------|-------------|
| L0-UTIL-01 | `LRUCache<K, V>` 泛型 LRU 缓存 | P0 | `key: K`, `value: V` | `V \| undefined` | 无 | **可直接用** | Map 语义 get/set，超容量时淘汰最久未使用 |

### 1.4 V0 内置规则库

| 任务ID | 任务名称 | 优先级 | 输入接口 | 输出接口 | 依赖模块 | 代码状态 | 测试验收标准 |
|--------|---------|--------|---------|---------|---------|---------|-------------|
| L0-RULE-01 | `V0_BUILTIN_RULES` 常量定义 | P0 | 无 (静态数组) | `Rule[]` | 类型定义 | **可直接用** | 7 条规则完整定义，类型检查通过 |
| L0-RULE-02 | `GOAL_HIJACK_001` - 关键词劫持检测 | P0 | `argument.value` | 命中/未命中 | L0-IDX-03 | **可直接用** | 包含 `"ignore previous instruction"` 时 BLOCK |
| L0-RULE-03 | `GOAL_HIJACK_002` - 角色覆盖检测 | P0 | `argument.value` | 命中/未命中 | L0-IDX-03, L0-IDX-04 | **可直接用** | 正则 + CONTAINS 双条件 OR 逻辑 |
| L0-RULE-04 | `PARAM_TAMPER_001` - 大额转账检测 | P0 | `tool.name`, `argument.name`, `argument.value` | 命中/未命中 | L0-IDX-01, L0-IDX-05 | **可直接用** | AND 三条件：工具名=transfer + 参数名匹配 + 金额>=100000 |
| L0-RULE-05 | `CHAIN_ABUSE_001` - 工具链滥用检测 | P1 | `tool.name`, `context.chain_depth` | 命中/未命中 | L0-IDX-01, L0-IDX-05 | **可直接用** | 敏感工具 + 链深度>=3 |
| L0-RULE-06 | `PERM_PROBE_001` - 权限探测检测 | P1 | `metadata.consecutive_failures` | 命中/未命中 | L0-IDX-05 | **需补全** | 连续失败>=3 次触发 (字段定义需扩展) |
| L0-RULE-07 | `SUPPLY_CHAIN_001` - 供应链来源检测 | P1 | `tool.source` | 命中/未命中 | L0-IDX-01 | **可直接用** | 来源不在白名单 (negate:true) 时 WARN |
| L0-RULE-08 | `FREQ_001` - 极端频率检测 | P0 | `metadata.frequency_1m` | 命中/未命中 | L0-IDX-05 | **可直接用** | 1 分钟调用>=100 次时 BLOCK |
| L0-RULE-09 | `PROMPT_INJ_001` - 分隔符注入检测 | P1 | `argument.value` | 命中/未命中 | L0-IDX-04 | **需补全** | 正则匹配分隔符模式 (正则转义需验证) |

---

## 2. TrieMatcher 和 AhoCorasickMatcher 专项分析

### 2.1 TrieMatcher（第 1248-1283 行）

#### 代码状态：`可直接用`

实现位于第 1248-1283 行，包含 `TrieNode` 和 `TrieMatcher` 两个类：

- **`TrieNode`** (第 1248-1252 行): 树节点，含 `children: Map<string, TrieNode>`、`rules: CompiledRule[]`、`isEndOfWord: boolean`
- **`TrieMatcher.insert()`** (第 1257-1267 行): 逐字符插入模式，在终点节点标记 `isEndOfWord` 并关联规则
- **`TrieMatcher.search()`** (第 1269-1282 行): 逐字符遍历文本，在每个位置检查是否到达某个模式的终点

#### 算法正确性分析

| 指标 | 实际表现 | 复杂度 |
|------|---------|--------|
| 插入 | 逐字符建立节点链，终点挂规则 | O(L)，L=模式长度 |
| 搜索 | 遍历文本字符，沿 Trie 走下去，每步检查 isEndOfWord | O(L)，L=文本长度 |
| 内存 | 每个模式字符一个节点 + 规则引用 | O(总字符数 * Map 开销) |

#### 需要补充的边界情况

| 编号 | 边界场景 | 当前行为 | 建议处理 |
|------|---------|---------|---------|
| T-01 | **空模式插入** (`pattern = ''`) | `insert('')` 只在 root 节点设置 isEndOfWord=true 并 push 规则 | 需决定是否允许空模式匹配所有文本。当前实现下，`search()` 对任意文本都会先检查 root.isEndOfWord，但 root 初始为 false，且 `insert('')` 后 root.isEndOfWord=true 但 search 循环中不检查 root。所以空模式**永远不会匹配**，这是合理行为。 |
| T-02 | **空文本搜索** (`text = ''`) | 循环不执行，返回空数组 | 行为正确，空文本不应匹配任何非空前缀 |
| T-03 | **重复模式插入** (同一 pattern 多次 insert) | 同一终点节点 push 多条规则，search 时全部返回 | 行为正确，但可能导致重复规则返回。建议调用方通过 rule.id 去重 |
| T-04 | **Unicode 字符** (多字节字符如 emoji) | `for (const char of pattern)` 按 code point 分割，Map 以字符串为 key | 行为正确，ES6 字符串迭代按 code point 分割 |
| T-05 | **文本未在 Trie 中** (搜索中途失配) | `if (!node.children.has(char)) break;` 直接退出循环 | 行为正确，前缀失配即终止 |
| T-06 | **短文本匹配长模式** | 遍历完文本即结束，不会越界 | 行为正确 |
| T-07 | **规则去重** (同一规则被多次匹配) | 返回的 results 可能包含重复规则 | `L0RuleEngine.matchExactIndex()` 中通过 `matchedRules.has(rule.id)` 去重，但 TrieMatcher.search() 本身不保证去重 |

#### 性能测试标准

```
测试项: TrieMatcher
- 插入 1000 个模式 (平均长度 20 字符): 耗时 < 5ms
- 搜索文本长度 1000 字符: 耗时 < 0.2ms
- 内存占用 (1000 模式): < 1MB (取决于模式间共享前缀程度)
- 10000 次搜索吞吐量: > 500,000 ops/sec
```

---

### 2.2 AhoCorasickMatcher（第 1296-1377 行）

#### 代码状态：`可直接用`（含一个语义问题）

实现位于第 1296-1377 行，包含 `ACNode` 和 `AhoCorasickMatcher` 两个类：

- **`ACNode`** (第 1296-1301 行): AC 自动机节点，含 `children`, `fail`, `output`, `depth`
- **`AhoCorasickMatcher.addPattern()`** (第 1307-1317 行): 逐字符插入模式，在终点节点 output 数组 push 规则
- **`AhoCorasickMatcher.build()`** (第 1319-1349 行): BFS 构建失败指针，并将 fail 链上的 output 合并到当前节点
- **`AhoCorasickMatcher.search()`** (第 1351-1376 行): 按 AC 自动机进行多模式同时匹配，使用 `seen` Set 去重

#### 算法正确性分析

| 指标 | 实际表现 | 复杂度 |
|------|---------|--------|
| 构建失败指针 | BFS 遍历，每层处理所有子节点 | O(总模式长度 * 字符集大小)，实际 O(总模式长度) |
| 搜索 | 单遍扫描文本，利用 fail 指针跳转 | O(文本长度 + 匹配数) |
| 去重 | search 内使用 `seen: Set<string>` 按 rule.id 去重 | O(匹配数) 额外开销 |

#### 已知问题与边界情况

| 编号 | 问题/边界 | 严重程度 | 说明 |
|------|----------|---------|------|
| AC-01 | **`depth` 字段语义错误** | Minor | `addPattern()` 中 `node.depth++` 将 depth 用作**计数器**（同一节点多次访问时累加），而非**节点深度**。由于 `build()` 中未使用 depth 字段，不影响功能。建议重命名为 `refCount` 或移除该字段 |
| AC-02 | **build() 后添加新模式** | Moderate | `addPattern()` 不重置 `this.built = false`，build 后添加新模式不会触发重建。需在 `addPattern()` 开头添加 `this.built = false;` |
| AC-03 | **空模式插入** (`pattern = ''`) | Minor | 同 Trie，空模式不会匹配任何文本。`addPattern('')` 只会在 root.output 中 push 规则，但 search 不检查 root.output（从 root 出发先跳转到子节点），所以空模式永远不会匹配 |
| AC-04 | **空文本搜索** (`text = ''`) | Minor | 循环不执行，返回空数组。行为合理 |
| AC-05 | **output 累积膨胀** | Moderate | `build()` 中 `child.output.push(...child.fail.output)` 导致深层节点的 output 可能包含大量规则引用。对于深度为 D 的节点，output 可能累积 D 条 fail 链上的所有规则。内存最坏 O(N^2)（N=模式数）。V0 阶段模式数 < 100，影响可忽略 |
| AC-06 | **多字段拼接分隔** | Minor | `matchACIndex()` 使用 `'\x00'` 拼接多字段文本，若字段值本身包含 `\x00` 字符，可能导致跨字段误匹配。建议添加输入清洗或改用更安全的多字段分别搜索 |
| AC-07 | **并发安全** | Info | AC 自动机构建后只读，search 无副作用，线程安全。但 build 过程中 search 可能读到不一致状态（`built` 标志非原子操作） |

#### 修复建议（AC-02 必须修复）

```typescript
addPattern(pattern: string, rule: CompiledRule): void {
  this.built = false;  // <-- 必须添加：允许增量添加后重建
  let node = this.root;
  for (const char of pattern) {
    if (!node.children.has(char)) {
      node.children.set(char, new ACNode());
    }
    node = node.children.get(char)!;
    node.depth++;  // 建议改为：if (!node.children.has(char)) { node.depth = (node.depth || 0) + 1; }
  }
  node.output.push(rule);
}
```

#### 性能测试标准

```
测试项: AhoCorasickMatcher
- 插入 1000 个模式 (平均长度 20 字符) + build: 耗时 < 10ms
- 搜索文本长度 10000 字符 (1000 个模式): 耗时 < 0.5ms
- 内存占用 (1000 模式): < 5MB (含 output 累积)
- 10000 次搜索吞吐量: > 200,000 ops/sec
- 正确性: 1000 个模式中任意子串出现都应被检测
```

---

## 3. 关键 TypeScript 接口清单

### 3.1 类型别名 (Type Aliases)

| 接口名 | 行号 | 定义 |
|--------|------|------|
| `RuleSeverity` | 792 | `'CRITICAL' \| 'HIGH' \| 'MEDIUM' \| 'LOW' \| 'INFO'` |
| `RuleAction` | 795 | `'BLOCK' \| 'WARN' \| 'ESCALATE' \| 'LOG' \| 'ALLOW'` |
| `MatchType` | 798-808 | 9 种匹配类型联合类型 |
| `FieldSource` | 811-826 | 15 种字段来源联合类型 |
| `ConditionLogic` | 839 | `'AND' \| 'OR' \| 'NOT' \| 'MAJORITY' \| 'WEIGHTED_SUM'` |
| `MatcherFn` | 924 | `(value: unknown) => boolean` |

### 3.2 接口 (Interfaces)

| 接口名 | 行号 | 字段说明 |
|--------|------|---------|
| `RuleCondition` | 829-836 | `id`, `field: FieldSource`, `matchType: MatchType`, `pattern`, `negate?`, `weight?` |
| `Rule` | 842-872 | 完整规则定义，含 20+ 字段（ID、名称、描述、分类、严重级别、动作、启用状态、不可变标志、条件列表、条件逻辑、最小权重、版本、作者、标签、时间戳、统计） |
| `RuleMatchResult` | 875-884 | 匹配结果：`ruleId`, `ruleName`, `severity`, `action`, `matchedConditions`, `confidence`, `matchedFields`, `timestamp` |
| `RuleSet` | 887-894 | 规则集：`id`, `name`, `description`, `rules`, `priority`, `defaultAction` |
| `CompiledRule` | 905-913 | 编译后规则（内部使用）：`id`, `severity`, `action`, `compiledConditions`, `conditionLogic`, `minWeight?`, `priority` |
| `CompiledCondition` | 916-922 | 编译后条件（内部使用）：`id`, `field`, `matcher: MatcherFn`, `weight`, `negate` |

### 3.3 类 (Classes)

| 类名 | 行号 | 说明 |
|------|------|------|
| `L0RuleEngine` | 926-1227 | 主引擎类，含 6 个索引字段 + 统计 + 配置 + 14 个方法 |
| `LRUCache<K, V>` | 1230-1235 | LRU 缓存，基于 Map 实现 |
| `TrieNode` | 1248-1252 | Trie 树节点 |
| `TrieMatcher` | 1254-1283 | Trie 匹配器，`insert()` + `search()` |
| `ACNode` | 1296-1301 | AC 自动机节点 |
| `AhoCorasickMatcher` | 1303-1377 | AC 匹配器，`addPattern()` + `build()` + `search()` |

### 3.4 常量

| 常量名 | 行号 | 说明 |
|--------|------|------|
| `V0_BUILTIN_RULES` | 1387-1629 | 7 条内置规则静态数组 |

### 3.5 外部依赖（文档中未定义，但代码中引用）

| 类型名 | 使用位置 | 说明 |
|--------|---------|------|
| `DetectionEvent` | `match()`, `matchExactIndex()`, `matchTrieIndex()`, `matchACIndex()`, `evaluateRule()`, `extractFields()`, `extractStringFields()`, `extractTextFields()`, `getFieldValue()` | **未在分析范围内定义**。从 `FieldSource` 推断应包含：`tool` (name/version/source), `argument` (name/value/type), `request` (origin/user_id/session_id/timestamp), `context` (agent_id/skill_id/chain_depth), `metadata` (frequency_1m/frequency_5m) |

---

## 4. 伪代码标注（所有 `/* ... */` 和 `// ...` 省略部分）

### 4.1 完整省略列表

| 行号 | 方法签名 | 省略标记 | 需要补充的逻辑 | 优先级 |
|------|---------|---------|--------------|--------|
| 1216 | `extractFields(event: DetectionEvent): [string, unknown][]` | `/* ... */ return [];` | **从 DetectionEvent 提取所有可用于索引的字段对** (fieldPath, value)。需遍历 event 的所有嵌套属性，生成扁平化的 `field:value` 键值对列表，用于 exactIndex 查找 | P1 |
| 1217 | `extractStringFields(event: DetectionEvent): [string, string][]` | `/* ... */ return [];` | **提取所有字符串类型的字段**，返回 `[fieldPath, stringValue]` 数组。用于 TrieMatcher 的前缀匹配。应包含 `tool.name`, `argument.name`, `argument.value` 等 | P1 |
| 1218 | `extractTextFields(event: DetectionEvent): [string, string][]` | `/* ... */ return [];` | **提取所有长文本字段**，返回 `[fieldPath, textValue]` 数组。用于 AhoCorasickMatcher 的多模式匹配。重点是 `argument.value` | P1 |
| 1219 | `getFieldValue(event: DetectionEvent, field: FieldSource): unknown` | `return undefined;` | **按 FieldSource 路径从 DetectionEvent 取值**。实现属性路径解析（如 `'argument.value'` → `event.argument.value`）。支持嵌套对象路径访问 | P0 |
| 1220 | `parseNumericRange(pattern: string): { min: number; max: number }` | `return { min: 0, max: Infinity };` | **解析数值区间字符串**。需支持：`[100000,Infinity)` → `{min: 100000, max: Infinity}`; `(0,100]` → `{min: 0, max: 100}`（开区间）。需处理 `[`, `]`, `(`, `)` 四种括号，以及 `Infinity` 关键字 | P1 |
| 1221 | `parseSemverRange(pattern: string): any` | `return null;` | **解析语义版本范围字符串**。需支持 `^1.0.0`, `~1.0.0`, `>=1.0.0`, `1.0.0 - 2.0.0`, `*` 等 npm semver 范围语法 | P2 |
| 1222 | `checkSemverInRange(version: string, range: any): boolean` | `return true;` | **检查版本号是否在指定范围内**。配合 parseSemverRange 使用。需处理 prerelease 版本比较等边界情况 | P2 |
| 1223 | `globToRegex(pattern: string): string` | `return '';` | **将 Glob 模式转换为正则表达式字符串**。需支持 `*` (匹配任意非 `/` 字符), `?` (匹配单个字符), `**` (匹配任意路径), `[abc]` (字符类), `{a,b}` (选项) | P2 |
| 1224 | `indexRule(compiled: CompiledRule, rule: Rule): void` | `/* 索引逻辑 */` | **将编译后的规则分发到对应索引结构**。核心逻辑：遍历 rule.conditions，根据 matchType 决定：EXACT → exactIndex; PREFIX → trieIndex; CONTAINS → acIndex; REGEX → 不索引（运行时正则）; SET → exactIndex（展开集合元素）; NUMERIC_RANGE/SEMVER_RANGE → numericRules; FUNCTION → functionRules | P0 |
| 1225 | `matchNumericRules(event: DetectionEvent, matchedRules: Set<string>, results: RuleMatchResult[]): void` | 空函数体 | **遍历 numericRules 数组进行匹配**。对每条规则，调用 evaluateRule()，若匹配且未在 matchedRules 中，则加入 results。逻辑参考 matchExactIndex() | P1 |
| 1226 | `matchFunctionRules(event: DetectionEvent, matchedRules: Set<string>, results: RuleMatchResult[]): void` | 空函数体 | **遍历 functionRules 数组进行匹配**。FUNCTION 类型的 matcher 在 compileCondition 中固定返回 false，需要在运行时从外部注册函数表中查找并执行。V0 阶段若无 FUNCTION 类型规则，可留空 | P2 |

### 4.2 实现代码中隐含的待实现逻辑

| 位置 | 说明 | 优先级 |
|------|------|--------|
| `compileCondition` 中 `FUNCTION` case (第 1050-1051 行) | `matcher = () => false; // 在运行时处理` — FUNCTION 类型匹配器需要外部函数注册表支持 | P2 |
| `compileCondition` 中 `default` case (第 1054-1055 行) | `matcher = () => false;` — 未知 matchType 默认不匹配，建议增加 warn 日志 | P2 |
| `indexRule` 调用点 (第 979 行) | 编译完成后调用，但方法体为空，导致所有规则实际上未被索引到任何结构中 | **P0** |

### 4.3 类型系统缺口

| 位置 | 问题 | 建议修复 |
|------|------|---------|
| `FieldSource` 定义 (第 811-826 行) | 未包含 `metadata.consecutive_failures`，但 `PERM_PROBE_001` 规则 (第 1531 行) 使用了该字段 | 扩展 FieldSource 联合类型，添加 `'metadata.consecutive_failures'` |
| `DetectionEvent` | 全文中使用但未定义 | 需补充接口定义（可从 `FieldSource` 反推结构） |

### 4.4 正则表达式转义问题

| 位置 | 问题 | 建议修复 |
|------|------|---------|
| `PROMPT_INJ_001` c1 (第 1612 行) | `pattern: '[\-#]{3,}'` 中 `\-` 在字符类中有些引擎不识别，JavaScript 中 `\-` 在字符类内是合法的字面量连字符转义，但某些正则引擎可能警告 | 改为 `'[\-#]{3,}'` → `'[\\-#]{3,}'` 确保正确转义，或使用 `'[\-#]{3,}'`（JS 中实际行为正确） |
| `PROMPT_INJ_001` c2 (第 1619 行) | `pattern: '<\s*/\s*\w+\s*>'` 中 `\s` 和 `\w` 在 JS 正则中正确工作 | 无问题，但注意 `< / tag >` 格式的 HTML 闭合标签检测可能误报合法 XML 内容 |

---

## 5. V0 MVP 实施建议

### 5.1 实施优先级

```
第 1 周（必须完成）:
  - L0-ENG-11 getFieldValue()       — 所有匹配的基础
  - L0-ENG-15 indexRule()           — 规则索引分发（当前为空，引擎无法工作）
  - L0-ENG-12~14 extract*Fields()   — 字段提取
  - L0-IDX-02 TrieMatcher           — 代码已可用，集成测试
  - L0-IDX-03 AhoCorasickMatcher    — 代码已可用，修复 AC-02

第 2 周（关键功能）:
  - L0-ENG-16 parseNumericRange()   — PARAM_TAMPER_001 依赖
  - L0-ENG-08 matchNumericRules()   — 数值范围匹配
  - L0-ENG-10 evaluateRule()        — AND/OR/NOT/MAJORITY/WEIGHTED_SUM
  - L0-RULE-01~09 内置规则集成测试

第 3 周（完善）:
  - L0-ENG-17~19 semver/glob 解析  — 当前无规则依赖，可延后
  - L0-ENG-09 matchFunctionRules()  — V0 无 FUNCTION 规则，可延后
  - 性能测试与调优
```

### 5.2 关键阻塞项

| 阻塞项 | 影响 | 解决方式 |
|--------|------|---------|
| `indexRule()` 为空实现 | **引擎完全无法工作** — 编译后规则未进入任何索引 | 立即实现索引分发逻辑 |
| `getFieldValue()` 返回 undefined | **所有规则评估返回 false** — 无法获取字段值 | 实现 DetectionEvent 字段路径解析 |
| AC-02: build 后 addPattern 不重置 | **运行时添加规则后搜索失效** | 在 addPattern() 开头加 `this.built = false` |

### 5.3 代码统计

| 类别 | 行数 | 占比 | 状态 |
|------|------|------|------|
| 可直接使用的代码 | ~280 行 | ~70% | 类型定义 + 核心算法 + Trie/AC + LRU + 内置规则 |
| 需补全的代码 | ~50 行 | ~12% | extract/getFieldValue/parseNumericRange 等辅助方法 |
| 待实现的代码 | ~70 行 | ~18% | indexRule/matchNumericRules/matchFunctionRules 等空方法 |

---

## Week1 Day7 源码落地同步

| 任务 | 文档状态 | 源码状态 |
|------|----------|----------|
| L0-ENG-11 getFieldValue | 待实现 | ✅ `RuleEngine.getFieldValue` |
| L0-ENG-15 indexRule | 待实现 | ✅ `RuleEngine.indexRule` |
| L0-ENG-08~09 numeric/function | 待实现 | ✅ 已实现 |
| L0-RULE-01~09 | 可直接用 | ✅ `rule/builtin.ts` 8 条规则 |
| REGEX_CACHE_MAX 等常量 | 分散 | ✅ `packages/shared/constants.ts` |

### 十大场景 L0 覆盖

GOAL_HIJACK、PARAM_TAMPER、CHAIN_ABUSE、PERM_PROBE、FREQ、PROMPT_INJ、SUPPLY_CHAIN 均有内置规则；**A2A 风险、耗时异常、纯基线偏离** 无独立 L0 规则（依赖 L1 / V1）。

---

*报告生成完毕。本分析严格基于架构文档第 751-1236 行和第 1380-1630 行的内容。*
