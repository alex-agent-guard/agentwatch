#!/usr/bin/env bash
# 一键冒烟：连接概览所需的最小 Live 数据（需 3 个终端配合）
# 用法：bash scripts/smoke-connection-overview.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_LOCAL="$REPO_ROOT/packages/web/.env.local"

echo "=== 连接概览 Live 冒烟指南 ==="
echo ""

if [ -f "$ENV_LOCAL" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_LOCAL"
  set +a
fi

AGENT_ID="$(grep '^agentId:' "$HOME/.agentwatch/config.yaml" 2>/dev/null | sed 's/.*"\(.*\)".*/\1/' || true)"
UPLOAD_SECRET="$(grep 'uploadSecret:' "$HOME/.agentwatch/config.yaml" 2>/dev/null | sed 's/.*"\(.*\)".*/\1/' || true)"
ANON="${VITE_SUPABASE_ANON_KEY:-}"

echo "── 你只需做下面 5 步（其余我已准备好）──"
echo ""
echo "【一次性】Supabase SQL Editor 若未跑过，执行："
echo "  docs/supabase/add_client_name.sql"
echo "  docs/supabase/update_ingest_client_name.sql  （或整份 login_system_ddl.sql）"
echo ""
echo "【步骤 1】浏览器登录 + 绑定 Agent"
echo "  cd packages/web && npm run dev"
echo "  打开 http://localhost:5173/#/auth → GitHub 登录"
echo "  Settings → Install ID 填: ${AGENT_ID:-（先 agentwatch init）}"
echo "  Upload Secret 填: ${UPLOAD_SECRET:-（config.yaml 里 uploadSecret）}"
echo ""
echo "【步骤 2】终端 A — 启动 Proxy（保持运行）"
echo "  export AGENTWATCH_API_KEY=\"${ANON:-<Supabase anon key>}\""
echo "  export AGENTWATCH_UPLOAD_SECRET=\"${UPLOAD_SECRET:-<uploadSecret>}\""
echo "  bash scripts/phase-d-proxy.sh"
echo ""
echo "【步骤 3】终端 B — 发演示请求（含 initialize → client_name）"
echo "  bash scripts/phase-d-fifo-call.sh block-only"
echo "  # 可选模拟 Cursor: AGENTWATCH_DEMO_CLIENT=cursor bash scripts/phase-d-fifo-call.sh block-only"
echo ""
echo "【步骤 4】等 5～10 秒后打开"
echo "  http://localhost:5173/#/home"
echo ""
echo "【步骤 5】验收"
echo "  bash scripts/verify-connection-overview.sh"
echo ""
echo "── 真实 Claude / Cursor（非 Demo）──"
echo "  在 MCP 配置里把 OKX MCP 命令改为经 AgentWatch 代理，例如："
echo "  agentwatch proxy -- npx -y @okx_ai/okx-trade-mcp"
echo "  只有 WARN/BLOCK 会出现在 Dashboard；一切正常时首页显示「安全运行中」"
echo ""

bash "$REPO_ROOT/scripts/verify-connection-overview.sh" || true
