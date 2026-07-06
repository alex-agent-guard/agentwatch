import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AppShell from '@/components/dashboard/AppShell';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import HmacChainPanel from '@/components/dashboard/HmacChainPanel';
import StatMetric from '@/components/dashboard/StatMetric';
import RiskDistributionChart from '@/components/dashboard/RiskDistributionChart';
import RiskTrendChart from '@/components/dashboard/RiskTrendChart';
import { useActiveInstall } from '@/hooks/useActiveInstall';
import { getMockTrendData } from '@/data/mockData';
import { fetchEvents } from '@/lib/events';
import { isLiveDataMode, shouldUseDemoData } from '@/lib/session';
import type { FinalDecision } from '@/types/events';
import { riskScoreDisplay } from '@/types/events';

export default function Dashboard() {
  const navigate = useNavigate();
  const { activeInstallId: installId } = useActiveInstall();
  const [events, setEvents] = useState<Awaited<ReturnType<typeof fetchEvents>>['data']>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = useCallback(
    (mode: 'initial' | 'refresh' | 'poll' = 'initial') => {
      if (mode === 'refresh' || mode === 'poll') setRefreshing(true);

      void fetchEvents({ installId, limit: 50 }).then((res) => {
        setEvents(res.data);
        setError(res.error);
        setLastUpdated(new Date());
        setRefreshing(false);
      });
    },
    [installId],
  );

  useEffect(() => {
    load('initial');
    const timer = isLiveDataMode() ? window.setInterval(() => load('poll'), 10_000) : null;
    return () => {
      if (timer !== null) window.clearInterval(timer);
    };
  }, [load]);

  const stats = useMemo(() => {
    const total = events.length;
    const blocks = events.filter((e) => e.final_decision === 'BLOCK').length;
    const warns = events.filter((e) => e.final_decision === 'WARN').length;
    const avgScore =
      total > 0 ? events.reduce((s, e) => s + e.l1_combined_score, 0) / total : 0;
    return { total, blocks, warns, avgScore };
  }, [events]);

  const trendData = useMemo(() => {
    if (events.length === 0) return shouldUseDemoData() ? getMockTrendData() : [];
    return events
      .slice()
      .sort((a, b) => a.timestamp_ms - b.timestamp_ms)
      .map((e) => ({
        time: new Date(e.timestamp_ms).toLocaleTimeString('zh-CN', {
          hour: '2-digit',
          minute: '2-digit',
        }),
        score: riskScoreDisplay(e.l1_combined_score),
        blocks: e.final_decision === 'BLOCK' ? 1 : 0,
      }))
      .slice(-12);
  }, [events]);

  const distributionData = useMemo(() => {
    const counts = { ALLOW: 0, WARN: 0, BLOCK: 0 };
    for (const e of events) counts[e.final_decision] += 1;
    if (events.length === 0 && shouldUseDemoData()) {
      counts.ALLOW = 3;
      counts.WARN = 1;
      counts.BLOCK = 2;
    }
    return [
      { name: 'ALLOW', value: counts.ALLOW, color: '#3dd68c' },
      { name: 'WARN', value: counts.WARN, color: '#ffb547' },
      { name: 'BLOCK', value: counts.BLOCK, color: '#ff5c5e' },
    ];
  }, [events]);

  const openReports = (decision?: FinalDecision): void => {
    navigate(decision ? `/reports?decision=${decision}` : '/reports');
  };

  return (
    <AppShell>
      <DashboardHeader
          installId={installId}
          error={error}
          lastUpdated={lastUpdated}
          refreshing={refreshing}
          liveMode={isLiveDataMode()}
          onRefresh={() => load('refresh')}
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

        <div className="dash-reports-cta dash-enter" style={{ '--dash-delay': '200ms' } as CSSProperties}>
          <p className="dash-reports-cta__text">
            逐条审计、引擎命中与取证字段在
            <Link to="/reports" className="dash-reports-cta__link">
              报告
            </Link>
            中查看
          </p>
        </div>

      <HmacChainPanel events={events} />
    </AppShell>
  );
}
