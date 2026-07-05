# Demo 叙事脚本 — AgentWatch Runtime Gate

> 基于 `packages/web/src/data/mockData.ts` · 约 60 秒口述

## 第 1 步 · 正常读取（evt-001）

**屏幕**：`filesystem.read` · ALLOW · 风险分 12

**旁白**：Agent 正常读文件，Runtime Gate 放行——没有命中任何规则，行为在基线内。

---

## 第 2 步 · 可疑 Swap（evt-002）

**屏幕**：`swap` · WARN · **分隔符注入**

**旁白**：Swap 参数里出现分隔符或注入特征，系统标记 WARN。工具已执行，但已记入审计链，运营者事后可复查。

---

## 第 3 步 · 大额转账被拦（evt-003）★ 重点

**屏幕**：`transfer` · BLOCK · **大额转账** + **工具链滥用** + **高危转账组合**

**旁白**：这是 Demo 的核心——Agent 在深度 4 的工具链末尾发起大额 transfer。单笔触发大额转账规则，链深度触发工具链滥用，两者叠加推断为高危转账组合，Runtime Gate 在工具执行前直接 BLOCK。

---

## 第 4 步 · 正常查余额（evt-004）

**屏幕**：`query_balance` · ALLOW

**旁白**：普通余额查询，无风险特征，放行。

---

## 第 5 步 · 权限探测（evt-005）

**屏幕**：`delegate_action` · WARN · **权限探测**

**旁白**：连续失败触发权限探测告警——可能是调试，也可能是攻击者在摸权限边界，需要人工看一眼。

---

## 收尾一句

「AgentWatch 不读你的聊天，只在 Agent **真要执行工具** 的那一瞬间检查参数、链深度和频率——拦得住转账，也留得下 HMAC 审计链。」
