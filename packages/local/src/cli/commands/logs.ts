import { existsSync, statSync } from 'node:fs';

import {
  formatLogEntry,
  parseSinceArgument,
  readLogEntries,
  readLogIncrement,
} from '../lib/log-reader.js';
import {
  getAgentWatchHome,
  getAgentWatchLogPath,
  LOG_PATH_IS_DIRECTORY_HINT,
} from '../lib/paths.js';

/** logs 子命令选项 — commander 解析结果 */
export interface LogsCommandOptions {
  tail?: string;
  level?: string;
  follow?: boolean;
  since?: string;
}

const FOLLOW_POLL_MS = 1000;

function parseTail(raw: string | undefined): number {
  const parsed = Number(raw ?? '100');
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 100;
  }
  return Math.trunc(parsed);
}

function printEntries(entries: ReturnType<typeof readLogEntries>): void {
  if (entries.length === 0) {
    console.info('（无匹配日志）');
    return;
  }

  for (const entry of entries) {
    console.info(formatLogEntry(entry));
    console.info('---');
  }
}

/** 查看安全日志 — tail / level / since / follow */
export function logsCommand(options: LogsCommandOptions): void {
  const logPath = getAgentWatchLogPath();

  try {
    if (!existsSync(logPath)) {
      console.warn(
        `[logs] 日志文件不存在: ${logPath}\n请先运行检测网关产生 BLOCK/WARN 事件，或检查 logging.output 配置。`,
      );
      return;
    }

    if (statSync(logPath).isDirectory()) {
      console.error(
        `[logs] 日志路径是目录而非文件: ${logPath}\n${LOG_PATH_IS_DIRECTORY_HINT}`,
      );
      return;
    }

    const tail = parseTail(options.tail);
    const sinceMs = parseSinceArgument(options.since);
    const query = {
      tail,
      ...(options.level !== undefined ? { level: options.level } : {}),
      ...(sinceMs !== undefined ? { sinceMs } : {}),
    };

    if (options.follow) {
      let offset = 0;
      try {
        offset = statSync(logPath).size;
      } catch {
        offset = 0;
      }

      console.info(`[logs] 跟踪 ${logPath} (Ctrl+C 退出)`);

      const timer = setInterval(() => {
        try {
          const increment = readLogIncrement(logPath, offset, query);
          offset = increment.nextOffset;
          for (const line of increment.lines) {
            console.info(line);
            console.info('---');
          }
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : String(cause);
          console.error(`[logs] follow 读取失败: ${message}`);
        }
      }, FOLLOW_POLL_MS);

      timer.unref?.();

      const onSigint = (): void => {
        clearInterval(timer);
        process.exit(0);
      };
      process.once('SIGINT', onSigint);

      return;
    }

    const entries = readLogEntries(logPath, query);
    printEntries(entries);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error(`[logs] 读取失败: ${message}`);
  }
}
