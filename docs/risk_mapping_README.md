# 风险拦截映射归档索引

> 更新：2026-07-06 · 适用 AgentWatch V0 Runtime Gate

## 文件清单

| 文件 | 用途 |
|------|------|
| [RULE_USER_COPY.json](./RULE_USER_COPY.json) | 机器可读映射（ruleId → 中文标题 / 白话说明 / 处置建议） |
| [风险拦截说明手册.md](./风险拦截说明手册.md) | Kimi 产出 · 运营者完整参考（FAQ + Demo 解读） |
| [Demo叙事脚本.md](./Demo叙事脚本.md) | 5 步 Demo 旁白（基于 mock 事件序列） |

## 代码同步点

Dashboard 运行时读取：

```
packages/web/src/lib/riskCopy.ts   ← 与 RULE_USER_COPY.json 保持同步
```

展示组件：

```
packages/web/src/components/dashboard/RiskExplanation.tsx
```

Mock 事件（已勘误 ruleId）：

```
packages/web/src/data/mockData.ts
```

## L0 ruleId ↔ 源码 ↔ 场景键

| ruleId | 源码 | RULE_ID_SCENARIO_MAP |
|--------|------|---------------------|
| GOAL_HIJACK_001 | builtin.ts L0-RULE-02 | goal_hijacking |
| GOAL_HIJACK_002 | builtin.ts L0-RULE-03 | goal_hijacking |
| PARAM_TAMPER_001 | builtin.ts L0-RULE-04 | parameter_tampering |
| CHAIN_ABUSE_001 | builtin.ts L0-RULE-05 | tool_chain_abuse |
| PERM_PROBE_001 | builtin.ts L0-RULE-06 | permission_probing |
| SUPPLY_CHAIN_001 | builtin.ts L0-RULE-07 | supply_chain_poisoning |
| FREQ_001 | builtin.ts L0-RULE-08 | frequency_anomaly |
| PROMPT_INJ_001 | builtin.ts L0-RULE-09 | prompt_injection |

## 组合规则推断（Dashboard 本地）

| combination id | 推断条件 |
|----------------|----------|
| high_value_transfer | PARAM_TAMPER_001 + CHAIN_ABUSE_001 |
| coordinated_attack | PROMPT_INJ_001 + (GOAL_HIJACK_001 \| GOAL_HIJACK_002) |
| rapid_probing | PERM_PROBE_001 + FREQ_001 |

> Live 云端尚未上报 `triggeredCombinations`，Dashboard 按上表从 L0 命中集推断。

## 维护约定

1. 修改 L0 规则时：同步更新 `builtin.ts` → `RULE_USER_COPY.json` → `riskCopy.ts` → 手册相关章节
2. 不得新增未在 `builtin.ts` 定义的 ruleId
3. Mock 数据禁止使用 `LARGE_TRANSFER_001`
