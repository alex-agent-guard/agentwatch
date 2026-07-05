#!/usr/bin/env bash
# 将 ~/.agentwatch/config.yaml 的 agentWatch.cloud.endpoint 修正为 Supabase PostgREST
set -euo pipefail

CONFIG="${HOME}/.agentwatch/config.yaml"
SUPABASE_ENDPOINT="${AGENTWATCH_SUPABASE_ENDPOINT:-https://kbjcikgoawxhotwwqtin.supabase.co/rest/v1/}"

if [ ! -f "$CONFIG" ]; then
  echo "[fix-config] 错误: 未找到 $CONFIG，请先 agentwatch init"
  exit 1
fi

cp -a "$CONFIG" "${CONFIG}.bak-$(date +%s)"

python3 <<PY
from pathlib import Path

path = Path("$CONFIG")
lines = path.read_text(encoding="utf-8").splitlines()
new_endpoint = "$SUPABASE_ENDPOINT"
in_cloud = False
patched = False

for i, line in enumerate(lines):
    stripped = line.strip()
    if stripped == "cloud:":
        in_cloud = True
        continue
    if in_cloud and line.startswith("  ") and not line.startswith("    "):
        in_cloud = False
    if in_cloud and stripped.startswith("endpoint:"):
        lines[i] = f"    endpoint: {new_endpoint}"
        patched = True
        break

if not patched:
    raise SystemExit("[fix-config] 未找到 agentWatch.cloud.endpoint 行")

path.write_text("\n".join(lines) + "\n", encoding="utf-8")
print(f"[fix-config] endpoint → {new_endpoint}")
PY

echo "[fix-config] 当前 cloud 配置:"
grep -A3 '  cloud:' "$CONFIG"
