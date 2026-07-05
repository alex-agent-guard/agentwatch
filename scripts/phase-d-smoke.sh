#!/usr/bin/env bash
# 单条 BLOCK 冒烟测试 + 检查 Supabase 是否写入（排查 Dashboard 无数据）
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PIPE="${HOME}/.agentwatch/gateway.in.fifo"
INSTALL_ID="$(grep '^agentId:' "$HOME/.agentwatch/config.yaml" | sed 's/.*"\(.*\)".*/\1/')"
KEY="${AGENTWATCH_API_KEY:-}"

if [ -z "$KEY" ]; then
  echo "[smoke] 请先 export AGENTWATCH_API_KEY"
  exit 1
fi

if [ ! -p "$PIPE" ]; then
  echo "[smoke] FIFO 不存在 → 请先 bash scripts/phase-d-proxy.sh"
  exit 1
fi

EID="smoke-$(uuidgen 2>/dev/null | tr '[:upper:]' '[:lower:]' || echo "${RANDOM}-$(date +%s)")"
echo "[smoke] install_id=$INSTALL_ID event_id=$EID"

printf '%s\n' "{\"jsonrpc\":\"2.0\",\"id\":\"${EID}\",\"method\":\"tools/call\",\"params\":{\"name\":\"transfer\",\"arguments\":{\"amount\":500000,\"to\":\"0xsmoke\"}}}" > "$PIPE"
echo "[smoke] 已发 FIFO，等待 8 秒上报…"
sleep 8

echo "[smoke] Supabase 查询:"
curl -s "https://kbjcikgoawxhotwwqtin.supabase.co/rest/v1/events?install_id=eq.${INSTALL_ID}&event_id=eq.${EID}&select=event_id,tool_name,final_decision" \
  -H "apikey: ${KEY}" \
  -H "Authorization: Bearer ${KEY}" \
  -H "x-install-id: ${INSTALL_ID}" | python3 -m json.tool 2>/dev/null || true

echo ""
echo "[smoke] 若上面有 transfer/BLOCK → 刷新 Dashboard（install_id=${INSTALL_ID}）"
