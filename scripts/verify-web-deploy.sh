#!/usr/bin/env bash
# 验收线上 Web 是否可达（传入你的生产域名）
# 用法：bash scripts/verify-web-deploy.sh https://app.example.com
set -euo pipefail

URL="${1:-}"
if [ -z "$URL" ]; then
  echo "用法: bash scripts/verify-web-deploy.sh https://app.你的域名.com"
  exit 1
fi

URL="${URL%/}"
TMP="$(mktemp -t aw-index.XXXXXX.html)"
trap 'rm -f "$TMP"' EXIT

pass=0
fail=0
warn=0

ok()   { echo "  ✅ $1"; pass=$((pass + 1)); }
bad()  { echo "  ❌ $1"; fail=$((fail + 1)); }
hint() { echo "  ⚠️  $1"; warn=$((warn + 1)); }

echo "=== Web 部署验收: $URL ==="
echo ""

# HTTPS
if [[ "$URL" == http://* ]]; then
  hint "建议使用 HTTPS 生产域名"
fi

code_root=$(curl -sL -o "$TMP" -w "%{http_code}" "$URL/" 2>/dev/null || echo "000")
code_html=$(curl -sL -o /dev/null -w "%{http_code}" "$URL/index.html" 2>/dev/null || echo "000")

echo "HTTP 检查"
if [ "$code_root" = "200" ] || [ "$code_html" = "200" ]; then
  ok "根路径可达 (GET / → $code_root, /index.html → $code_html)"
else
  bad "根路径不可达 (GET / → $code_root, /index.html → $code_html)"
fi

if grep -q 'assets/' "$TMP" 2>/dev/null; then
  ok "index.html 含 Vite 打包资源引用"
  asset_path=$(grep -oE '/assets/[^"'\'' ]+\.js' "$TMP" | head -1 || true)
  if [ -n "$asset_path" ]; then
    asset_code=$(curl -sL -o /dev/null -w "%{http_code}" "${URL}${asset_path}" 2>/dev/null || echo "000")
    if [ "$asset_code" = "200" ]; then
      ok "主 JS 资源可加载 (${asset_path})"
    else
      bad "主 JS 资源 HTTP $asset_code — 检查 Root Directory 是否为 packages/web"
    fi
  fi
else
  bad "index.html 缺少 assets/ 引用，可能构建或 base 路径错误"
fi

echo ""
echo "手动浏览器验收（必做）"
echo "  $URL/#/preview/home     Demo 无需登录"
echo "  $URL/#/auth             GitHub / Wallet 登录"
echo "  登录后新用户 → $URL/#/activate"
echo ""
echo "Supabase Auth Redirect URLs 必须包含："
echo "  ${URL}/"
echo ""

if [ "$fail" -gt 0 ]; then
  echo "结果: ${pass} 通过, ${warn} 警告, ${fail} 失败"
  exit 1
fi

echo "结果: ${pass} 通过, ${warn} 警告 — 请在浏览器完成登录与激活流程验收"
