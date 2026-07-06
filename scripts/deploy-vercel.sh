#!/usr/bin/env bash
# AgentWatch Web → Vercel 商用部署助手
# 用法：
#   bash scripts/deploy-vercel.sh              # 交互式
#   NON_INTERACTIVE=1 bash scripts/deploy-vercel.sh   # CI / 无 TTY
#   VERCEL_TOKEN=xxx NON_INTERACTIVE=1 bash scripts/deploy-vercel.sh --prod
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB="$REPO_ROOT/packages/web"
PROJECT_REF="${AGENTWATCH_SUPABASE_REF:-kbjcikgoawxhotwwqtin}"
ENV_LOCAL="$WEB/.env.local"
PROD_ONLY=false

for arg in "$@"; do
  case "$arg" in
    --prod) PROD_ONLY=true ;;
  esac
done

read_env_local() {
  local key="$1"
  if [ -f "$ENV_LOCAL" ]; then
    grep -E "^${key}=" "$ENV_LOCAL" 2>/dev/null | head -1 | cut -d= -f2- || true
  fi
}

prompt() {
  if [ "${NON_INTERACTIVE:-}" = "1" ] || [ ! -t 0 ]; then
    return 0
  fi
  read -r -p "$1" _
}

echo "=== AgentWatch Web · Vercel 部署 ==="
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "❌ 需要 Node.js 18+"
  exit 1
fi

if ! command -v npx >/dev/null 2>&1; then
  echo "❌ 需要 npm / npx"
  exit 1
fi

ANON_KEY="${VITE_SUPABASE_ANON_KEY:-$(read_env_local VITE_SUPABASE_ANON_KEY)}"
SUPABASE_URL="${VITE_SUPABASE_URL:-$(read_env_local VITE_SUPABASE_URL)}"
SUPABASE_URL="${SUPABASE_URL:-https://${PROJECT_REF}.supabase.co}"

if [ -z "$ANON_KEY" ]; then
  echo "⚠️  未找到 VITE_SUPABASE_ANON_KEY（.env.local 或环境变量）"
  echo "   构建仍可继续；生产部署前必须在 Vercel 控制台配置该变量。"
  ANON_KEY="build-only-placeholder"
fi

if [ "$PROD_ONLY" = false ]; then
  echo "[1/4] 本地构建自检…"
  cd "$WEB"
  npm ci
  VITE_USE_MOCK=false \
  VITE_SUPABASE_URL="$SUPABASE_URL" \
  VITE_SUPABASE_ANON_KEY="$ANON_KEY" \
    npm run build

  if [ ! -f dist/index.html ]; then
    echo "❌ 构建失败：dist/index.html 不存在"
    exit 1
  fi
  echo "✅ 构建通过"
  echo ""
fi

if [ -z "${VERCEL_TOKEN:-}" ]; then
  echo "[2/4] Vercel 登录（若未登录会打开浏览器）…"
  npx vercel login || true
else
  echo "[2/4] 使用 VERCEL_TOKEN 环境变量（跳过 login）"
fi
echo ""

echo "[3/4] 关联并部署 Preview…"
echo "  首次会询问：Project name 建议 agentwatch-web；目录已是 packages/web"
echo ""

prompt "按 Enter 开始 vercel preview 部署…"

VERCEL_ARGS=(--cwd "$WEB")
if [ "${NON_INTERACTIVE:-}" = "1" ] || [ ! -t 0 ]; then
  VERCEL_ARGS+=(--yes)
fi

npx vercel "${VERCEL_ARGS[@]}"

echo ""
echo "[4/4] 生产部署（--prod）…"
prompt "确认 Vercel 环境变量已配置？按 Enter 继续 production deploy…"

PROD_ARGS=(--cwd "$WEB" --prod)
if [ "${NON_INTERACTIVE:-}" = "1" ] || [ ! -t 0 ]; then
  PROD_ARGS+=(--yes)
fi

npx vercel "${PROD_ARGS[@]}"

echo ""
echo "=== 部署后必做（商用）==="
echo ""
echo "1. 打印环境变量模板："
echo "     bash scripts/print-vercel-env.sh"
echo ""
echo "2. Vercel → Settings → Domains → 添加自有域名（如 app.你的域名.com）"
echo "   DNS: CNAME app → cname.vercel-dns.com"
echo ""
echo "3. Supabase Auth → URL Configuration"
echo "   https://supabase.com/dashboard/project/${PROJECT_REF}/auth/url-configuration"
echo "   Site URL + Redirect URLs："
echo "     https://你的自有域名/"
echo ""
echo "4. 验收："
echo "     bash scripts/verify-web-deploy.sh https://你的自有域名.com"
echo ""
echo "完整文档：docs/DEPLOY_WEB.md"
echo ""
