import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import DevAppShell from '@/components/dashboard/DevAppShell';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import HmacChainPanel from '@/components/dashboard/HmacChainPanel';
import RiskDistributionChart from '@/components/dashboard/RiskDistributionChart';
import RiskTrendChart from '@/components/dashboard/RiskTrendChart';
import StatMetric from '@/components/dashboard/StatMetric';
import { MOCK_EVENTS, getMockTrendData } from '@/data/mockData';
import type { FinalDecision } from '@/types/events';
import { riskScoreDisplay } from '@/types/events';

const PREVIEW_INSTALL_ID = 'agent_preview_demo';

/** 产品体验 — 仪表盘（概览与趋势；审计明细在报告页） */
export default function DevDashboardPreview() {
  const navigate = useNavigate();
  const events = MOCK_EVENTS;

  const stats = useMemo(() => {
    const total = events.length;
    const blocks = events.filter((e) => e.final_decision === 'BLOCK').length;
    const warns = events.filter((e) => e.final_decision === 'WARN').length;
    const avgScore =
      total > 0 ? events.reduce((s, e) => s + e.l1_combined_score, 0) / total : 0;
    return { total, blocks, warns, avgScore };
  }, [events]);

  const trendData = useMemo(() => getMockTrendData(), []);

  const distributionData = useMemo(() => {
    const counts = { ALLOW: 0, WARN: 0, BLOCK: 0 };
    for (const e of events) counts[e.final_decision] += 1;
    return [
      { name: 'ALLOW', value: counts.ALLOW, color: '#3dd68c' },
      { name: 'WARN', value: counts.WARN, color: '#ffb547' },
      { name: 'BLOCK', value: counts.BLOCK, color: '#ff5c5e' },
    ];
  }, [events]);

  const openReports = (decision?: FinalDecision): void => {
    navigate(decision ? `/preview/reports?decision=${decision}` : '/preview/reports');
  };

  return (
    <DevAppShell>
      <DashboardHeader
        installId={PREVIEW_INSTALL_ID}
        error={null}
        lastUpdated={new Date()}
        refreshing={false}
        liveMode={false}
        onRefresh={() => undefined}
      />

      <section className="dash-bento" aria-label="核心指标">
        <StatMetric
          className="dash-bento__wide"
          label="事件总数"
          value={String(stats.total)}
          numericValue={stats.total}
          tone="neutral"
          enterIndex={1}
          interactive
          onClick={() => openReports()}
        />
        <StatMetric
          label="已拦截"
          value={String(stats.blocks)}
          numericValue={stats.blocks}
          hint={stats.blocks > 0 ? '查看报告' : '无拦截'}
          tone="danger"
          interactive
          enterIndex={2}
          onClick={() => openReports('BLOCK')}
        />
        <StatMetric
          label="警告"
          value={String(stats.warns)}
          numericValue={stats.warns}
          hint={stats.warns > 0 ? '查看报告' : '无警告'}
          tone="warn"
          interactive
          enterIndex={3}
          onClick={() => openReports('WARN')}
        />
        <StatMetric
          className="dash-bento__wide"
          label="平均风险分"
          value={String(riskScoreDisplay(stats.avgScore))}
          numericValue={riskScoreDisplay(stats.avgScore)}
          hint="L1 综合分 0–100"
          tone="neutral"
          enterIndex={4}
        />
      </section>

      <section className="dash-charts dash-layer-recessed" aria-label="趋势分析">
        <RiskTrendChart data={trendData} enterDelay={140} />
        <RiskDistributionChart data={distributionData} enterDelay={180} />
      </section>

      <p className="dash-reports-cta dash-reports-cta--inline dash-enter">
        逐条审计与取证详情在
        <Link to="/preview/reports" className="dash-reports-cta__link">
          报告
        </Link>
      </p>

      <HmacChainPanel events={events} />
    </DevAppShell>
  );
}
