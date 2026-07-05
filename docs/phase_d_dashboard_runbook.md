# Phase D — Dashboard 读 Supabase 真数据（操作手册）

> **最常见失败原因**：用了全局 `npm install -g @agentwatch-web3/cli` 的 `agentwatch`，它 POST 到 `/v1/events/batch`，Supabase 无此路由，上报全部失败。  
> **必须用本仓库构建后的 CLI**（含 `supabaseCloudTransport.ts`）。

---

## 你需要手动完成的 4 件事

| # | 谁做 | 做什么 |
|---|------|--------|
| 1 | 你 | `export AGENTWATCH_API_KEY="<Supabase anon key>"` |
| 2 | 你 | Dashboard Settings → `install_id` = `config.yaml` 里的 `agentId` |
| 3 | 你 | 两个终端：一个跑 proxy，一个发 FIFO |
| 4 | 你 | 等 5～10 秒后刷新 Dashboard |

---

## 一次性准备（若未做过）

```bash
cd /Users/alex/Desktop/agent-watch-v0
npm run build

# .env.local 已存在则跳过
# packages/web/.env.local → VITE_USE_MOCK=false
```

记录 install_id：

```bash
grep agentId ~/.agentwatch/config.yaml
# 例: agentId: "agent_c4c1a9f27199"
```

---

## Tab 1 — 前端

```bash
cd /Users/alex/Desktop/agent-watch-v0/packages/web
npm run dev
```

浏览器：

1. http://localhost:5173/settings  
2. **Install ID** 填上一步的 `agentId` → 保存  
3. 打开 Dashboard  

---

## Tab 2 — Proxy（必须用本地 CLI）

```bash
cd /Users/alex/Desktop/agent-watch-v0

export AGENTWATCH_API_KEY="你的 Supabase anon key"

bash scripts/phase-d-proxy.sh
```

成功标志：

```
gateway_ready
[echo-mcp] ready pid=...
```

**不要**在此 Tab 按 Ctrl+C（除非结束测试）。

---

## Tab 3 — 发请求

```bash
cd /Users/alex/Desktop/agent-watch-v0
bash scripts/phase-d-fifo-call.sh block-only
```

`block-only` 只发一条 **BLOCK**（transfer amount≥100000）。  
**只有 BLOCK/WARN 会上传 Supabase**；ALLOW 的 swap 不会出现在 Dashboard。

---

## 验收

### Tab 2 应看到

- `toolcall_line` + transfer  
- **不应**再出现 `cloud_upload_fault` / `Cloud upload batch failed`  

### Dashboard 应看到

- 至少 **1 条** `transfer` / **BLOCK** / 红色  

### 可选：Supabase SQL

```sql
select event_id, tool_name, final_decision, timestamp_ms
from public.events
where install_id = '你的 agentId'
order by timestamp_ms desc
limit 5;
```

---

## 故障对照

| 现象 | 原因 | 处理 |
|------|------|------|
| Tab 2 `Cannot find module .../web/scripts/echo-mcp` | 目录错了 | 用 `bash scripts/phase-d-proxy.sh`（绝对路径） |
| Tab 2 停在 `gateway_ready` | 正常等待 | Tab 3 发 FIFO |
| 日志 `cloud_upload_fault` | 用了全局旧 `agentwatch` | 改用 `bash scripts/phase-d-proxy.sh` |
| Dashboard 空，install_id 是 demo-install | 未在 Settings 保存 | 填真实 agentId |
| 只有 swap 没有 BLOCK | ALLOW 不上传 | 发 `phase-d-fifo-call.sh block-only` |
| 改过 `.env.local` 仍 mock | dev 未重启 | Tab 1 Ctrl+C 后重新 `npm run dev` |

---

## 更新全局 CLI（可选，以后可继续用 `agentwatch` 命令）

```bash
cd /Users/alex/Desktop/agent-watch-v0
npm run build
npm link
# 之后 agentwatch 指向本仓库 dist（含 Supabase 适配）
```
