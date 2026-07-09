# Web Dashboard 商用部署（Vercel + 自有域名）

> **OKX 渠道一键手册**：见 [`docs/OKX_DEPLOY_RUNBOOK.md`](./OKX_DEPLOY_RUNBOOK.md)（含域名推荐 + 脚本索引）  
> **正式商用方案**：Vercel 托管静态 Dashboard + Supabase 后端 + **自有域名**  
> GitHub Pages 仅作备用（见文末），**不要**作为对外主站。

---

## 架构

```text
https://app.你的域名.com          ← Vercel（packages/web 构建产物）
        ↓ anon key + Session
https://kbjcikgoawxhotwwqtin.supabase.co   ← 登录 / 激活码 / 事件数据
        ↑ upload_secret
用户本机 agentwatch-web3 CLI
```

---

## 零、5 分钟操作清单（按顺序打勾）

| # | 动作 | 在哪做 |
|---|------|--------|
| 1 | 代码 push 到 `alex-agent-guard/agentwatch` 的 `main` | 本机终端 |
| 2 | Vercel Import 仓库，**Root Directory = `packages/web`** | vercel.com/new |
| 3 | 配 3 个环境变量（见下）→ Deploy | Vercel Project |
| 4 | 添加自有域名 + DNS CNAME | Vercel Domains + 域名商 |
| 5 | Supabase **Site URL + Redirect URLs** 改为生产域名 | Supabase Auth |
| 6 | 浏览器验收登录 / 激活 / Demo | 见「验收」 |

本地辅助命令：

```bash
bash scripts/print-vercel-env.sh          # 打印要粘贴到 Vercel 的变量
bash scripts/verify-web-deploy.sh https://app.你的域名.com
```

---

## 一、前置条件

| 项 | 说明 |
|----|------|
| GitHub 仓库 | `https://github.com/alex-agent-guard/agentwatch` |
| Supabase | 登录 + 激活码 SQL 已执行，见 `docs/LOGIN_SETUP.md`、`docs/LIVE_ACTIVATION.md` |
| 自有域名 | 在注册商（阿里云 / 腾讯云 / Cloudflare 等）可改 DNS |
| Vercel 账号 | https://vercel.com （Hobby 免费即可起步） |

---

## 二、方式 A — GitHub 导入（推荐，push 即自动部署）

### 1. 推送最新代码

```bash
cd ~/Desktop/agent-watch-v0
git push origin-new main
# 若 HTTPS 超时，试：git push github-ssh main
```

### 2. 在 Vercel 导入项目

1. 打开 https://vercel.com/new  
2. **Import Git Repository** → 选 `alex-agent-guard/agentwatch`  
3. **Configure Project** — 以下项必须正确：

| 设置 | 值 | 常见错误 |
|------|-----|----------|
| Framework Preset | **Vite** | 选 Other 也能跑，但不必要 |
| Root Directory | **`packages/web`** | 留空会导致白屏 / 404 |
| Build Command | `npm run build` | 默认即可 |
| Output Directory | `dist` | 默认即可 |
| Install Command | `npm ci` | `vercel.json` 已指定 |

4. **先不要点 Deploy** — 下一步先配环境变量。

### 3. 环境变量（Production + Preview 都勾选）

Vercel → Project → **Settings → Environment Variables**：

| Name | Value |
|------|--------|
| `VITE_USE_MOCK` | `false` |
| `VITE_SUPABASE_URL` | `https://kbjcikgoawxhotwwqtin.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Supabase → Settings → API → **anon public** |

本机可运行 `bash scripts/print-vercel-env.sh` 从 `.env.local` 复制前两行以外的值。

参考模板：`packages/web/.env.production.example`

> **注意**：变量名必须以 `VITE_` 开头才会打进前端包；改完变量后要在 Deployments 里 **Redeploy**。

### 4. 首次 Deploy

点击 **Deploy**，等待 1～3 分钟。成功后得到：

```text
https://agentwatch-web-xxx.vercel.app
```

先用 `bash scripts/verify-web-deploy.sh https://agentwatch-web-xxx.vercel.app` 做基础检查，再绑自有域名。

### 5. 绑定自有域名

1. Vercel → Project → **Settings → Domains**  
2. 输入子域名，建议：**`app.你的品牌.com`**（不要用根域 `@` 除非你很熟悉 DNS）  
3. Vercel 会给出 DNS 记录，通常是：

| 类型 | 主机记录 | 值 |
|------|----------|-----|
| **CNAME** | `app` | `cname.vercel-dns.com` |

**常见注册商示例**

| 注册商 | 操作位置 |
|--------|----------|
| 阿里云 | 域名 → 解析 → 添加 CNAME |
| 腾讯云 DNSPod | 我的域名 → 解析 → 添加记录 |
| Cloudflare | DNS → Add record → CNAME，Proxy 可开可关 |

4. 等待 DNS 生效（通常 5～30 分钟，最长 24h）  
5. Vercel 会自动签发 **HTTPS** 证书

**商用建议**：发给买家 / OKX 渠道的链接用 `https://app.品牌.com`，不要用 `*.vercel.app`。

### 6. Supabase Auth（必做，否则线上 GitHub 登录失败）

打开：https://supabase.com/dashboard/project/kbjcikgoawxhotwwqtin/auth/url-configuration

| 字段 | 填入（换成你的真实域名） |
|------|--------------------------|
| **Site URL** | `https://app.你的域名.com/` |
| **Redirect URLs** | 每行一个：`https://app.你的域名.com/` |

可选（仅团队内部预览 Vercel 默认域）：

```text
https://agentwatch-web-xxx.vercel.app/
```

**不要改** GitHub OAuth App 的 Authorization callback URL，仍是：

```text
https://kbjcikgoawxhotwwqtin.supabase.co/auth/v1/callback
```

### 7. 验收

| 检查 | URL |
|------|-----|
| Demo（无需登录） | `https://app.你的域名.com/#/preview/home` |
| 登录页 | `https://app.你的域名.com/#/auth` |
| GitHub 登录 → 新用户 | 应跳 `#/activate` 输入 Live 码 |
| 已兑码用户 | 登录后进 `#/home` 或 Settings 绑定 Agent |

```bash
bash scripts/verify-web-deploy.sh https://app.你的域名.com
bash scripts/verify-login-setup.sh   # 本地 Supabase / OAuth 配置
```

### 8. 一键安装脚本的生产 URL

用户跑安装脚本时，把 Dashboard 指到生产域：

```bash
export AGENTWATCH_DASHBOARD_URL=https://app.你的域名.com
curl -fsSL https://www.deeptrench.space/install.sh | bash
```

---

## 三、方式 B — 命令行部署（不连 Git 自动部署时）

```bash
cd ~/Desktop/agent-watch-v0
bash scripts/deploy-vercel.sh
```

无交互 / CI：

```bash
npx vercel login   # 或 export VERCEL_TOKEN=...
NON_INTERACTIVE=1 bash scripts/deploy-vercel.sh
```

---

## 四、持续部署

GitHub 导入后：**push `main` 且改动 `packages/web/**` → Vercel 自动 Production 构建**。

| 设置 | 推荐值 |
|------|--------|
| Production Branch | `main` |
| 忽略 builds | 无需 — monorepo 已通过 Root Directory 隔离 |

改环境变量后：**Deployments → 最新 → Redeploy**（否则旧包仍用旧 env）。

---

## 五、路由与构建说明

- 前端使用 **HashRouter**（`#/auth`、`#/dashboard`），与 Vercel 静态托管完全兼容。  
- `packages/web/vercel.json` 已配置 SPA fallback 与 `/assets/*` 长期缓存。  
- 构建 `base` 默认 **`/`**（自有域名根路径）。  
- 若将来部署到子路径：`VITE_BASE=/子路径/ npm run build`（商用自有域一般不需要）。

---

## 六、商用检查清单

- [ ] `videos/web/` 压缩版已 push（或配 `VITE_VIDEO_CDN_BASE`）  
- [ ] 自有域名 HTTPS 有效  
- [ ] Vercel Root Directory = `packages/web`  
- [ ] 环境变量三件套（`VITE_USE_MOCK=false` 等）  
- [ ] Supabase Redirect URLs 含生产域名  
- [ ] GitHub OAuth 在 Supabase 已启用  
- [ ] Live 激活码 SQL 已执行  
- [ ] 对外文档 / 激活码邮件使用 **自有域名**  
- [ ] 码池看板仍仅本地 Mac（`桌面/打开AgentWatch码池.command`）  
- [ ] `AGENTWATCH_DASHBOARD_URL` 指向生产域（安装脚本）

---

## 七、常见问题

| 现象 | 处理 |
|------|------|
| **首页黑屏、无背景视频** | 确认 `packages/web/public/assets/videos/web/` 已提交；或运行 `bash scripts/compress-web-videos.sh` 后 push |
| 白屏 / 资源 404 | Root Directory 必须是 `packages/web`；Redeploy |
| GitHub 登录跳回失败 | Supabase Redirect URLs 缺生产域名；保存后硬刷新 |
| 登录成功但无激活页 | 该 GitHub 已兑过码；换账号测 |
| 构建通过但 Live 仍是 Mock | `VITE_USE_MOCK` 未设或不是 `false`；Redeploy |
| 预览域可用、自有域不行 | DNS CNAME 未生效；`dig app.你的域名.com` 查解析 |
| Vercel 构建 OOM | 正常包 ~1.2MB JS；免费额度一般够用 |

---

## 附录 A：GitHub Pages（备用，非商用主站）

Workflow：`.github/workflows/deploy-web.yml`（**仅** Actions 里手动 `workflow_dispatch` 触发）。

Pages 地址：`https://alex-agent-guard.github.io/agentwatch/`  
构建使用 `VITE_BASE=/agentwatch/`。

---

## 附录 B：相关文件

| 文件 | 作用 |
|------|------|
| `packages/web/vercel.json` | Vercel 构建与 SPA 路由 |
| `packages/web/vite.config.ts` | `VITE_BASE` 默认 `/` |
| `scripts/deploy-vercel.sh` | CLI 部署助手 |
| `scripts/print-vercel-env.sh` | 打印环境变量 |
| `scripts/verify-web-deploy.sh` | 线上 HTTP 验收 |
| `docs/LOGIN_SETUP.md` | 登录与 OAuth |
| `docs/LIVE_ACTIVATION.md` | Live 激活码 |
