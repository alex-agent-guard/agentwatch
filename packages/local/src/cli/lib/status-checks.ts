import { existsSync } from 'node:fs';

import { ColdStartController } from '../../baseline/ColdStartController.js';
import { normalizeCloudEndpoint } from '../../cloud/CloudClient.js';
import { DatabaseManager } from '../../storage/DatabaseManager.js';

import {
  hasAgentWatchProxy,
  readMcpConfigFile,
} from './mcp-config.js';
import {
  getAgentWatchConfigPath,
  getAgentWatchDbPath,
  getMcpConfigCandidates,
} from './paths.js';

const REQUIRED_TABLES = [
  'baselines',
  'upload_queue',
  'hmac_chain',
  'perm_probe_tracker',
] as const;

export type StatusLevel = 'ok' | 'warn' | 'error';

export interface StatusCheckResult {
  label: string;
  level: StatusLevel;
  detail: string;
}

/** 检查 MCP 配置文件是否注入 AgentWatch 代理 */
export function checkMcpProxyInjection(): StatusCheckResult {
  try {
    const candidates = getMcpConfigCandidates().filter((item) => existsSync(item.path));
    if (candidates.length === 0) {
      return {
        label: 'MCP 代理注入',
        level: 'error',
        detail: '未找到任何 MCP 配置文件',
      };
    }

    const injected = candidates.filter((item) => {
      const doc = readMcpConfigFile(item.path);
      return doc !== null && hasAgentWatchProxy(doc);
    });

    if (injected.length === 0) {
      return {
        label: 'MCP 代理注入',
        level: 'warn',
        detail: `检测到 ${String(candidates.length)} 个配置文件，均未注入 @agentwatch/cli`,
      };
    }

    return {
      label: 'MCP 代理注入',
      level: 'ok',
      detail: `已在 ${injected.map((item) => item.editor).join(', ')} 注入代理`,
    };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return {
      label: 'MCP 代理注入',
      level: 'error',
      detail: message,
    };
  }
}

/** 检查 SQLite 数据库与表结构 */
export function checkSqliteDatabase(): StatusCheckResult {
  try {
    if (!existsSync(getAgentWatchDbPath())) {
      return {
        label: 'SQLite 数据库',
        level: 'warn',
        detail: 'agentwatch.db 尚未创建',
      };
    }

    const db = DatabaseManager.getInstance().getDb();
    const missing: string[] = [];

    for (const table of REQUIRED_TABLES) {
      const row = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
        .get(table) as { name: string } | undefined;
      if (row === undefined) {
        missing.push(table);
      }
    }

    if (missing.length > 0) {
      return {
        label: 'SQLite 数据库',
        level: 'error',
        detail: `缺少表: ${missing.join(', ')}`,
      };
    }

    return {
      label: 'SQLite 数据库',
      level: 'ok',
      detail: 'agentwatch.db 可正常打开，表结构完整',
    };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return {
      label: 'SQLite 数据库',
      level: 'error',
      detail: message,
    };
  }
}

/** 查询 baselines 冷启动等级与总调用次数 */
export function checkBaselineColdStart(
  userId: string,
  agentId: string,
): StatusCheckResult {
  try {
    const db = DatabaseManager.getInstance().getDb();
    const row = db
      .prepare('SELECT data FROM baselines WHERE user_id = ? AND agent_id = ?')
      .get(userId, agentId) as { data: string } | undefined;

    if (row === undefined) {
      return {
        label: '行为基线',
        level: 'warn',
        detail: 'baselines 表无记录 — 冷启动 L1 (0 次调用)',
      };
    }

    const parsed = JSON.parse(row.data) as Record<string, unknown>;
    const totalCalls =
      typeof parsed['totalCalls'] === 'number'
        ? parsed['totalCalls']
        : typeof parsed['totalUpdates'] === 'number'
          ? parsed['totalUpdates']
          : 0;

    const tier = new ColdStartController().resolveTier(totalCalls);
    return {
      label: '行为基线',
      level: 'ok',
      detail: `冷启动 ${tier}，累计 ${String(totalCalls)} 次调用`,
    };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return {
      label: '行为基线',
      level: 'error',
      detail: message,
    };
  }
}

/** 云端 /v1/events/batch ping — 可选注入 fetch 供测试 */
export async function checkCloudConnectivity(
  endpoint: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<StatusCheckResult> {
  try {
    const base = normalizeCloudEndpoint(endpoint);
    const response = await fetchImpl(`${base}/v1/events/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ batchId: 'ping', events: [], sentAt: Date.now() }),
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok || response.status === 401 || response.status === 400) {
      return {
        label: '云端连通性',
        level: 'ok',
        detail: `HTTP ${String(response.status)} — 端点可达`,
      };
    }

    return {
      label: '云端连通性',
      level: 'warn',
      detail: `HTTP ${String(response.status)} — 服务异常`,
    };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return {
      label: '云端连通性',
      level: 'error',
      detail: message,
    };
  }
}

/** 读取 config.yaml 是否存在 */
export function hasAgentWatchConfig(): boolean {
  return existsSync(getAgentWatchConfigPath());
}
