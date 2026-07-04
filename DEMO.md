# AgentWatch 90 秒 Demo 分镜脚本

> 零外部依赖 · echo MCP 本地模拟 · A2A 验收 = `audit verify` ✅

## 前置

- Node.js ≥ 18
- 终端 1：运行 proxy
- 终端 2：发送 tool call + 验收
- Demo 占位环境变量（config 校验需要，不调用真实 OKX API）：

```bash
export OKX_API_KEY=demo OKX_SECRET_KEY=demo OKX_PASSPHRASE=demo OKX_PROJECT_ID=demo AGENTWATCH_API_KEY=demo
```

## 分镜

| 时间 | 画面 | 旁白 / 字幕 |
|------|------|-------------|
| 0:00–0:15 | Logo / 标题卡 | 「这是 AgentWatch，你的 AI Agent 的安全安全带」 |
| 0:15–0:30 | 终端安装 | `npm install -g @agentwatch-web3/cli && agentwatch init` |
| 0:30–0:50 | 启动代理 + 拦截日志 | `agentwatch proxy -- node scripts/echo-mcp.js` — 展示 ALLOW / BLOCK 实时日志 |
| 0:50–1:15 | 审计验收 | `agentwatch audit verify` → `✅ Chain verified: N entries intact` |
| 1:15–1:30 | 结尾卡 | 「CertiK 查 token 风险，AgentWatch 保操作安全」 |

## 一键指引

```bash
bash scripts/a2a-demo.sh
```

## 推荐 Demo 调用序列

### 正常通过（ALLOW）

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"swap","arguments":{"amount":"1.5 ETH"}}}' \
  | agentwatch proxy -- node scripts/echo-mcp.js

echo '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"query_balance","arguments":{"token":"ETH"}}}' \
  | agentwatch proxy -- node scripts/echo-mcp.js
```

### 异常拦截（BLOCK — L0 PARAM_TAMPER_001）

```bash
echo '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"transfer","arguments":{"amount":500000,"to":"0x1234"}}}' \
  | agentwatch proxy -- node scripts/echo-mcp.js
```

代理 stderr 应出现 BLOCK 相关日志；客户端收到 JSON-RPC error code `-32000`。

### 验收

```bash
agentwatch audit verify
# ✅ Chain verified: N entries intact
echo $?   # 0
```

## echo-mcp 工具列表

| 工具 | 模拟行为 |
|------|----------|
| `swap` | 代币交换成功响应 |
| `query_balance` | 余额查询 |
| `transfer` | 转账（amount ≥ 100000 触发 L0 BLOCK） |
| `malicious_swap` | 异常大额模拟（响应侧；拦截 Demo 请用 transfer） |

## 录屏提示

- 终端字体 ≥ 14pt，深色背景
- 先跑 2–3 次 ALLOW，再跑 1 次 BLOCK，对比效果明显
- 最后 `audit verify` 全屏展示 ✅ 与 `echo $?` → `0`
- 无需 OKX API 凭证，无需联网
