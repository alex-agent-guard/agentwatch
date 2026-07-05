#!/usr/bin/env bash
# Phase D — 本地源码 CLI 启动 proxy（含 Supabase 上报适配，勿用全局 npm agentwatch）
# 用法：bash scripts/phase-d-proxy.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI_ENTRY="$REPO_ROOT/dist/packages/local/src/cli/index.js"
ECHO_MCP="$REPO_ROOT/scripts/echo-mcp.js"

if [ ! -f "$CLI_ENTRY" ]; then
  echo "[phase-d] dist 未构建，正在 npm run build …"
  (cd "$REPO_ROOT" && npm run build)
fi

# Demo 占位 — config 校验需要，不调用真实 OKX
export OKX_API_KEY="${OKX_API_KEY:-demo}"
export OKX_SECRET_KEY="${OKX_SECRET_KEY:-demo}"
export OKX_PASSPHRASE="${OKX_PASSPHRASE:-demo}"
export OKX_PROJECT_ID="${OKX_PROJECT_ID:-demo}"

if [ -z "${AGENTWATCH_API_KEY:-}" ]; then
  echo "[phase-d] 错误: 请先 export AGENTWATCH_API_KEY=\"<Supabase anon key>\""
  exit 1
fi

INSTALL_ID="$(grep '^agentId:' "$HOME/.agentwatch/config.yaml" 2>/dev/null | sed 's/.*"\(.*\)".*/\1/' || true)"
CLOUD_EP="$(grep -E '^[[:space:]]*endpoint:' "$HOME/.agentwatch/config.yaml" 2>/dev/null | head -1 | sed 's/.*endpoint:[[:space:]]*//' || true)"

if [[ "${CLOUD_EP:-}" != *"supabase.co"* ]]; then
  echo "[phase-d] ⚠️  cloud.endpoint 不是 Supabase：${CLOUD_EP:-（空）}"
  echo "[phase-d]     Dashboard 收不到数据。请先运行:"
  echo "[phase-d]       bash scripts/phase-d-fix-config.sh"
  echo "[phase-d]     然后 Ctrl+C 重启本 proxy。"
  exit 1
fi

echo "=== Phase D Proxy（本地 CLI + Supabase 上报）==="
echo "  repo:       $REPO_ROOT"
echo "  install_id: ${INSTALL_ID:-（未找到 ~/.agentwatch/config.yaml，请先 agentwatch init）}"
echo "  echo-mcp:   $ECHO_MCP"
echo ""
echo "  保持本终端运行；另开终端执行: bash scripts/phase-d-fifo-call.sh"
echo "  仅 BLOCK/WARN 会上传 Supabase；ALLOW 不会出现在 Dashboard"
echo ""

exec node "$CLI_ENTRY" proxy -- node "$ECHO_MCP"
