# Live 激活码机制

## 用户流程

1. 在 OKX ASP 购买 **AgentWatch Live 激活码**
2. 打开 AgentWatch → **GitHub / Wallet 登录**（激活码不替代账号）
3. 进入 **激活 Live** 页（`/activate`）或 **设置 → Live 激活**
4. 输入码 `AW-LIVE-XXXX-XXXX` → 兑换成功 → 可使用 `/home` `/dashboard` `/reports`

**Demo**（`/preview/*`）与 **本地 CLI** 始终免费，不查激活码。

## 一码一次（硬性规则）

| 规则 | 实现 |
|------|------|
| 一码仅兑换一次 | `live_activation_codes.status`: active → redeemed |
| 绑定账户 | `redeemed_by` = 当前 `auth.uid()`，不可改绑 |
| 一账户一条权益 | `live_entitlements.user_id` PK |
| 不存明文 | DB 只存 `SHA-256(normalize(code))` |
| 原子兑换 | RPC `redeem_live_activation_code` 内 `FOR UPDATE` |

## 码格式

- 展示：`AW-LIVE-A3F7-E2D1`
- 规范化：去空格/横线 → `AWLIVEA3F7E2D1`（正则 `^AWLIVE[A-Z0-9]{8}$`）
- 哈希：SHA-256(规范化字符串)

## 部署

```bash
# 1. Supabase SQL Editor
docs/supabase/live_activation_codes.sql

# 2. 生成码（输出在 out/，勿提交 git）
node scripts/generate-live-codes.mjs 50 --batch okx-launch-01

# 3. 执行 out/*.sql 入库

# 4. 前端 .env.local
VITE_LIVE_GATE=true   # 默认开启；开发可设 false 跳过
```

## OKX 履约建议

- **MVP**：每卖一单，从 CSV 取一个明文码发给买家
- **后期**：OKX webhook → 服务端生成码 → 自动回复

## 错误码（用户可见中文）

- `code_not_found` — 不存在
- `code_already_redeemed` — 已用过
- `code_expired` / `code_revoked` — 过期/作废
- `invalid_code_format` — 格式错误

## 环境变量

| 变量 | 说明 |
|------|------|
| `VITE_LIVE_GATE=false` | Live 模式跳过激活检查（本地开发） |
| `VITE_USE_MOCK=true` | Demo，不查激活 |

## 管理端（实时看码池）

独立项目 **`packages/code-admin`**：白名单 GitHub 登录，实时汇总 + 码列表 + 兑换账户。  
部署与 SQL 见 **[docs/CODE_ADMIN.md](./CODE_ADMIN.md)**。
