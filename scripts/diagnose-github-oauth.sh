#!/usr/bin/env bash
# 诊断 GitHub OAuth 配置 — 打印 Supabase 实际使用的 Client ID 和 Callback
# 用法：bash scripts/diagnose-github-oauth.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_LOCAL="$REPO_ROOT/packages/web/.env.local"
PROJECT_REF="${AGENTWATCH_SUPABASE_REF:-kbjcikgoawxhotwwqtin}"

if [ -f "$ENV_LOCAL" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_LOCAL"
  set +a
fi

ANON_KEY="${VITE_SUPABASE_ANON_KEY:-}"
SUPABASE_URL="${VITE_SUPABASE_URL:-https://${PROJECT_REF}.supabase.co}"

if [ -z "$ANON_KEY" ]; then
  echo "❌ 缺少 VITE_SUPABASE_ANON_KEY（packages/web/.env.local）"
  exit 1
fi

echo "=== GitHub OAuth 诊断 ==="
echo ""

RESP=$(curl -s "$SUPABASE_URL/auth/v1/authorize?provider=github&redirect_to=http%3A%2F%2Flocalhost%3A5173%2F" \
  -H "apikey: $ANON_KEY" -H "Accept: application/json")

python3 <<PY
import html, re, urllib.parse, sys
s = """$RESP"""
m = re.search(r'href="([^"]+)"', s)
if not m:
    print("❌ 无法获取 GitHub 授权 URL — 检查 Supabase GitHub Provider 是否启用")
    sys.exit(1)
url = html.unescape(m.group(1))
q = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
client_id = q.get("client_id", [""])[0]
redirect_uri = q.get("redirect_uri", [""])[0]
print("Supabase 侧：正常 ✅")
print("")
print("GitHub OAuth App 必须满足以下两项（一字不差）：")
print("")
print("  Client ID（Supabase 正在用这个）：")
print(f"    {client_id}")
print("")
print("  Authorization callback URL（GitHub App 里必须填）：")
print(f"    {redirect_uri}")
print("")
print("── 你要做的 ──")
print("1. 打开 https://github.com/settings/developers → OAuth Apps")
print("2. 找到 Client ID 正好是上面那个的 App")
print("3. Authorization callback URL 填上面那行 → Update application")
print("")
print("若找不到这个 Client ID 的 App：")
print("  → 用 AgentWatch Local Dev 的 ID+Secret 填进 Supabase GitHub Provider")
print("  → 并在 Local Dev 的 Callback 填上面那行")
print("  → https://supabase.com/dashboard/project/${PROJECT_REF}/auth/providers")
PY
