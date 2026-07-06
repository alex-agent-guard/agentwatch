import type { AgentWatchEvent } from '@/types/events';
import { MOCK_EVENTS } from '@/data/mockData';
import { shouldUseDemoData } from '@/lib/session';
import { getAuthenticatedClient } from '@/lib/supabase';

export interface FetchEventsOptions {
  installId: string;
  limit?: number;
  decision?: AgentWatchEvent['final_decision'] | 'ALL';
  search?: string;
}

export async function fetchEvents(
  options: FetchEventsOptions,
): Promise<{ data: AgentWatchEvent[]; error: string | null }> {
  const { installId, limit = 50, decision = 'ALL', search = '' } = options;

  if (shouldUseDemoData()) {
    let rows = MOCK_EVENTS.filter((e) => e.install_id === installId || installId === 'demo-install');
    if (decision !== 'ALL') {
      rows = rows.filter((e) => e.final_decision === decision);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (e) =>
          e.event_id.toLowerCase().includes(q) ||
          e.tool_name.toLowerCase().includes(q) ||
          e.hmac.toLowerCase().includes(q),
      );
    }
    return { data: rows.slice(0, limit), error: null };
  }

  let query = getAuthenticatedClient()
    .from('events')
    .select('*')
    .eq('install_id', installId)
    .order('timestamp_ms', { ascending: false })
    .limit(limit);

  if (decision !== 'ALL') {
    query = query.eq('final_decision', decision);
  }

  const { data, error } = await query;

  if (error) {
    return { data: [], error: error.message };
  }

  let rows = (data ?? []) as AgentWatchEvent[];

  if (search.trim()) {
    const q = search.toLowerCase();
    rows = rows.filter(
      (e) =>
        e.event_id.toLowerCase().includes(q) ||
        e.tool_name.toLowerCase().includes(q) ||
        e.hmac.toLowerCase().includes(q),
    );
  }

  return { data: rows, error: null };
}

export interface FetchSessionEventsOptions {
  installId: string;
  sessionId: string;
  limit?: number;
}

/** 同 session 内事件 — 按时间升序，用于工具链还原 */
export async function fetchSessionEvents(
  options: FetchSessionEventsOptions,
): Promise<{ data: AgentWatchEvent[]; error: string | null }> {
  const { installId, sessionId, limit = 30 } = options;

  if (shouldUseDemoData()) {
    const rows = MOCK_EVENTS.filter(
      (e) =>
        e.session_id === sessionId &&
        (e.install_id === installId || installId === 'demo-install'),
    ).sort((a, b) => a.timestamp_ms - b.timestamp_ms);
    return { data: rows.slice(0, limit), error: null };
  }

  const { data, error } = await getAuthenticatedClient()
    .from('events')
    .select('*')
    .eq('install_id', installId)
    .eq('session_id', sessionId)
    .order('timestamp_ms', { ascending: true })
    .limit(limit);

  if (error) {
    return { data: [], error: error.message };
  }

  return { data: (data ?? []) as AgentWatchEvent[], error: null };
}

export async function testConnection(installId: string): Promise<boolean> {
  if (shouldUseDemoData()) return true;

  const { error } = await getAuthenticatedClient()
    .from('events')
    .select('event_id')
    .eq('install_id', installId)
    .limit(1);

  return !error;
}
