import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

import DashboardBackdrop from '@/components/dashboard/DashboardBackdrop';
import MobileTabBar from '@/components/dashboard/MobileTabBar';
import Sidebar from '@/components/dashboard/Sidebar';
import { useTabSwipe } from '@/lib/useTabSwipe';

interface AppShellProps {
  children: ReactNode;
  className?: string;
}

/** 已登录应用壳 — 侧栏 + 底栏 + 主内容（支持 Tab 滑动） */
export default function AppShell({ children, className = '' }: AppShellProps) {
  const location = useLocation();
  useTabSwipe(location.pathname);

  return (
    <div className="relative flex min-h-screen">
      <DashboardBackdrop />
      <Sidebar />
      <MobileTabBar />
      <main className={`dash-main dash-main--swipe relative z-10 ${className}`.trim()}>{children}</main>
    </div>
  );
}
