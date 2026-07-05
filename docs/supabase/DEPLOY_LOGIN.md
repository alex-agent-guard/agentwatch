# Login v1 部署清单

参考规格：`docs/login_system_target.md`

## 1. 执行 SQL（Supabase Dashboard → SQL Editor）

按顺序运行：

1. `docs/supabase/events_ddl.sql`（若 `events` 表尚未创建）
2. `docs/supabase/login_system_ddl.sql`（profiles、user_agents、upload credentials、RLS、RPC）

## 2. 启用 GitHub OAuth

Supabase Dashboard → **Authentication → Providers → GitHub**

1. 在 [GitHub Developer Settings](https://github.com/settings/developers) 创建 OAuth App  
   - **Authorization callback URL**：`https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`
2. 将 Client ID / Client Secret 填入 Supabase GitHub Provider 并启用
3. **Authentication → URL Configuration** 添加 Redirect URLs（Site URL 同理）：
   - 本地：`http://localhost:5173/`（OAuth 回调，**不要**只配 `#/dashboard`）
   - 生产：`https://YOUR_DOMAIN/`

前端登录页：**GitHub Login** + **Wallet Login（SIWE）** + **Demo** 游客。

## 3. 启用 Web3 钱包登录（SIWE）

Supabase Dashboard → **Authentication → Providers → Web3 Wallet**

1. 启用 **Ethereum**（Sign-In with Ethereum / EIP-4361）
2. 用户需安装 MetaMask 等 `window.ethereum` 钱包插件
3. 前端调用：`supabase.auth.signInWithWeb3({ chain: 'ethereum', statement: '...' })`
4. 登录成功后同样获得 `auth.uid()` session，RLS / `user_agents` 与 GitHub 一致

**注意**：Dashboard 钱包登录 ≠ CLI 链上交易；CLI 仍用 `upload_secret` 上报。

## 4. 部署 Edge Function（CLI 事件上传）

```bash
# 安装 Supabase CLI 并 login
supabase link --project-ref YOUR_PROJECT_REF

# 部署 upload-events（config.toml 已设 verify_jwt = false）
supabase functions deploy upload-events --no-verify-jwt
```

**不必**手动 `supabase secrets set SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`：
托管 Edge Function 会自动注入这两个变量；新版 CLI 也会拒绝 `SUPABASE_` 前缀的 secret 名。

部署后自检（应返回 HTTP 401，body 含 `upload_credentials_not_found`，说明函数与 RPC 正常）：

```bash
curl -s -w "\nHTTP:%{http_code}\n" -X POST \
  -H "Content-Type: application/json" \
  -d '{"install_id":"test","upload_secret":"bad","events":[]}' \
  https://YOUR_PROJECT.supabase.co/functions/v1/upload-events
```

若返回 `500` + `server_misconfigured`，再检查 Dashboard → Edge Functions 是否部署成功。

Edge Function 路径：`POST https://YOUR_PROJECT.supabase.co/functions/v1/upload-events`

请求体示例：

```json
{
  "install_id": "your-agent-id",
  "upload_secret": "aw_upload_...",
  "events": [ { "...": "AgentWatchEvent fields" } ]
}
```

## 5. 前端 Live 模式

```bash
cp packages/web/.env.example packages/web/.env.local
# 编辑 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY，VITE_USE_MOCK=false

cd packages/web && npm run dev
```

## 6. CLI 联调流程

```bash
agentwatch init                    # 记下 install_id + upload_secret
# 在 Dashboard Settings：绑定 install_id → 注册 upload_secret
agentwatch proxy --cloud           # 事件经 Edge Function 上传
# Dashboard 用 GitHub 或钱包登录，选择已绑定 Agent 查看 events
```

## 7. 安全说明

| 路径 | 鉴权 |
|------|------|
| CLI → Edge Function | `upload_secret` + `ingest_events_with_secret` RPC（service_role） |
| Web 读 events | GitHub / Wallet session + RLS（`user_agents` 绑定） |
| 已废弃 | `anon` + `x-install-id` 直写 `events` |

## 8. 故障排查

- **Dashboard 无数据**：Settings 是否绑定同一 `install_id`？是否注册 `upload_secret`？
- **CLI 上传 401/403**：secret 是否与 init 输出一致？Edge Function secrets 是否配置？
- **GitHub OAuth 失败**：Redirect URL 是否为站点根路径（不带 `#/path`）？
- **Wallet 登录失败**：Supabase 是否启用 Web3 Ethereum？浏览器是否安装 MetaMask？
- **RLS 拒绝 SELECT**：用户是否已 bind 该 install_id？

更多运维说明见 `docs/operation_troubleshoot.md`。
