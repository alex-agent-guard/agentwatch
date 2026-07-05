/**
 * Supabase PostgREST / Edge Function 上报适配层
 * v1：POST /functions/v1/upload-events + upload_secret（废弃 anon 直连 INSERT）
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { CloudEventPayload, CloudBatchUploadResult } from './CloudClient.js';
import { toSupabaseEventRows, type SupabaseEventRow } from './supabaseEventMapper.js';

export interface SupabaseUploadContext {
  endpoint: string;
  /** Edge Function 网关 anon key（verify_jwt=false 时可选） */
  apiKey: string;
  uploadSecret: string;
  timeoutMs: number;
  fetchImpl: typeof fetch;
}

/** 判断 endpoint 是否为 Supabase 项目 URL */
export function isSupabaseEndpoint(endpoint: string): boolean {
  return endpoint.includes('supabase.co');
}

/**
 * 解析 Supabase 项目 origin — 输入可为 …/rest/v1、…/rest 或项目根 URL
 */
export function resolveSupabaseProjectOrigin(endpoint: string): string {
  const trimmed = endpoint.replace(/\/$/, '');
  if (trimmed.includes('supabase.co')) {
    const match = trimmed.match(/^(https:\/\/[^/]+\.supabase\.co)/);
    if (match?.[1]) {
      return match[1];
    }
  }
  return trimmed.replace(/\/rest\/v1$/, '').replace(/\/rest$/, '');
}

/** @deprecated 读路径改用 session RLS；保留供 legacy 测试引用 */
export function resolveSupabaseRestV1Base(endpoint: string): string {
  return `${resolveSupabaseProjectOrigin(endpoint)}/rest/v1`;
}

/** @deprecated 保留供测试 import；v1 写入走 Edge Function */
export function resolveSupabaseEventsUrl(endpoint: string): string {
  return `${resolveSupabaseRestV1Base(endpoint)}/events`;
}

/** Edge Function 批量上报 URL */
export function resolveSupabaseUploadUrl(endpoint: string): string {
  return `${resolveSupabaseProjectOrigin(endpoint)}/functions/v1/upload-events`;
}

/** 从 ~/.agentwatch/config.yaml 读取 agentId */
export function readConfigAgentId(configPath?: string): string | null {
  try {
    const path = configPath ?? join(homedir(), '.agentwatch', 'config.yaml');
    const yaml = readFileSync(path, 'utf8');
    const match = yaml.match(/^agentId:\s*"(.+?)"/m);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

/** install_id 取 config.agentId；日志 agentId 缺失或为 default 时回退 config */
export function resolveInstallIdFromBatch(events: CloudEventPayload[]): string {
  const fromConfig = readConfigAgentId();
  const fromPayload = events[0]?.agentId;
  if (
    fromConfig !== null &&
    (fromPayload === undefined || fromPayload.length === 0 || fromPayload === 'default')
  ) {
    return fromConfig;
  }
  return fromPayload ?? fromConfig ?? 'default';
}

/** PostgREST INSERT 行 — 省略 DB generated column risk_level */
export function toSupabaseInsertRows(
  events: CloudEventPayload[],
  installId: string,
): Array<Omit<SupabaseEventRow, 'risk_level'>> {
  return toSupabaseEventRows(events, installId).map((row) => {
    const { risk_level: _generated, ...insertRow } = row;
    return {
      ...insertRow,
      install_id: installId,
      agent_id: row.agent_id === 'default' ? installId : row.agent_id,
    };
  });
}

/** 批量上报 — Edge Function + upload_secret */
export async function uploadBatchToSupabase(
  events: CloudEventPayload[],
  ctx: SupabaseUploadContext,
): Promise<CloudBatchUploadResult | null> {
  if (events.length === 0) {
    return { batchId: 'empty', accepted: 0, rejected: 0, errors: [] };
  }

  if (ctx.uploadSecret.trim().length === 0) {
    throw new Error('Supabase upload requires upload_secret');
  }

  const installId = resolveInstallIdFromBatch(events);
  const rows = toSupabaseInsertRows(events, installId);
  const url = resolveSupabaseUploadUrl(ctx.endpoint);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (ctx.apiKey.trim().length > 0) {
    headers['apikey'] = ctx.apiKey;
    headers['Authorization'] = `Bearer ${ctx.apiKey}`;
  }

  const res = await ctx.fetchImpl(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      install_id: installId,
      upload_secret: ctx.uploadSecret,
      events: rows,
    }),
    signal: AbortSignal.timeout(ctx.timeoutMs),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Supabase upload HTTP ${String(res.status)}: ${detail}`);
  }

  let payload: { accepted?: number } | null = null;
  try {
    payload = (await res.json()) as { accepted?: number };
  } catch {
    payload = null;
  }

  const accepted = payload?.accepted ?? events.length;

  return {
    batchId: `supabase-${String(Date.now())}`,
    accepted,
    rejected: Math.max(0, events.length - accepted),
    errors: [],
  };
}
