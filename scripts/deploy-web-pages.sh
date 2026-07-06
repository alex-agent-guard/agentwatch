#!/usr/bin/env bash
# 本地触发说明 — 实际部署由 GitHub Actions 完成
set -euo pipefail

echo "=== AgentWatch Web 部署 ==="
echo ""
echo "生产站（GitHub Pages）："
echo "  https://alex-agent-guard.github.io/agentwatch/"
echo ""
echo "若尚未启用 Pages："
echo "  1. https://github.com/alex-agent-guard/agentwatch/settings/pages"
echo "  2. Source → GitHub Actions"
echo "  3. Actions → Deploy Web → Run workflow"
echo ""
echo "Supabase Auth Redirect URLs 追加："
echo "  https://alex-agent-guard.github.io/agentwatch/"
echo ""
echo "详见 docs/DEPLOY_WEB.md"
