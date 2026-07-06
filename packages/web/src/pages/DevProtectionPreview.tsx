import { useCallback, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import DevAppShell from '@/components/dashboard/DevAppShell';
import ProtectionLanding from '@/components/dashboard/ProtectionLanding';
import {
  parseDemoScenario,
} from '@/components/dashboard/ProtectionDemoScenarios';
import type { DemoScenario } from '@/data/mockData';
import { getDemoEventsForScenario } from '@/data/mockData';

const PREVIEW_INSTALL_ID = 'agent_preview_demo';

/** 产品体验 — 首页（可切换 一切正常 / 警告 / 拦截） */
export default function DevProtectionPreview() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const scenario = parseDemoScenario(searchParams.get('scenario'));
  const events = useMemo(() => getDemoEventsForScenario(scenario), [scenario]);

  const onScenarioChange = useCallback(
    (next: DemoScenario) => {
      if (next === 'healthy') {
        navigate('/preview/home', { replace: true });
        return;
      }
      navigate(`/preview/home?scenario=${next}`, { replace: true });
    },
    [navigate],
  );

  return (
    <DevAppShell
      badge={
        <>
          产品体验 · 示例数据
          {' · '}
          <Link to="/auth" className="agent-onboard-preview-badge__link">
            登录开始使用
          </Link>
        </>
      }
    >
      <ProtectionLanding
        installId={PREVIEW_INSTALL_ID}
        events={events}
        refreshing={false}
        lastUpdated={new Date()}
        error={null}
        onRefresh={() => undefined}
        onOpenFullDashboard={() => undefined}
        demoScenario={scenario}
        onDemoScenarioChange={onScenarioChange}
      />
    </DevAppShell>
  );
}

/** 产品体验 — 首页 · 新用户空数据 */
export function DevProtectionEmptyPreview() {
  return (
    <DevAppShell
      badge={
        <>
          产品体验 · 新用户尚无数据
          {' · '}
          <Link to="/preview/home" className="agent-onboard-preview-badge__link">
            有数据示例
          </Link>
        </>
      }
    >
      <ProtectionLanding
        installId={PREVIEW_INSTALL_ID}
        events={[]}
        refreshing={false}
        lastUpdated={new Date()}
        error={null}
        onRefresh={() => undefined}
        onOpenFullDashboard={() => undefined}
      />
    </DevAppShell>
  );
}
