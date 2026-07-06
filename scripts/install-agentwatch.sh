#!/usr/bin/env bash
# AgentWatch 一键安装 — npm 包装 CLI、init、获得 Agent ID，并打开 Dashboard 绑定页
# 用法：
#   curl -fsSL <url>/install-agentwatch.sh | bash
#   bash scripts/install-agentwatch.sh
# 环境变量：
#   AGENTWATCH_DASHBOARD_URL  默认 http://localhost:5173
#   AGENTWATCH_SKIP_INIT=1    已有 config 时跳过 init
set -euo pipefail

CLI_PKG="@agentwatch-web3/cli"
CONFIG="${HOME}/.agentwatch/config.yaml"
DASHBOARD_URL="${AGENTWATCH_DASHBOARD_URL:-http://localhost:5173}"

info() { echo "[agentwatch] $*"; }
fail() { echo "[agentwatch] 错误: $*" >&2; exit 1; }

read_yaml_field() {
  local key="$1"
  local file="$2"
  grep -E "^[[:space:]]*${key}:" "$file" 2>/dev/null | head -1 | sed -E 's/^[^:]*:[[:space:]]*"?([^"#]+)"?[[:space:]]*$/\1/' | tr -d '\r' || true
}

copy_to_clipboard() {
  local text="$1"
  if command -v pbcopy >/dev/null 2>&1; then
    printf '%s' "$text" | pbcopy
    return 0
  fi
  if command -v xclip >/dev/null 2>&1; then
    printf '%s' "$text" | xclip -selection clipboard
    return 0
  fi
  if command -v wl-copy >/dev/null 2>&1; then
    printf '%s' "$text" | wl-copy
    return 0
  fi
  return 1
}

open_dashboard() {
  local agent_id="$1"
  local upload_secret="$2"
  local q="agentId=$(python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=""))' "$agent_id")"
  if [ -n "$upload_secret" ]; then
    q="${q}&uploadSecret=$(python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=""))' "$upload_secret")"
  fi
  local url="${DASHBOARD_URL%/}/#/settings?${q}"

  info "打开 Dashboard 绑定页…"
  info "  ${url}"

  if command -v open >/dev/null 2>&1; then
    open "$url" || true
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$url" || true
  else
    info "请手动在浏览器打开上述链接"
  fi
}

# ── Node.js ──
if ! command -v node >/dev/null 2>&1; then
  fail "未检测到 Node.js。请先安装 Node.js 18+： https://nodejs.org/"
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "${NODE_MAJOR}" -lt 18 ] 2>/dev/null; then
  fail "需要 Node.js >= 18（当前: $(node -v)）"
fi

# ── npm 包 ──
info "安装 ${CLI_PKG} …"
if ! npm install -g "${CLI_PKG}@latest"; then
  fail "npm install 失败。可尝试: sudo npm install -g ${CLI_PKG}"
fi

# ── init ──
if [ -f "$CONFIG" ] && [ "${AGENTWATCH_SKIP_INIT:-0}" = "1" ]; then
  info "跳过 init（已有配置）"
elif [ -f "$CONFIG" ]; then
  info "已有 ${CONFIG}，保留现有 Agent ID（删除该文件可重新 init）"
else
  info "初始化 AgentWatch …"
  export OKX_API_KEY="${OKX_API_KEY:-demo}"
  export OKX_SECRET_KEY="${OKX_SECRET_KEY:-demo}"
  export OKX_PASSPHRASE="${OKX_PASSPHRASE:-demo}"
  export OKX_PROJECT_ID="${OKX_PROJECT_ID:-demo}"
  agentwatch-web3 init || agentwatch init
fi

[ -f "$CONFIG" ] || fail "未找到 ${CONFIG}，init 可能失败"

AGENT_ID="$(read_yaml_field agentId "$CONFIG")"
UPLOAD_SECRET="$(read_yaml_field uploadSecret "$CONFIG")"

[ -n "$AGENT_ID" ] || fail "config.yaml 中无 agentId"

info ""
info "════════════════════════════════════════"
info "  Agent ID:    ${AGENT_ID}"
if [ -n "$UPLOAD_SECRET" ]; then
  info "  上传密钥:    ${UPLOAD_SECRET}"
fi
info "════════════════════════════════════════"
info ""

CLIP="Agent ID: ${AGENT_ID}"
if [ -n "$UPLOAD_SECRET" ]; then
  CLIP="${CLIP}
上传密钥: ${UPLOAD_SECRET}"
fi

if copy_to_clipboard "$CLIP"; then
  info "凭证已复制到剪贴板"
else
  info "未能写入剪贴板，请手动复制上方凭证"
fi

open_dashboard "$AGENT_ID" "${UPLOAD_SECRET:-}"

info ""
info "下一步："
info "  1. 浏览器登录 GitHub / Wallet"
info "  2. Settings 页会自动填入 Agent ID（粘贴密钥若未预填）"
info "  3. 点击「接入 Agent」→ 重启 Cursor / Claude 使 MCP 代理生效"
info ""
