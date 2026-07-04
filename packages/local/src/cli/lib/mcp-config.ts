import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

export interface McpServerEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface McpConfigDocument {
  mcpServers?: Record<string, McpServerEntry>;
  [key: string]: unknown;
}

const PROXY_PACKAGE = '@agentwatch/cli';
const DEFAULT_DOWNSTREAM = ['npx', '-y', '@okx_ai/okx-trade-mcp'];

/** 解析 MCP JSON 配置文件 */
export function parseMcpConfigFile(content: string): McpConfigDocument | null {
  try {
    const parsed: unknown = JSON.parse(content);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as McpConfigDocument;
  } catch {
    return null;
  }
}

/** 配置文件存在且 JSON 可解析 */
export function isValidMcpConfigFile(filePath: string): boolean {
  try {
    if (!existsSync(filePath)) {
      return false;
    }
    const content = readFileSync(filePath, 'utf8');
    return parseMcpConfigFile(content) !== null;
  } catch {
    return false;
  }
}

/** 备份 MCP 配置 — 命名：原文件名.backup.时间戳 */
export function backupMcpConfigFile(
  filePath: string,
  timestamp: number = Date.now(),
): string | null {
  try {
    const backupPath = join(
      filePath.replace(/[/\\][^/\\]+$/, ''),
      `${basename(filePath)}.backup.${String(timestamp)}`,
    );
    copyFileSync(filePath, backupPath);
    return backupPath;
  } catch {
    return null;
  }
}

/** 检测 okx 节点是否已注入 AgentWatch 代理 */
export function hasAgentWatchProxy(config: McpConfigDocument): boolean {
  const okx = config.mcpServers?.['okx'];
  if (okx === undefined) {
    return false;
  }
  return okx.args.some((arg) => arg.includes(PROXY_PACKAGE));
}

/** 提取 okx 下游原始 MCP 命令 — 已在代理后则取 -- 之后部分 */
export function extractDownstreamCommand(entry: McpServerEntry): string[] {
  const separatorIndex = entry.args.indexOf('--');
  if (separatorIndex >= 0 && hasAgentWatchProxy({ mcpServers: { okx: entry } })) {
    const downstream = entry.args.slice(separatorIndex + 1);
    if (downstream.length > 0) {
      return downstream;
    }
  }
  return [entry.command, ...entry.args];
}

/** 构建 §3.8 okx MCP 代理转发配置 */
export function buildOkxProxyEntry(
  configPath: string,
  downstreamCommand: string[] = DEFAULT_DOWNSTREAM,
): McpServerEntry {
  return {
    command: 'npx',
    args: [
      '-y',
      PROXY_PACKAGE,
      '--config',
      configPath,
      '--',
      ...downstreamCommand,
    ],
    env: {
      AGENTWATCH_API_KEY: '${AGENTWATCH_API_KEY}',
    },
  };
}

/** 向 mcpServers 注入/更新 okx 代理节点 */
export function injectOkxProxyConfig(
  config: McpConfigDocument,
  configPath: string,
): McpConfigDocument {
  const existingOkx = config.mcpServers?.['okx'];
  const downstream =
    existingOkx !== undefined && !hasAgentWatchProxy(config)
      ? extractDownstreamCommand(existingOkx)
      : DEFAULT_DOWNSTREAM;

  const mcpServers = {
    ...(config.mcpServers ?? {}),
    okx: buildOkxProxyEntry(configPath, downstream),
  };

  return {
    ...config,
    mcpServers,
  };
}

/** 写入 MCP 配置文件 */
export function writeMcpConfigFile(filePath: string, config: McpConfigDocument): boolean {
  try {
    writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

/** 读取 MCP 配置文件 */
export function readMcpConfigFile(filePath: string): McpConfigDocument | null {
  try {
    if (!existsSync(filePath)) {
      return null;
    }
    return parseMcpConfigFile(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export const MANUAL_MCP_SETUP_GUIDE = `
未检测到可用的 MCP 配置文件。请手动完成 AgentWatch 集成：

1. Cursor (~/.cursor/mcp.json)
2. OnchainOS (~/.onchainos/mcp.json)
3. Claude Desktop (~/Library/Application Support/Claude/mcp.json)

参考配置（产品架构 §3.8）：
{
  "mcpServers": {
    "okx": {
      "command": "npx",
      "args": [
        "-y",
        "@agentwatch/cli",
        "--config",
        "~/.agentwatch/config.yaml",
        "--",
        "npx",
        "-y",
        "@okx_ai/okx-trade-mcp"
      ],
      "env": {
        "AGENTWATCH_API_KEY": "\${AGENTWATCH_API_KEY}"
      }
    }
  }
}

完成后运行: agentwatch status
`.trim();
