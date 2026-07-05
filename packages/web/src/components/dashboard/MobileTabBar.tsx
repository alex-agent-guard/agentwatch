import { Link, useLocation } from 'react-router-dom';

const tabs = [
  { to: '/', label: '首页' },
  { to: '/dashboard', label: '仪表盘' },
  { to: '/reports', label: '报告' },
  { to: '/settings', label: '设置' },
];

export default function MobileTabBar() {
  const location = useLocation();

  return (
    <nav className="dash-mobile-nav fixed bottom-0 left-0 right-0 z-50 md:hidden" aria-label="主导航">
      <div className="dash-mobile-nav__inner">
        {tabs.map((tab) => {
          const active = location.pathname === tab.to;
          return (
            <Link
              key={tab.to}
              to={tab.to}
              className={`dash-mobile-nav__item ${active ? 'dash-mobile-nav__item--active' : ''}`}
            >
              <span className="dash-mobile-nav__label">{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
