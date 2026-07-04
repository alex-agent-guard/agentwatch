import { readFileSync, statSync } from 'node:fs';

/** 行为日志行 — CLI 展示用 */
export interface CliLogEntry {
  ts?: number;
  dec?: string;
  tool?: string;
  eventId?: string;
  score?: number;
  _meta?: { hmac?: string; v?: string; [key: string]: unknown };
  [key: string]: unknown;
}

export type LogLevelFilter = 'debug' | 'info' | 'warn' | 'error';

export interface LogQueryOptions {
  tail?: number;
  level?: string;
  sinceMs?: number;
}

const LEVEL_TO_DECISIONS: Record<LogLevelFilter, Set<string>> = {
  debug: new Set(['ALLOW', 'WARN', 'BLOCK', 'ESCALATE', 'LOG']),
  info: new Set(['ALLOW', 'LOG']),
  warn: new Set(['WARN', 'ESCALATE']),
  error: new Set(['BLOCK']),
};

function parseNumericTimestamp(trimmed: string): number | undefined {
  if (!/^\d+$/.test(trimmed)) {
    return undefined;
  }
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return undefined;
  }
  return Math.trunc(numeric);
}

/** 解析 --since 参数 — 支持 Unix ms / ISO8601 / 1h / 1d 相对时长 */
export function parseSinceArgument(raw: string | undefined, nowMs: number = Date.now()): number | undefined {
  if (raw === undefined || raw.trim().length === 0) {
    return undefined;
  }

  const trimmed = raw.trim();

  const relative = trimmed.match(/^(\d+)([hdm])$/i);
  if (relative !== null) {
    const amount = Number(relative[1]);
    const unit = relative[2]!.toLowerCase();
    const multipliers: Record<string, number> = {
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
    };
    const multiplier = multipliers[unit];
    if (multiplier !== undefined) {
      return nowMs - amount * multiplier;
    }
  }

  const numericTs = parseNumericTimestamp(trimmed);
  if (numericTs !== undefined) {
    return numericTs;
  }

  if (trimmed.includes('-') || trimmed.includes('T')) {
    const parsedDate = Date.parse(trimmed);
    if (!Number.isNaN(parsedDate)) {
      return parsedDate;
    }
  }

  return undefined;
}

function matchesLevel(entry: CliLogEntry, level: string | undefined): boolean {
  if (level === undefined || level.length === 0) {
    return true;
  }
  const normalized = level.toLowerCase() as LogLevelFilter;
  const decisions = LEVEL_TO_DECISIONS[normalized];
  if (decisions === undefined) {
    return true;
  }
  const decision = typeof entry.dec === 'string' ? entry.dec : 'ALLOW';
  return decisions.has(decision);
}

/** 读取 JSONL 日志并过滤 */
export function readLogEntries(filePath: string, options: LogQueryOptions = {}): CliLogEntry[] {
  try {
    const content = readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter((line) => line.trim().length > 0);
    const entries: CliLogEntry[] = [];

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as CliLogEntry;
        if (options.sinceMs !== undefined) {
          const ts = typeof parsed.ts === 'number' ? parsed.ts : 0;
          if (ts < options.sinceMs) {
            continue;
          }
        }
        if (!matchesLevel(parsed, options.level)) {
          continue;
        }
        entries.push(parsed);
      } catch {
        continue;
      }
    }

    if (options.tail !== undefined && options.tail > 0) {
      return entries.slice(-options.tail);
    }

    return entries;
  } catch {
    return [];
  }
}

/** 格式化单条日志 — 保留 _meta.hmac */
export function formatLogEntry(entry: CliLogEntry): string {
  return JSON.stringify(entry, null, 2);
}

/** follow 模式读取增量 — 返回新行与更新后的文件偏移 */
export function readLogIncrement(
  filePath: string,
  offset: number,
  options: LogQueryOptions = {},
): { lines: string[]; nextOffset: number } {
  try {
    const stats = statSync(filePath);
    if (stats.size <= offset) {
      return { lines: [], nextOffset: offset };
    }

    const buffer = readFileSync(filePath);
    const chunk = buffer.subarray(offset).toString('utf8');
    const nextOffset = stats.size;
    const lines = chunk.split('\n').filter((line) => line.trim().length > 0);

    const formatted: string[] = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as CliLogEntry;
        if (options.sinceMs !== undefined) {
          const ts = typeof parsed.ts === 'number' ? parsed.ts : 0;
          if (ts < options.sinceMs) {
            continue;
          }
        }
        if (!matchesLevel(parsed, options.level)) {
          continue;
        }
        formatted.push(formatLogEntry(parsed));
      } catch {
        continue;
      }
    }

    return { lines: formatted, nextOffset };
  } catch {
    return { lines: [], nextOffset: offset };
  }
}

/** 统计近 N 毫秒内 BLOCK/WARN 事件数 */
export function countRecentRiskEvents(
  filePath: string,
  windowMs: number,
  nowMs: number = Date.now(),
): { block: number; warn: number } {
  const sinceMs = nowMs - windowMs;
  const entries = readLogEntries(filePath, { sinceMs });
  let block = 0;
  let warn = 0;

  for (const entry of entries) {
    if (entry.dec === 'BLOCK') {
      block += 1;
    } else if (entry.dec === 'WARN' || entry.dec === 'ESCALATE') {
      warn += 1;
    }
  }

  return { block, warn };
}
