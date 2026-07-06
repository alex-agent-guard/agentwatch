import { displayClient, isReportedClientName } from '@/lib/clientDisplay';
import { displayService, isReportedServiceName } from '@/lib/serviceDisplay';
import type { AgentWatchEvent, FinalDecision } from '@/types/events';

export interface ActivityRow {
  eventId: string;
  toolName: string;
  clientName: string;
  clientLabel: string;
  clientShort: string;
  clientColor: string;
  clientReported: boolean;
  serviceName: string;
  serviceLabel: string;
  serviceUrl?: string;
  serviceReported: boolean;
  serviceColor: string;
  decision: FinalDecision;
  timestampMs: number;
}

export interface ClientServiceLink {
  clientName: string;
  clientLabel: string;
  clientShort: string;
  clientColor: string;
  clientReported: boolean;
  serviceName: string;
  serviceLabel: string;
  serviceUrl?: string;
  serviceColor: string;
  serviceReported: boolean;
  count: number;
}

const PENDING_CLIENT = '__pending_client__';

export function getRecentActivity(events: AgentWatchEvent[], limit = 6): ActivityRow[] {
  return events
    .slice()
    .sort((a, b) => b.timestamp_ms - a.timestamp_ms)
    .slice(0, limit)
    .map((e) => {
      const client = displayClient(e.client_name);
      const svc = displayService(e.service_name);
      return {
        eventId: e.event_id,
        toolName: e.tool_name,
        clientName: e.client_name ?? '',
        clientLabel: client.label,
        clientShort: client.short,
        clientColor: client.color,
        clientReported: client.hasBackendSource,
        serviceName: e.service_name,
        serviceLabel: svc.label,
        serviceUrl: svc.url,
        serviceReported: svc.hasBackendSource,
        serviceColor: svc.color,
        decision: e.final_decision,
        timestampMs: e.timestamp_ms,
      };
    });
}

export function getClientServiceLinks(events: AgentWatchEvent[]): ClientServiceLink[] {
  if (events.length === 0) return [];

  const counts = new Map<string, number>();
  for (const e of events) {
    const clientKey = (e.client_name ?? '').trim() || PENDING_CLIENT;
    const serviceKey = e.service_name.trim() || 'tools/call';
    const key = `${clientKey}\0${serviceKey}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => {
      const [clientRaw, serviceName] = key.split('\0');
      const client = displayClient(clientRaw === PENDING_CLIENT ? '' : clientRaw);
      const service = displayService(serviceName);
      return {
        clientName: clientRaw === PENDING_CLIENT ? '' : clientRaw,
        clientLabel: client.label,
        clientShort: client.short,
        clientColor: client.color,
        clientReported: client.hasBackendSource,
        serviceName,
        serviceLabel: service.label,
        serviceUrl: service.url,
        serviceColor: service.color,
        serviceReported: isReportedServiceName(serviceName),
        count,
      };
    });
}

export function formatRelativeTime(timestampMs: number, now = Date.now()): string {
  const diff = Math.max(0, now - timestampMs);
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${String(Math.floor(diff / 60_000))} 分钟前`;
  if (diff < 86_400_000) return `${String(Math.floor(diff / 3_600_000))} 小时前`;
  return new Date(timestampMs).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

export function allServicesPending(events: AgentWatchEvent[]): boolean {
  return events.length > 0 && events.every((e) => !isReportedServiceName(e.service_name));
}

export function allClientsPending(events: AgentWatchEvent[]): boolean {
  return events.length > 0 && events.every((e) => !isReportedClientName(e.client_name));
}

export function hasIdentityGap(events: AgentWatchEvent[]): boolean {
  return allServicesPending(events) || allClientsPending(events);
}
