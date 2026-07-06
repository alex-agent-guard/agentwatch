#!/usr/bin/env bash
# AgentWatch Login v1 — 逐项验收 Supabase + 前端 Live 配置
# 用法：bash scripts/verify-login-setup.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_LOCAL="$REPO_ROOT/packages/web/.env.local"
PROJECT_REF="${AGENTWATCH_SUPABASE_REF:-kbjcikgoawxhotwwqtin}"
SUPABASE_URL="${VITE_SUPABASE_URL:-https://${PROJECT_REF}.supabase.co}"

pass=0
fail=0
warn=0

ok()   { echo "  ✅ $1"; pass=$((pass + 1)); }
bad()  { echo "  ❌ $1"; fail=$((fail + 1)); }
hint() { echo "  ⚠️  $1"; warn=$((warn + 1)); }

read_env() {
  if [ -f "$ENV_LOCAL" ]; then
    set -a
    # shellcheck disable=SC1090
    source "$ENV_LOCAL"
    set +a
  fi
}

read_env

ANON_KEY="${VITE_SUPABASE_ANON_KEY:-}"
if [ -z "$ANON_KEY" ]; then
  ANON_KEY="${AGENTWATCH_API_KEY:-}"
fi

echo "=== AgentWatch Login 验收 ==="
echo "  project: $PROJECT_REF"
echo ""

echo "[1] 前端 Live 配置"
if [ -f "$ENV_LOCAL" ]; then
  ok ".env.local 存在"
else
  bad ".env.local 缺失 — 运行: bash scripts/setup-login-live.sh"
fi

if [ "${VITE_USE_MOCK:-true}" = "false" ]; then
  ok "VITE_USE_MOCK=false"
else
  bad "VITE_USE_MOCK 不是 false（当前: ${VITE_USE_MOCK:-未设置}）"
fi

if [ -n "${VITE_SUPABASE_URL:-}" ] && [ -n "${VITE_SUPABASE_ANON_KEY:-}" ]; then
  ok "Supabase URL + anon key 已配置"
else
  bad "VITE_SUPABASE_URL 或 VITE_SUPABASE_ANON_KEY 缺失"
fi
echo ""

echo "[2] Supabase 表与 Edge Function"
if [ -z "$ANON_KEY" ]; then
  bad "无 anon key，跳过 REST 探测"
else
  code_events=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" \
    "$SUPABASE_URL/rest/v1/events?select=event_id&limit=1")
  if [ "$code_events" = "200" ]; then ok "events 表可达 ($code_events)"; elif [ "$code_events" = "401" ]; then hint "events HTTP 401 — 检查 anon key 或 RLS（登录后 SELECT 才生效）"; else bad "events 表 HTTP $code_events"; fi

  code_agents=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" \
    "$SUPABASE_URL/rest/v1/user_agents?select=id&limit=1")
  if [ "$code_agents" = "200" ]; then ok "user_agents 表可达 ($code_agents)"; elif [ "$code_agents" = "401" ]; then hint "user_agents HTTP 401 — 需 authenticated session（正常）"; else bad "user_agents 表 HTTP $code_agents — 跑 login_system_ddl.sql"; fi

  ef_body=$(curl -s -X POST -H "Content-Type: application/json" \
    -d '{"install_id":"verify-probe","upload_secret":"bad","events":[]}' \
    "$SUPABASE_URL/functions/v1/upload-events")
  if echo "$ef_body" | grep -q "upload_credentials_not_found"; then
    ok "upload-events Edge Function 正常 (401 expected)"
  elif echo "$ef_body" | grep -q "server_misconfigured"; then
    bad "Edge Function 未部署 — supabase functions deploy upload-events"
  else
    hint "Edge Function 响应: $ef_body"
  fi
fi
echo ""

echo "[3] Auth Provider（GitHub / Wallet）"
if [ -n "$ANON_KEY" ]; then
  settings=$(curl -s "$SUPABASE_URL/auth/v1/settings" -H "apikey: $ANON_KEY")
  github_on=$(echo "$settings" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('external',{}).get('github', False))" 2>/dev/null || echo "unknown")
  if [ "$github_on" = "True" ] || [ "$github_on" = "true" ]; then
    ok "GitHub OAuth 已启用"
  else
    bad "GitHub OAuth 未启用 — Supabase Dashboard → Auth → Providers → GitHub"
    echo "       GitHub OAuth App Callback: ${SUPABASE_URL}/auth/v1/callback"
    echo "       Redirect URL: http://localhost:5173/"
  fi
  hint "Wallet(SIWE): Supabase Dashboard → Auth → Providers → Web3 Wallet → Ethereum（需人工确认）"
fi
echo ""

echo "[4] 本地 CLI"
CONFIG="$HOME/.agentwatch/config.yaml"
if [ -f "$CONFIG" ]; then
  ok "config.yaml 存在"
  AGENT_ID=$(grep '^agentId:' "$CONFIG" 2>/dev/null | sed 's/.*"\(.*\)".*/\1/' || true)
  if [ -n "$AGENT_ID" ]; then ok "agentId: $AGENT_ID"; else hint "config.yaml 无 agentId"; fi
  if grep -q 'supabase.co' "$CONFIG" 2>/dev/null; then ok "cloud.endpoint 指向 Supabase"; else hint "运行 bash scripts/phase-d-fix-config.sh"; fi
else
  hint "未 init — 运行: npx tsx packages/local/src/cli/index.ts init --force"
fi
echo ""

echo "[5] 前端构建"
if [ -d "$REPO_ROOT/packages/web/dist" ]; then ok "packages/web/dist 存在"; else hint "运行: cd packages/web && npm run build"; fi
echo ""

echo "=== 汇总: ✅ $pass  ⚠️  $warn  ❌ $fail ==="
if [ "$fail" -gt 0 ]; then
  echo ""
  echo "下一步："
  echo "  1. Supabase 启用 GitHub OAuth（见 docs/LOGIN_SETUP.md §5.2）"
  echo "  2. bash scripts/setup-login-live.sh"
  echo "  3. cd packages/web && npm run dev → http://localhost:5173/#/auth"
  exit 1
fi
exit 0
