#!/usr/bin/env bash
# Phase D — 向 gateway FIFO 发送 demo tools/call（需 phase-d-proxy.sh 已在另一终端运行）
# 用法：bash scripts/phase-d-fifo-call.sh [block-only]
set -euo pipefail

PIPE="${HOME}/.agentwatch/gateway.in.fifo"
BLOCK_ONLY="${1:-}"
TS="$(date +%s)"

if [ ! -p "$PIPE" ]; then
  echo "[phase-d] 错误: FIFO 不存在 $PIPE"
  echo "  请先在另一终端运行: bash scripts/phase-d-proxy.sh"
  exit 1
fi

send() {
  printf '%s\n' "$1" > "$PIPE"
  echo "[phase-d] sent: $(echo "$1" | python3 -c 'import sys,json; d=json.load(sys.stdin); m=d.get("method","?"); p=d.get("params") or {}; print(m if m!="tools/call" else p.get("name","tools/call"), "id="+str(d.get("id")))' 2>/dev/null || echo ok)"
}

# MCP initialize — Proxy 从此采集 client_name（连接概览图标依赖此步）
CLIENT_NAME="${AGENTWATCH_DEMO_CLIENT:-claude-code}"
send "{\"jsonrpc\":\"2.0\",\"id\":\"init-${TS}\",\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2024-11-05\",\"capabilities\":{},\"clientInfo\":{\"name\":\"${CLIENT_NAME}\",\"version\":\"1.0.0\"}}}"
sleep 0.4

if [ "$BLOCK_ONLY" = "block-only" ]; then
  send "{\"jsonrpc\":\"2.0\",\"id\":\"block-${TS}\",\"method\":\"tools/call\",\"params\":{\"name\":\"transfer\",\"arguments\":{\"amount\":500000,\"to\":\"0x1234\"}}}"
else
  send "{\"jsonrpc\":\"2.0\",\"id\":\"swap-${TS}\",\"method\":\"tools/call\",\"params\":{\"name\":\"swap\",\"arguments\":{\"amount\":\"1.5 ETH\"}}}"
  sleep 0.9
  send "{\"jsonrpc\":\"2.0\",\"id\":\"transfer-${TS}\",\"method\":\"tools/call\",\"params\":{\"name\":\"transfer\",\"arguments\":{\"amount\":500000,\"to\":\"0x1234\"}}}"
fi

echo ""
echo "[phase-d] 等待 5～10 秒（CloudUpload flush）后刷新 Dashboard"
echo "[phase-d] Settings install_id 须与 config.yaml agentId 一致"
