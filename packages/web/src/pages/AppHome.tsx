import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DashboardBackdrop from '@/components/dashboard/DashboardBackdrop';
import MobileTabBar from '@/components/dashboard/MobileTabBar';
import ProtectionLanding from '@/components/dashboard/ProtectionLanding';
import Sidebar from '@/components/dashboard/Sidebar';
import { useActiveInstall } from '@/hooks/useActiveInstall';
import {
  PROTECTION_GRADUATE_THRESHOLD,
  setStoredDashboardMode,
} from '@/lib/dashboardMode';
import { fetchEvents } from '@/lib/events';
import { isLiveDataMode } from '@/lib/session';

/** 应用首页 — 绑定 Agent 后的安全保护态 */
export default function AppHome() {
  const navigate = useNavigate();
  const { activeInstallId: installId } = useActiveInstall();
  const [events, setEvents] = useState<Awaited<ReturnType<typeof fetchEvents>>['data']>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = useCallback(
    (mode: 'initial' | 'refresh' | 'poll' = 'initial') => {
      if (mode === 'initial') setLoading(true);
      else setRefreshing(true);

      void fetchEvents({ installId, limit: 50 }).then((res) => {
        setEvents(res.data);
        setError(res.error);
        setLastUpdated(new Date());
        setLoading(false);
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

  useEffect(() => {
    if (events.length >= PROTECTION_GRADUATE_THRESHOLD) {
      setStoredDashboardMode('full');
    }
  }, [events.length]);

  const openFullDashboard = useCallback(() => {
    setStoredDashboardMode('full');
    navigate('/dashboard');
  }, [navigate]);

  return (
    <div className="relative flex min-h-screen">
      <DashboardBackdrop />
      <Sidebar />
      <MobileTabBar />

      <main className="dash-main relative z-10">
        {(!loading || isLiveDataMode()) && (
          <ProtectionLanding
            installId={installId}
            events={events}
            refreshing={refreshing}
            lastUpdated={lastUpdated}
            error={error}
            onRefresh={() => load('refresh')}
            onOpenFullDashboard={openFullDashboard}
          />
        )}
      </main>
    </div>
  );
}
