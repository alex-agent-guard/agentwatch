import chalk from 'chalk';
import { existsSync, statSync } from 'node:fs';

import { readAgentWatchConfigSummary } from '../lib/config-reader.js';
import { countRecentRiskEvents } from '../lib/log-reader.js';
import { getAgentWatchConfigPath, getAgentWatchLogPath } from '../lib/paths.js';
import {
  checkBaselineColdStart,
  checkCloudConnectivity,
  checkMcpProxyInjection,
  checkSqliteDatabase,
  type StatusCheckResult,
  type StatusLevel,
} from '../lib/status-checks.js';

function formatStatusLine(result: StatusCheckResult): string {
  const icon =
    result.level === 'ok'
      ? chalk.green('✅')
      : result.level === 'warn'
        ? chalk.yellow('⚠')
        : chalk.red('❌');
  return `${icon} ${result.label}: ${result.detail}`;
}

/** 全链路状态诊断 */
export async function statusCommand(): Promise<void> {
  try {
    console.info(chalk.bold('AgentWatch 状态诊断'));
    console.info('');

    const checks: StatusCheckResult[] = [];
    checks.push(checkMcpProxyInjection());
    checks.push(checkSqliteDatabase());

    const configPath = getAgentWatchConfigPath();
    const summary = existsSync(configPath)
      ? readAgentWatchConfigSummary(configPath)
      : {
          agentId: 'default',
          userId: 'default',
          cloudEnabled: false,
          cloudEndpoint: '',
          cloudApiKey: '',
        };

    checks.push(checkBaselineColdStart(summary.userId, summary.agentId));

    if (summary.cloudEnabled) {
      checks.push(
        await checkCloudConnectivity(summary.cloudEndpoint, summary.cloudApiKey),
      );
    } else {
      checks.push({
        label: '云端连通性',
        level: 'ok',
        detail: 'cloud.enabled=false — 已跳过云端 ping',
      });
    }

    for (const result of checks) {
      console.info(formatStatusLine(result));
    }

    const logPath = getAgentWatchLogPath();
    if (existsSync(logPath)) {
      const { block, warn } = countRecentRiskEvents(logPath, 3_600_000);
      console.info('');
      if (block > 0) {
        console.info(
          chalk.red(`❌ 近 1 小时 BLOCK 事件: ${String(block)} 条 — 请立即审查`),
        );
      } else {
        console.info(chalk.green('✅ 近 1 小时无 BLOCK 事件'));
      }
      if (warn > 0) {
        console.info(
          chalk.yellow(`⚠ 近 1 小时 WARN 事件: ${String(warn)} 条`),
        );
      } else {
        console.info(chalk.green('✅ 近 1 小时无 WARN 事件'));
      }
    } else {
      console.info('');
      console.info(chalk.yellow(`⚠ 日志文件不存在: ${logPath}`));
    }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error(chalk.red(`[status] 诊断失败: ${message}`));
  }
}

export type { StatusCheckResult, StatusLevel };
