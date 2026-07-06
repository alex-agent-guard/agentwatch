import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import DashboardBackdrop from '@/components/dashboard/DashboardBackdrop';
import MobileTabBar from '@/components/dashboard/MobileTabBar';
import Sidebar from '@/components/dashboard/Sidebar';

interface DevAppShellProps {
  children: ReactNode;
  badge?: ReactNode;
}

/** 新用户 Demo 壳 — 与正式应用相同的侧栏 / 底栏，路由在 /preview/* 下 */
export default function DevAppShell({ children, badge }: DevAppShellProps) {
  return (
    <>
      <p className="agent-onboard-preview-badge" role="status">
        {badge ?? (
          <>
            产品体验 · 示例数据，底部导航可浏览各页
            {' · '}
            <Link to="/auth" className="agent-onboard-preview-badge__link">
              登录开始使用
            </Link>
            {' · '}
            <Link to="/" className="agent-onboard-preview-badge__link">
              返回官网
            </Link>
          </>
        )}
      </p>
      <div className="relative flex min-h-screen">
        <DashboardBackdrop />
        <Sidebar />
        <MobileTabBar />
        <main className="dash-main relative z-10">{children}</main>
      </div>
    </>
  );
}
