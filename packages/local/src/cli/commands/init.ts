import { mkdirSync, writeFileSync } from 'node:fs';

import { buildAgentWatchConfigYaml } from '../lib/config-template.js';
import { generateAgentId, generateUserId } from '../lib/ids.js';
import {
  backupMcpConfigFile,
  injectOkxProxyConfig,
  isValidMcpConfigFile,
  MANUAL_MCP_SETUP_GUIDE,
  readMcpConfigFile,
  writeMcpConfigFile,
} from '../lib/mcp-config.js';
import {
  getAgentWatchConfigPath,
  getAgentWatchHome,
  getMcpConfigCandidates,
} from '../lib/paths.js';

/** 初始化 AgentWatch — 扫描 MCP 配置、备份、注入代理、生成 config.yaml */
export function initCommand(): void {
  try {
    const home = getAgentWatchHome();
    mkdirSync(home, { recursive: true });

    const agentId = generateAgentId();
    const userId = generateUserId();
    const configPath = getAgentWatchConfigPath();

    try {
      writeFileSync(configPath, buildAgentWatchConfigYaml(agentId, userId), 'utf8');
      console.info(`[init] 已生成配置 ${configPath}`);
      console.info(`[init] agentId=${agentId} userId=${userId}`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      console.error(`[init] 写入 config.yaml 失败: ${message}`);
    }

    const candidates = getMcpConfigCandidates();
    const validConfigs = candidates.filter((item) => isValidMcpConfigFile(item.path));

    if (validConfigs.length === 0) {
      console.warn('[init] 未检测到可用的 MCP 配置文件');
      console.info(MANUAL_MCP_SETUP_GUIDE);
      return;
    }

    for (const target of validConfigs) {
      try {
        const existing = readMcpConfigFile(target.path);
        if (existing === null) {
          console.warn(`[init] 跳过无效配置: ${target.path}`);
          continue;
        }

        const backupPath = backupMcpConfigFile(target.path);
        if (backupPath !== null) {
          console.info(`[init] 已备份 ${target.editor}: ${backupPath}`);
        } else {
          console.warn(`[init] 备份失败: ${target.path}`);
        }

        const patched = injectOkxProxyConfig(existing, configPath);
        if (!writeMcpConfigFile(target.path, patched)) {
          console.error(`[init] 写入失败: ${target.path}`);
          continue;
        }

        console.info(`[init] 已向 ${target.editor} (${target.path}) 注入 okx 代理配置`);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        console.error(`[init] 处理 ${target.editor} 失败: ${message}`);
      }
    }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error(`[init] 初始化异常: ${message}`);
  }
}
