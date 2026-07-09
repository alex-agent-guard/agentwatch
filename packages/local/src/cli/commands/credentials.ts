import chalk from 'chalk';
import { execSync } from 'node:child_process';
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
    console.info(chalk.yellow('还没有配置。终端运行：'));
    console.info(chalk.cyan('  npm install -g @agentwatch-web3/cli && agentwatch-web3 init'));
    console.info('');
    return;
  }

  const summary = readAgentWatchConfigSummary(configPath);
  const uploadSecret = readUploadSecretFromConfig(configPath);

  console.info('');
  console.info(chalk.bold('Agent ID'));
  console.info(chalk.green(`  ${summary.agentId}`));
  if (uploadSecret) {
    console.info('');
    console.info(chalk.bold('上传密钥'));
    console.info(chalk.green(`  ${uploadSecret}`));
  }
  console.info('');

  const clip = uploadSecret
    ? `${summary.agentId}\n${uploadSecret}`
    : summary.agentId;
  try {
    if (process.platform === 'darwin') {
      execSync('pbcopy', { input: clip });
      console.info(chalk.dim('已复制到剪贴板，粘贴到网页即可'));
    }
  } catch {
    /* ignore */
  }
  console.info('');
}
