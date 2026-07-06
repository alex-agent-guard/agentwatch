import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import AppShell from '@/components/dashboard/AppShell';
import DashPageHeader from '@/components/dashboard/DashPageHeader';
import ReportAuditTimeline from '@/components/dashboard/ReportAuditTimeline';
import ReportBrief from '@/components/dashboard/ReportBrief';
import { useActiveInstall } from '@/hooks/useActiveInstall';
import { fetchEvents } from '@/lib/events';
import type { AgentWatchEvent } from '@/types/events';

export default function Reports() {
  const [searchParams] = useSearchParams();
  const { activeInstallId: installId, agents } = useActiveInstall();
  const [events, setEvents] = useState<AgentWatchEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const agentLabel = agents.find((agent) => agent.install_id === installId)?.label;

  const initialDecision = useMemo(() => {
    const raw = searchParams.get('decision');
    if (raw === 'BLOCK' || raw === 'WARN' || raw === 'ALLOW') return raw;
    return 'ALL' as const;
  }, [searchParams]);

  const load = useCallback(() => {
    setLoading(true);
    void fetchEvents({ installId, limit: 100 }).then((res) => {
      setEvents(res.data);
      setLoading(false);
    });
  }, [installId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <AppShell>
      <DashPageHeader title="审计报告" variant="page" eyebrow="Audit Report" />

      <ReportBrief events={events} loading={loading} agentLabel={agentLabel} />

      <ReportAuditTimeline
        events={events}
        loading={loading}
        initialDecision={initialDecision}
      />
    </AppShell>
  );
}
