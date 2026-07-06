#!/usr/bin/env bash
# 连接概览 Live 验收 — client_name / service_name 字段 + 上报链路
# 用法：bash scripts/verify-connection-overview.sh
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

if [ -f "$ENV_LOCAL" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_LOCAL"
  set +a
fi

ANON_KEY="${VITE_SUPABASE_ANON_KEY:-${AGENTWATCH_API_KEY:-}}"
INSTALL_ID="$(grep '^agentId:' "$HOME/.agentwatch/config.yaml" 2>/dev/null | sed 's/.*"\(.*\)".*/\1/' || true)"

echo "=== 连接概览 Live 验收 ==="
echo "  project:    $PROJECT_REF"
echo "  install_id: ${INSTALL_ID:-（未 init）}"
echo ""

echo "[1] 本地 CLI 已含 client_name 采集"
CLI_SRC="$REPO_ROOT/packages/local/src/proxy/MCPProxyCore.ts"
if grep -q 'captureInitializeClient' "$CLI_SRC" 2>/dev/null; then
  ok "MCPProxyCore 采集 initialize.clientInfo"
else
  bad "MCPProxyCore 缺少 client 采集 — 请 git pull + npm run build"
fi

if [ -f "$REPO_ROOT/dist/packages/local/src/cli/index.js" ]; then
  ok "dist CLI 已构建"
else
  bad "dist 未构建 — 运行: npm run build"
fi
echo ""

echo "[2] Supabase events 表 — client_name 列"
if [ -z "$ANON_KEY" ]; then
  bad "无 anon key，跳过 REST 探测"
else
  probe=$(curl -s \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" \
    "$SUPABASE_URL/rest/v1/events?select=client_name&limit=1")
  if echo "$probe" | grep -q 'client_name'; then
    ok "client_name 列存在（REST 可读）"
  elif echo "$probe" | grep -qi 'column.*does not exist\|42703'; then
    bad "client_name 列缺失 — 在 Supabase SQL Editor 执行 docs/supabase/add_client_name.sql"
  else
    hint "REST 响应: $probe"
  fi

  if [ -n "$INSTALL_ID" ]; then
    recent=$(curl -s \
      -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" \
      "$SUPABASE_URL/rest/v1/events?select=event_id,client_name,service_name,final_decision&install_id=eq.${INSTALL_ID}&order=timestamp_ms.desc&limit=5")
    with_client=$(echo "$recent" | python3 -c "
import sys, json
try:
  rows = json.load(sys.stdin)
  n = sum(1 for r in rows if (r.get('client_name') or '').strip())
  svc = sum(1 for r in rows if (r.get('service_name') or '').strip() not in ('', 'tools/call'))
  print(f'{n}|{svc}|{len(rows)}')
except Exception:
  print('0|0|0')
" 2>/dev/null || echo "0|0|0")
    IFS='|' read -r client_cnt svc_cnt total <<< "$with_client"
    if [ "${total:-0}" -eq 0 ]; then
      hint "install_id=$INSTALL_ID 尚无云端事件（需 WARN/BLOCK 上报 + Settings 绑定）"
    elif [ "${client_cnt:-0}" -gt 0 ] && [ "${svc_cnt:-0}" -gt 0 ]; then
      ok "最近 ${total} 条中 ${client_cnt} 条有 client_name、${svc_cnt} 条有真实 service_name"
    else
      hint "有 ${total} 条事件，但 client_name/service_name 仍为空 — 请用最新 CLI 重新跑 proxy 并发请求"
      echo "       旧数据 service_name=tools/call 会显示「服务待上报」"
    fi
  fi
fi
echo ""

echo "[3] 上报策略（重要）"
hint "仅 WARN / BLOCK 事件上传 Supabase；正常 ALLOW 不会出现在 /home"
hint "要看到连接概览：跑 block 演示，或在 Claude/Cursor 里触发风险拦截"
echo ""

echo "[4] 前端 Live"
if [ "${VITE_USE_MOCK:-true}" = "false" ]; then
  ok "VITE_USE_MOCK=false"
else
  bad "VITE_USE_MOCK 不是 false"
fi
echo ""

echo "=== 汇总: ✅ $pass  ⚠️  $warn  ❌ $fail ==="
if [ "$fail" -gt 0 ]; then
  exit 1
fi
exit 0
