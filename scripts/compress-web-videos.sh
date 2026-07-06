#!/usr/bin/env bash
# 生成 Vercel / GitHub 可托管的 web 压缩视频 → packages/web/public/assets/videos/web/
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$REPO_ROOT/packages/web/public/assets/videos"
OUT="$SRC/web"
WEB_NODE="$REPO_ROOT/packages/web/node_modules/ffmpeg-static/ffmpeg"

if command -v ffmpeg >/dev/null 2>&1; then
  FFMPEG=ffmpeg
elif [ -x "$WEB_NODE" ]; then
  FFMPEG="$WEB_NODE"
else
  echo "❌ 需要 ffmpeg。任选其一："
  echo "   brew install ffmpeg"
  echo "   cd packages/web && npm install ffmpeg-static"
  exit 1
fi

mkdir -p "$OUT"

compress() {
  local in_file="$1"
  local out_name="$2"
  local in_path="$SRC/$in_file"
  local out_path="$OUT/$out_name"

  if [ ! -f "$in_path" ]; then
    echo "  ⚠️  跳过（源不存在）: $in_file"
    return 0
  fi

  echo "  → $out_name"
  "$FFMPEG" -y -i "$in_path" \
    -vf "scale='min(1280,iw)':-2" \
    -c:v libx264 -preset slow -crf 28 -pix_fmt yuv420p \
    -an -movflags +faststart \
    "$out_path" 2>/dev/null

  du -h "$out_path" | awk '{print "     输出:", $1}'
}

echo "=== AgentWatch · Web 视频压缩 ==="
echo "源: $SRC"
echo "输出: $OUT"
echo ""

compress "hero-girl.mp4" "hero-girl.mp4"
compress "card-discover.mp4" "card-discover.mp4"
compress "card-robot-touch.mov" "card-robot-touch.mp4"
compress "card-earth-network.mov" "card-earth-network.mp4"
compress "protection-hero.mp4" "protection-hero.mp4"
compress "auth-norway-4.mp4" "auth-norway-4.mp4"
# auth-norway-5 源文件 ~481MB，默认跳过；需要时可取消注释
# compress "auth-norway-5.mp4" "auth-norway-5.mp4"

echo ""
echo "✅ 完成。提交 web/ 目录后 Vercel 将自动加载压缩视频。"
echo "   git add packages/web/public/assets/videos/web/"
