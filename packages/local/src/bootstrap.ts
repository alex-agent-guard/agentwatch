/**
 * AgentWatch V0 — 顶层 ESM 入口
 * 仅负责 DatabaseManager 单例初始化与进程退出钩子；代理业务见 cli/proxy-runtime.ts
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  bootstrap,
  loadRuleEngineRules,
  registerDatabaseShutdownHandlers,
} from './cli/proxy-runtime.js';
import { DatabaseManager } from './storage/DatabaseManager.js';

export { bootstrap, loadRuleEngineRules };

async function main(): Promise<void> {
  registerDatabaseShutdownHandlers(DatabaseManager.getInstance());
  await bootstrap();
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : '';
const modulePath = fileURLToPath(import.meta.url);
if (entryPath === modulePath) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[AgentWatch][bootstrap] fatal: ${message}`);
    process.exit(1);
  });
}
