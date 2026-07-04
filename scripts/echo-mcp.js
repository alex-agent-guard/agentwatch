#!/usr/bin/env node
/**
 * echo-mcp — 零依赖 stdio MCP 模拟服务（Demo / 录屏用）
 * 协议：newline-delimited JSON-RPC 2.0（与 AgentWatch MCPProxyCore 一致）
 *
 * 启动：node scripts/echo-mcp.js
 * 代理：agentwatch proxy -- node scripts/echo-mcp.js
 */
import readline from 'node:readline';

const SERVER_INFO = {
  name: 'echo-mcp',
  version: '0.1.0',
};

const TOOLS = [
  {
    name: 'swap',
    description: 'Simulate token swap on OKX DEX',
    inputSchema: {
      type: 'object',
      properties: {
        fromToken: { type: 'string', description: 'Source token symbol' },
        toToken: { type: 'string', description: 'Destination token symbol' },
        amount: { type: 'string', description: 'Amount to swap' },
      },
    },
  },
  {
    name: 'query_balance',
    description: 'Simulate wallet balance query',
    inputSchema: {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'Wallet address (masked in logs)' },
        token: { type: 'string', description: 'Token symbol' },
      },
    },
  },
  {
    name: 'transfer',
    description: 'Simulate on-chain transfer',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient address' },
        amount: { type: 'number', description: 'Transfer amount' },
        token: { type: 'string', description: 'Token symbol' },
      },
      required: ['to', 'amount'],
    },
  },
  {
    name: 'malicious_swap',
    description: 'Demo only — abnormal high-value swap pattern',
    inputSchema: {
      type: 'object',
      properties: {
        amount: { type: 'number', description: 'Swap amount (use >= 100000 for block demo via transfer)' },
        token: { type: 'string' },
      },
    },
  },
];

/** @param {unknown} message */
function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

/** @param {Record<string, unknown>} payload */
function toolResult(payload) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    isError: false,
  };
}

/**
 * @param {string} name
 * @param {Record<string, unknown> | undefined} args
 */
function executeTool(name, args) {
  const params = args ?? {};

  switch (name) {
    case 'swap':
      return toolResult({
        status: 'success',
        tx_hash: '0xabc123def4567890abcdef1234567890abcdef12',
        amount: typeof params.amount === 'string' ? params.amount : '1.5 ETH',
        fromToken: params.fromToken ?? 'ETH',
        toToken: params.toToken ?? 'USDT',
      });
    case 'query_balance':
      return toolResult({
        status: 'success',
        balance: '10.5 ETH',
        token: params.token ?? 'ETH',
      });
    case 'transfer':
      return toolResult({
        status: 'success',
        tx_hash: '0xdef456abc78901234567890123456789012345678',
        amount: params.amount ?? 0,
        to: params.to ?? '0x0000000000000000000000000000000000000001',
      });
    case 'malicious_swap':
      return toolResult({
        status: 'success',
        warning: 'simulated abnormal swap',
        amount: params.amount ?? 9_999_999,
        token: params.token ?? 'ETH',
        note: 'Use transfer with amount>=100000 to trigger L0 BLOCK in AgentWatch demo',
      });
    default:
      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      };
  }
}

/**
 * @param {Record<string, unknown>} request
 */
function handleMessage(request) {
  const method = typeof request.method === 'string' ? request.method : '';
  const id = request.id;
  const hasId = id !== undefined && id !== null;

  if (!hasId) {
    return;
  }

  switch (method) {
    case 'initialize':
      send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        },
      });
      return;

    case 'ping':
      send({ jsonrpc: '2.0', id, result: {} });
      return;

    case 'tools/list':
      send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
      return;

    case 'tools/call': {
      const params =
        typeof request.params === 'object' && request.params !== null
          ? /** @type {Record<string, unknown>} */ (request.params)
          : {};
      const toolName = typeof params.name === 'string' ? params.name : '';
      const args =
        typeof params.arguments === 'object' && params.arguments !== null
          ? /** @type {Record<string, unknown>} */ (params.arguments)
          : undefined;
      send({ jsonrpc: '2.0', id, result: executeTool(toolName, args) });
      return;
    }

    default:
      send({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      });
  }
}

process.stderr.write(`[echo-mcp] ready pid=${process.pid} tools=${TOOLS.map((t) => t.name).join(',')}\n`);

const rl = readline.createInterface({
  input: process.stdin,
  terminal: false,
});

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return;
  }

  try {
    const message = JSON.parse(trimmed);
    if (typeof message === 'object' && message !== null) {
      handleMessage(/** @type {Record<string, unknown>} */ (message));
    }
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    process.stderr.write(`[echo-mcp] invalid JSON: ${detail}\n`);
  }
});

rl.on('close', () => {
  process.exit(0);
});

process.stdin.on('error', () => process.exit(0));
process.stdout.on('error', () => process.exit(0));
