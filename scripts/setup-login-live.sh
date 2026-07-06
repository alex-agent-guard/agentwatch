#!/usr/bin/env bash
# AgentWatch Login Live 一键准备（本地开发）
# 用法：bash scripts/setup-login-live.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_LOCAL="$REPO_ROOT/packages/web/.env.local"
ENV_EXAMPLE="$REPO_ROOT/packages/web/.env.example"
PROJECT_REF="${AGENTWATCH_SUPABASE_REF:-kbjcikgoawxhotwwqtin}"
SUPABASE_URL="https://${PROJECT_REF}.supabase.co"
ANON_DEFAULT="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtiamNpa2dvYXd4aG90d3dxdGluIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxNzU4NzcsImV4cCI6MjA5ODc1MTg3N30.msWhe0oqAf_lmQoHOE5BmrMTDNevRls0qjUA-vnqfYQ"

echo "=== AgentWatch Login Live 准备 ==="

# 1. .env.local
if [ ! -f "$ENV_LOCAL" ]; then
  if [ -f "$ENV_EXAMPLE" ]; then
    cp "$ENV_EXAMPLE" "$ENV_LOCAL"
  fi
  cat > "$ENV_LOCAL" <<EOF
VITE_USE_MOCK=false
VITE_SUPABASE_URL=${SUPABASE_URL}
VITE_SUPABASE_ANON_KEY=${ANON_DEFAULT}
EOF
  echo "[setup] 已创建 packages/web/.env.local"
else
  echo "[setup] .env.local 已存在，跳过"
fi

# 2. 构建
echo "[setup] npm run build …"
(cd "$REPO_ROOT" && npm run build)

# 3. CLI init（若未 init）
export OKX_API_KEY="${OKX_API_KEY:-demo}"
export OKX_SECRET_KEY="${OKX_SECRET_KEY:-demo}"
export OKX_PASSPHRASE="${OKX_PASSPHRASE:-demo}"
export OKX_PROJECT_ID="${OKX_PROJECT_ID:-demo}"
export AGENTWATCH_API_KEY="${AGENTWATCH_API_KEY:-$ANON_DEFAULT}"

CLI="$REPO_ROOT/dist/packages/local/src/cli/index.js"
if [ ! -f "$HOME/.agentwatch/config.yaml" ]; then
  echo "[setup] agentwatch init …"
  node "$CLI" init --force
else
  echo "[setup] ~/.agentwatch/config.yaml 已存在"
fi

# 4. 修正 cloud endpoint
bash "$REPO_ROOT/scripts/phase-d-fix-config.sh"

# 5. 打印凭证
echo ""
echo "=== 本地凭证（Settings 绑定用）==="
grep '^agentId:' "$HOME/.agentwatch/config.yaml" || true
grep 'uploadSecret:' "$HOME/.agentwatch/config.yaml" || grep 'upload_secret' "$HOME/.agentwatch/config.yaml" || true
echo ""
echo "=== Supabase 人工步骤（必做）==="
echo "  1. 打开 https://supabase.com/dashboard/project/${PROJECT_REF}/auth/providers"
echo "  2. 启用 GitHub → 填 OAuth App Client ID / Secret"
echo "     GitHub Callback URL: ${SUPABASE_URL}/auth/v1/callback"
echo "  3. 启用 Web3 Wallet → Ethereum"
echo "  4. Auth → URL Configuration → Redirect: http://localhost:5173/"
echo ""
echo "=== 启动 ==="
echo "  终端 1: cd packages/web && npm run dev"
echo "  终端 2: export AGENTWATCH_UPLOAD_SECRET=\"\$(grep uploadSecret ~/.agentwatch/config.yaml | sed 's/.*\"\\(.*\\)\".*/\\1/')\""
echo "           export AGENTWATCH_API_KEY=\"\$VITE_SUPABASE_ANON_KEY\""
echo "           bash scripts/phase-d-proxy.sh"
echo "  浏览器: http://localhost:5173/#/auth"
echo ""
bash "$REPO_ROOT/scripts/verify-login-setup.sh" || true
