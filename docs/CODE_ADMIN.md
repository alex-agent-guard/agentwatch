# 激活码管理端（独立项目）

本地运行的 **管理员控制台**：实时查看码池总量、各批次用量、每一枚激活码的状态与兑换账户。

与主站 `packages/web` 分离，仅 `live_code_admins` 白名单内的 GitHub 账号可登录。

## 能力

| 功能 | 说明 |
|------|------|
| 汇总 | 总码数 / 未使用 / 已兑换 / 已作废 |
| 按批次 | 每批总量与已兑数量，点击筛选 |
| 码列表 | 完整 `AW-LIVE-XXXX-XXXX`（需入库时写入 `code_display`） |
| 实时 | Supabase Realtime，用户兑换后自动刷新 |
| 兑换者 | 已兑码显示 GitHub 邮箱（来自 `profiles`） |

## 部署（一次性）

### 1. Supabase SQL

按顺序执行：

1. `docs/supabase/live_activation_codes.sql`（若未执行）
2. **`docs/supabase/live_activation_admin.sql`**（管理员 + Realtime + `code_display`）

### 2. 添加管理员

在 SQL Editor（postgres 权限）执行，把邮箱换成你的 GitHub 登录邮箱：

```sql
insert into public.live_code_admins (user_id, note)
select id, 'founder'
from auth.users
where email = 'you@example.com'
on conflict (user_id) do nothing;
```

若尚未用该邮箱登录过 AgentWatch，先在主站或管理端 GitHub 登录一次，再执行上述 SQL。

### 3. Supabase Auth 回调

Dashboard → Authentication → URL Configuration → Redirect URLs 增加：

```
http://localhost:5180
```

（若部署到固定域名，再加生产 URL。）

### 4. 生成并入库激活码

**务必使用更新后的脚本**（SQL 会写入 `code_display`）：

```bash
node scripts/generate-live-codes.mjs 50 --batch launch-01
# 在 Supabase 执行 out/*.sql
```

旧批次若只有 hash、没有 `code_display`，管理端会显示 `AW-LIVE-XXXX-****` 前缀，无法还原完整码；可重新生成批次或从本地 CSV 对照。

## 本地运行

```bash
cd packages/code-admin
cp .env.example .env.local
# 填入与 packages/web 相同的 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY

npm install
npm run dev
```

浏览器打开 **http://localhost:5180**，GitHub 登录即可。

## 安全说明

- 不使用 Service Role Key 进浏览器；普通 anon key + 白名单 RPC/RLS。
- `code_display` 仅管理员 RLS 可读；用户端兑换仍只验 SHA-256 hash。
- 管理端 **不要** 对公网开放；本地或 VPN 内使用即可。

## 常见问题

**Realtime 不刷新？**  
Supabase Dashboard → Database → Replication，确认 `live_activation_codes` 已加入 `supabase_realtime` publication（`live_activation_admin.sql` 会尝试添加）。

**看不到完整码？**  
该批次入库 SQL 未含 `code_display`；用新脚本重新生成并入库。

**403 / forbidden**  
当前 GitHub 账号不在 `live_code_admins`，按上文第 2 步添加。
