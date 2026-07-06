import { Link, useLocation } from 'react-router-dom';
import BrandLogo from '@/components/BrandLogo';
import { storeAuthRedirect } from '@/lib/authRedirect';

const links = [
  { to: '/', label: '首页' },
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/reports', label: 'Reports' },
];

export default function Navbar() {
  const location = useLocation();

  return (
    <nav className="okx-nav fixed inset-x-0 top-0 z-40">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between px-6 md:px-10">
        <div className="flex items-center gap-8">
          <BrandLogo size="sm" className="text-white" />

          <div className="hidden items-center gap-6 md:flex">
            {links.map((link) => {
              const active = location.pathname === link.to;
              return (
                <Link
                  key={link.to}
                  to={link.to}
                  className={`type-nav text-sm transition ${
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

        <Link to="/auth" className="okx-btn-white text-xs md:text-sm">
          Begin
        </Link>
      </div>
    </nav>
  );
}
