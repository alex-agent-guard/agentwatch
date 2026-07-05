import { existsSync, renameSync, statSync, writeFileSync } from 'node:fs';
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

/** log.jsonl 被误建为目录时的修复指引 */
export const LOG_PATH_IS_DIRECTORY_HINT =
  '修复: mv ~/.agentwatch/log.jsonl ~/.agentwatch/log.jsonl.backup-dir && touch ~/.agentwatch/log.jsonl';

/** 校验日志路径必须为文件 — 目录时抛出可读错误（避免 logs/proxy 静默失败） */
export function assertLogFileNotDirectory(logPath: string): void {
  if (!existsSync(logPath)) {
    return;
  }
  if (statSync(logPath).isDirectory()) {
    throw new Error(
      `日志路径是目录而非文件: ${logPath}\n${LOG_PATH_IS_DIRECTORY_HINT}`,
    );
  }
}

/** init 时确保 log.jsonl 为可写文件 — 若已是目录则自动备份并重置 */
export function ensureLogFileReady(logPath: string = getAgentWatchLogPath()): void {
  if (existsSync(logPath) && statSync(logPath).isDirectory()) {
    const backupPath = `${logPath}.backup-dir-${String(Date.now())}`;
    renameSync(logPath, backupPath);
    console.warn(
      `[init] 检测到 ${logPath} 为目录（非文件），已备份至 ${backupPath}`,
    );
  }
  if (!existsSync(logPath)) {
    writeFileSync(logPath, '', { encoding: 'utf8', flag: 'a' });
  }
  assertLogFileNotDirectory(logPath);
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
