import { Link, useLocation } from 'react-router-dom';

import { getAppNavItems, isAppNavActive } from '@/lib/appNavigation';

export default function MobileTabBar() {
  const location = useLocation();
  const tabs = getAppNavItems(location.pathname);

  return (
    <nav
      className="dash-mobile-nav fixed bottom-0 left-0 right-0 z-[60] md:hidden"
      aria-label="主导航"
    >
      <div className="dash-mobile-nav__inner">
        {tabs.map((tab) => {
          const active = isAppNavActive(location.pathname, tab.to);
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
