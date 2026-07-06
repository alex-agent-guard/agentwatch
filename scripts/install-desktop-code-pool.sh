#!/usr/bin/env bash
# 把码池看板安装到 Mac 桌面 — 双击「打开码池看板.command」即可
set -euo pipefail

DESKTOP="$HOME/Desktop/AgentWatch码池"
SRC="$(cd "$(dirname "$0")/desktop-code-pool" && pwd)"

echo "=== 安装 AgentWatch 码池看板 → $DESKTOP ==="
mkdir -p "$DESKTOP"
cp "$SRC/server.mjs" "$SRC/dashboard.html" "$DESKTOP/"

if [ ! -f "$DESKTOP/.env.local" ]; then
  cp "$SRC/.env.example" "$DESKTOP/.env.local"
  echo ""
  echo "⚠️  请编辑桌面文件夹里的 .env.local"
  echo "   填入 SUPABASE_SERVICE_ROLE_KEY（Supabase → Settings → API → service_role secret）"
  echo ""
fi

cat > "$DESKTOP/打开码池看板.command" <<'CMD'
#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  osascript -e 'display alert "需要 Node.js" message "请先安装 Node.js 18+"'
  exit 1
fi
if [ ! -f .env.local ] || ! grep -E 'SUPABASE_SERVICE_ROLE_KEY=(ey|sb_secret_)' .env.local >/dev/null 2>&1; then
  osascript -e 'display alert "请先配置密钥" message "打开 .env.local，填入 Secret key（sb_secret_...）或 Legacy 的 service_role（eyJ...）"'
  open -e .env.local 2>/dev/null || open .env.local
  exit 1
fi
# 已在跑则直接打开浏览器
if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3920/ | grep -q 200; then
  open "http://127.0.0.1:3920"
  exit 0
fi
node server.mjs
CMD

chmod +x "$DESKTOP/打开码池看板.command"

DESKTOP_LAUNCHER="$HOME/Desktop/打开AgentWatch码池.command"
cat > "$DESKTOP_LAUNCHER" <<'LAUNCH'
#!/bin/bash
APP_DIR="$HOME/Desktop/AgentWatch码池"
[ -d "$APP_DIR" ] || { osascript -e 'display alert "未找到 AgentWatch码池 文件夹"'; exit 1; }
exec "$APP_DIR/打开码池看板.command"
LAUNCH
chmod +x "$DESKTOP_LAUNCHER"

echo "✅ 已安装到: $DESKTOP"
echo "✅ 桌面快捷方式: $DESKTOP_LAUNCHER"
echo ""
echo "下一步："
echo "  1. 打开 $DESKTOP/.env.local"
echo "  2. 粘贴 Secret key 或 Legacy service_role"
echo "     https://supabase.com/dashboard/project/kbjcikgoawxhotwwqtin/settings/api-keys"
echo "  3. 双击「打开码池看板.command」"
echo ""

if [ "${1:-}" = "--open" ]; then
  open "$DESKTOP"
fi
