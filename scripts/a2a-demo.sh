#!/usr/bin/env bash
# AgentWatch A2A Demo — 半自动化安装与录屏指引
# 用法：bash scripts/a2a-demo.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ECHO_MCP="$REPO_ROOT/scripts/echo-mcp.js"

resolve_agentwatch() {
  if command -v agentwatch >/dev/null 2>&1; then
    echo "agentwatch"
    return
  fi
  if [ -f "$REPO_ROOT/packages/local/src/cli/index.ts" ]; then
    echo "npx tsx $REPO_ROOT/packages/local/src/cli/index.ts"
    return
  fi
  echo "npx @agentwatch/cli"
}

AGENTWATCH="$(resolve_agentwatch)"

# Config validation requires OKX env placeholders even when using echo-mcp downstream.
export OKX_API_KEY="${OKX_API_KEY:-demo}"
export OKX_SECRET_KEY="${OKX_SECRET_KEY:-demo}"
export OKX_PASSPHRASE="${OKX_PASSPHRASE:-demo}"
export OKX_PROJECT_ID="${OKX_PROJECT_ID:-demo}"
export AGENTWATCH_API_KEY="${AGENTWATCH_API_KEY:-demo}"

echo "=== AgentWatch A2A Demo ==="
echo ""
echo "[1/4] Installing..."
npm install -g @agentwatch/cli 2>/dev/null || true
echo "      (skip if already installed; local dev uses: $AGENTWATCH)"
echo ""
echo "[2/4] Initializing..."
$AGENTWATCH init --force 2>/dev/null || $AGENTWATCH init
echo ""
echo "[3/4] Starting proxy..."
echo "Run in a separate terminal:"
echo ""
echo "  $AGENTWATCH proxy -- node $ECHO_MCP"
echo ""
echo "Then pipe sample tool calls (or use your Agent client). Example:"
echo ""
echo '  echo '"'"'{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"swap","arguments":{"amount":"1.5 ETH"}}}'"'"' | '"$AGENTWATCH"' proxy -- node '"$ECHO_MCP"
echo ""
echo '  echo '"'"'{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"transfer","arguments":{"amount":500000,"to":"0x1234"}}}'"'"' | '"$AGENTWATCH"' proxy -- node '"$ECHO_MCP"
echo "      ^ transfer with amount>=100000 → L0 BLOCK demo"
echo ""
echo "[4/4] After triggering calls, run:"
echo ""
echo "  $AGENTWATCH audit verify"
echo ""
echo "Expected: ✅ Chain verified: N entries intact"
echo ""
echo "Full storyboard: see DEMO.md"
