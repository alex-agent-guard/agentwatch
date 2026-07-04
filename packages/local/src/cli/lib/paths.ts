import { homedir } from 'node:os';
import { join } from 'node:path';

/** AgentWatch 工作目录 ~/.agentwatch */
export function getAgentWatchHome(): string {
  return join(homedir(), '.agentwatch');
}

export function getAgentWatchConfigPath(): string {
  return join(getAgentWatchHome(), 'config.yaml');
}

export function getAgentWatchDbPath(): string {
  return join(getAgentWatchHome(), 'agentwatch.db');
}

/** CLI logs 命令固定读取路径 */
export function getAgentWatchLogPath(): string {
  return join(getAgentWatchHome(), 'log.jsonl');
}

export interface McpEditorTarget {
  editor: string;
  path: string;
}

/** MCP 配置扫描路径 — OnchainOS 优先 */
export function getMcpConfigCandidates(): McpEditorTarget[] {
  const home = homedir();
  return [
    { editor: 'OnchainOS', path: join(home, '.onchainos', 'mcp.json') },
    {
      editor: 'Claude Desktop',
      path: join(home, 'Library', 'Application Support', 'Claude', 'mcp.json'),
    },
    { editor: 'Cursor', path: join(home, '.cursor', 'mcp.json') },
  ];
}
