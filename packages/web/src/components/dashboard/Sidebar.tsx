import { Link, useLocation } from 'react-router-dom';
import BrandLogo from '@/components/BrandLogo';

const navItems = [
  { to: '/', label: '首页' },
  { to: '/dashboard', label: '仪表盘' },
  { to: '/reports', label: '报告' },
  { to: '/settings', label: '设置' },
];

export default function Sidebar() {
  const location = useLocation();

  return (
    <aside className="dash-sidebar dash-glass relative z-10 hidden w-56 shrink-0 p-4 md:block">
      <BrandLogo to="/" size="md" className="mb-8 px-2" />

      <nav className="space-y-0.5">
        {navItems.map((item) => {
          const active = location.pathname === item.to;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`dashboard-sidebar-link flex items-center rounded-lg px-3 py-2 text-sm transition duration-150 ${
                active
                  ? 'dashboard-sidebar-link--active bg-white/[0.05] text-text-primary'
                  : 'text-text-secondary hover:bg-white/[0.03] hover:text-text-primary'
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-8 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3.5">
        <p className="text-[11px] font-medium text-text-secondary">数据隔离</p>
        <p className="mt-1.5 text-[11px] leading-relaxed text-text-muted">
          RLS + install_id，仅展示当前 Agent 事件。
        </p>
      </div>
    </aside>
  );
}
