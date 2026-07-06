import { Link, useLocation } from 'react-router-dom';
import BrandLogo from '@/components/BrandLogo';
import { storeAuthRedirect } from '@/lib/authRedirect';

const links = [
  { to: '/', label: '首页' },
  { to: '/preview/home', label: 'Demo' },
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/reports', label: 'Reports' },
];

export default function Navbar() {
  const location = useLocation();

  return (
    <nav className="okx-nav fixed inset-x-0 top-0 z-40">
      <div className="okx-nav__inner mx-auto flex h-14 max-w-[1400px] items-center justify-between px-4 sm:px-6 md:px-10">
        <BrandLogo size="sm" className="text-white" />

        <div className="okx-nav__links flex min-w-0 items-center gap-4 overflow-x-auto sm:gap-6">
          {links.map((link) => {
            const active = location.pathname === link.to;
            return (
              <Link
                key={link.to}
                to={link.to}
                className={`type-nav shrink-0 text-xs transition sm:text-sm ${
                  active ? 'text-white' : 'text-white/50 hover:text-white/80'
                }`}
                onClick={() => {
                  if (link.to === '/dashboard' || link.to === '/reports') {
                    storeAuthRedirect(link.to);
                  }
                }}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
