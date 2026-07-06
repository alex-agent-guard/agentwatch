import chalk from 'chalk';
import { existsSync, readFileSync } from 'node:fs';

import { readAgentWatchConfigSummary } from '../lib/config-reader.js';
import { getAgentWatchConfigPath } from '../lib/paths.js';

function readUploadSecretFromConfig(configPath: string): string | null {
  try {
    const content = readFileSync(configPath, 'utf8');
    for (const rawLine of content.split('\n')) {
      const trimmed = rawLine.trim();
      if (trimmed.startsWith('uploadSecret:')) {
        const match = trimmed.match(/:\s*"?([^"\n#]+)"?\s*$/);
        return match?.[1]?.trim() ?? null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** 打印 Agent ID + 上传密钥 — 供 Dashboard 绑定页复制 */
export function credentialsCommand(): void {
  const configPath = getAgentWatchConfigPath();

  if (!existsSync(configPath)) {
    console.info('');
    console.info(chalk.yellow('还没有 AgentWatch 配置。请先运行：'));
    console.info('');
    console.info(chalk.cyan('  npm install -g @agentwatch-web3/cli'));
    console.info(chalk.cyan('  agentwatch-web3 init'));
    console.info('');
    console.info(`配置将保存在：${configPath}`);
    console.info('');
    return;
  }

  const summary = readAgentWatchConfigSummary(configPath);
  const uploadSecret = readUploadSecretFromConfig(configPath);

  console.info('');
  console.info(chalk.bold('复制下面内容到 Dashboard「添加你的 Agent」页面'));
  console.info('');
  console.info(chalk.dim('─'.repeat(44)));
  console.info('');
  console.info(`${chalk.bold('Agent ID')}${chalk.dim('（粘贴到第一个框）')}`);
  console.info(chalk.green(`  ${summary.agentId}`));
  console.info('');
  if (uploadSecret) {
    console.info(`${chalk.bold('上传密钥')}${chalk.dim('（粘贴到第二个框）')}`);
    console.info(chalk.green(`  ${uploadSecret}`));
    console.info('');
  } else {
    console.info(chalk.yellow('  未找到 uploadSecret — 请重新运行 agentwatch-web3 init'));
    console.info('');
  }
  console.info(chalk.dim('─'.repeat(44)));
  console.info('');
  console.info(chalk.dim(`配置文件：${configPath}`));
  console.info('');
}
