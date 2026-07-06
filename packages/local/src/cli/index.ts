#!/usr/bin/env node
import { Command } from 'commander';
import { proxyCommand } from './commands/proxy.js';
import { initCommand } from './commands/init.js';
import { credentialsCommand } from './commands/credentials.js';
import { statusCommand } from './commands/status.js';
import { logsCommand } from './commands/logs.js';
import { auditVerifyCommand } from './commands/audit.js';

const program = new Command();
program.name('agentwatch').description('AgentWatch MCP 安全代理');

program
  .command('proxy')
  .description('启动 MCP 代理')
  .option('-c, --config <path>', '配置文件路径')
  .argument('[args...]', '下游 MCP 服务器命令及参数')
  .allowUnknownOption()
  .action(async (args: string[], options: { config?: string }) => {
    await proxyCommand(args, options);
  });

program
  .command('init')
  .description('初始化 AgentWatch 配置')
  .action(initCommand);

program
  .command('credentials')
  .description('显示 Agent ID 与上传密钥（供 Dashboard 复制绑定）')
  .action(credentialsCommand);

program
  .command('status')
  .description('检查运行状态')
  .action(async () => {
    await statusCommand();
  });

program
  .command('logs')
  .description('查看安全日志')
  .option('-n, --tail <number>', '显示最后 N 条', '100')
  .option('-l, --level <level>', '过滤级别')
  .option('-f, --follow', '实时跟踪')
  .option('--since <duration>', '时间范围，如 1h, 1d')
  .action(logsCommand);

const auditCommand = program.command('audit').description('审计链完整性校验');

auditCommand
  .command('verify')
  .description('验证 HMAC 审计链完整性')
  .option('-f, --file <path>', '日志文件路径（默认 ~/.agentwatch/log.jsonl）')
  .option('--json', '输出 JSON 供 Agent 解析')
  .action((options: { file?: string; json?: boolean }) => {
    auditVerifyCommand(options);
  });

// 向后兼容：agentwatch -- <mcp-server>
program
  .command('legacy-proxy', { hidden: true })
  .allowUnknownOption()
  .action(async () => {
    const argv = process.argv.slice(2);
    const dashIdx = argv.indexOf('--');
    const downstream = dashIdx >= 0 ? argv.slice(dashIdx + 1) : argv;
    await proxyCommand(downstream, {});
  });

/** init 注入：npx @agentwatch-web3/cli --config path -- downstream（无 proxy 子命令） */
function tryImplicitProxyLaunch(): boolean {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    return false;
  }

  const knownCommands = new Set([
    'proxy',
    'init',
    'credentials',
    'status',
    'logs',
    'audit',
    'help',
    '--help',
    '-h',
    '-V',
    '--version',
  ]);
  if (knownCommands.has(argv[0]!)) {
    return false;
  }

  let config: string | undefined;
  const tokens: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if ((token === '--config' || token === '-c') && argv[index + 1] !== undefined) {
      config = argv[index + 1];
      index += 1;
      continue;
    }
    tokens.push(token);
  }

  const dashIdx = tokens.indexOf('--');
  const downstream = dashIdx >= 0 ? tokens.slice(dashIdx + 1) : tokens;

  void proxyCommand(downstream, config !== undefined ? { config } : {}).catch(async (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[AgentWatch][proxy] fatal: ${message}`);
    process.exit(1);
  });

  return true;
}

if (!tryImplicitProxyLaunch()) {
  program.parse();
}
