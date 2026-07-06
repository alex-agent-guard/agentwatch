import { useSearchParams } from 'react-router-dom';
import { useMemo } from 'react';

import DashPageHeader from '@/components/dashboard/DashPageHeader';
import DevAppShell from '@/components/dashboard/DevAppShell';
import ReportAuditTimeline from '@/components/dashboard/ReportAuditTimeline';
import ReportBrief from '@/components/dashboard/ReportBrief';
import { MOCK_EVENTS } from '@/data/mockData';
import type { FinalDecision } from '@/types/events';

/** 产品体验 — 报告（可浏览样例，全部为示例数据） */
export default function DevReportsPreview() {
  const [searchParams] = useSearchParams();
  const events = MOCK_EVENTS;

  const initialDecision = useMemo((): FinalDecision | 'ALL' => {
    const raw = searchParams.get('decision');
    if (raw === 'BLOCK' || raw === 'WARN' || raw === 'ALLOW') return raw;
    return 'ALL';
  }, [searchParams]);

  return (
    <DevAppShell>
      <DashPageHeader title="审计报告" variant="page" eyebrow="Audit Report" />

      <ReportBrief events={events} agentLabel="示例 Agent" />

      <ReportAuditTimeline events={events} initialDecision={initialDecision} />
    </DevAppShell>
  );
}
