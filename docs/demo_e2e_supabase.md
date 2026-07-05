# AgentWatch V0 — Supabase 端到端 Demo 复现脚本

> 前置：已执行 `docs/supabase/events_ddl.sql`  
> 闭环：proxy BLOCK → log.jsonl → Supabase events → Dashboard

---

## 0. 环境变量

```bash
# Supabase anon key（勿提交 git）
export AGENTWATCH_API_KEY="<your_supabase_anon_key>"
```

---

## 1. 本地 CLI 初始化

```bash
cd /path/to/agent-watch-v0/packages/local
npm run build   # 或 monorepo 根目录等价命令

# 初始化配置
npx @agentwatch-web3/cli init

# 记录 install_id（= agentId）
export INSTALL_ID=$(grep '^agentId:' ~/.agentwatch/config.yaml | sed 's/.*"\(.*\)".*/\1/')
echo "install_id=$INSTALL_ID"
```

验收：

```bash
agentwatch audit verify
echo "exit=$?"   # 期望 0
```

---

## 2. 启动 Proxy 并触发 BLOCK

终端 A：

```bash
export AGENTWATCH_API_KEY="<anon_key>"
agentwatch proxy
# 或项目文档中的 proxy 启动方式
```

终端 B：通过 MCP 客户端或 `echo-mcp` 触发一次会被 BLOCK 的 `tools/call`（参见 `docs/e2e_full_pipeline.md`）。

验收：

- `~/.agentwatch/log.jsonl`（或分级 jsonl）含该事件
- `_meta.hmac` 存在

---

## 3. 等待云端上报

EventUploader 默认 **5s flush**。等待 ≤10s 后检查 Supabase Table Editor → `public.events`：

- `install_id` = `$INSTALL_ID`
- `final_decision` = `BLOCK`（或 `WARN`）
- `event_id` 与本地日志一致

若为空：

1. 确认 `config.yaml` → `cloud.enabled: true`
2. 确认 endpoint 为 `https://<project>.supabase.co/rest/v1/`
3. 确认 `AGENTWATCH_API_KEY` 已替换进 config（或 env substitution 生效）
4. 查看 CLI stderr `[CloudUpload]` / `[CloudClient]` 告警

---

## 4. 前端 Dashboard Live

```bash
cd packages/web
cat > .env.local <<EOF
VITE_USE_MOCK=false
EOF
npm install
npm run dev
```

浏览器：

1. 打开 `http://localhost:5173/settings`
2. Install ID 填入 `$INSTALL_ID` → 保存
3. 打开 Dashboard → 应看到 Supabase 行
4. `final_decision` / 风险色与 CLI 一致

**RLS 隔离验证**

- Settings 改为错误 install_id → Dashboard 应为空或仅 mock 回退提示
- 改回正确 `$INSTALL_ID` → 数据恢复

---

## 5. 四条 Demo 标准核对表

| # | 标准 | 命令/操作 | 通过 |
|---|------|-----------|------|
| 1 | audit verify exit 0 | `agentwatch audit verify` | ⬜ |
| 2 | Supabase 有 event_id | Table Editor | ⬜ |
| 3 | Dashboard 与 CLI 一致 | 对比 decision/score | ⬜ |
| 4 | RLS 隔离 | 换 install_id | ⬜ |

---

## 6. 单元测试（开发自检）

```bash
cd packages/local
npm test -- cloud
```

期望：CloudClient legacy + Supabase 分支 + mapper 全绿。

---

## 相关文件

| 文件 | 用途 |
|------|------|
| `docs/supabase/events_ddl.sql` | 建表 + RLS |
| `packages/local/src/cloud/supabaseEventMapper.ts` | 字段映射 |
| `packages/local/src/cloud/supabaseCloudTransport.ts` | PostgREST POST |
| `packages/web/.env.example` | 前端 mock 开关示例 |
| `docs/phase04_execution_checklist.md` | 分阶段勾选 |
