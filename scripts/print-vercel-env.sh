#!/usr/bin/env bash
# 从 packages/web/.env.local 打印 Vercel 环境变量（复制到 Vercel 控制台）
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_LOCAL="$REPO_ROOT/packages/web/.env.local"
PROJECT_REF="${AGENTWATCH_SUPABASE_REF:-kbjcikgoawxhotwwqtin}"

read_env() {
  local key="$1"
  if [ -f "$ENV_LOCAL" ]; then
    grep -E "^${key}=" "$ENV_LOCAL" 2>/dev/null | head -1 | cut -d= -f2- || true
  fi
}

ANON="$(read_env VITE_SUPABASE_ANON_KEY)"
URL="$(read_env VITE_SUPABASE_URL)"

echo "=== 复制到 Vercel → Settings → Environment Variables ==="
echo "（Production + Preview 都勾选）"
echo ""
echo "VITE_USE_MOCK=false"
echo "VITE_SUPABASE_URL=${URL:-https://${PROJECT_REF}.supabase.co}"
if [ -n "$ANON" ]; then
  echo "VITE_SUPABASE_ANON_KEY=${ANON}"
else
  echo "VITE_SUPABASE_ANON_KEY=<Supabase → Settings → API → anon public>"
fi
echo ""
echo "Supabase Auth URL 配置："
echo "  https://supabase.com/dashboard/project/${PROJECT_REF}/auth/url-configuration"
echo ""
echo "Site URL / Redirect URLs 填入你的生产域名，例如："
echo "  https://app.你的域名.com/"
