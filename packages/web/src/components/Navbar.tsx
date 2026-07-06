import { useEffect, useState } from 'react';
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
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
      }
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  return (
    <>
      <nav className="okx-nav fixed inset-x-0 top-0 z-40">
        <div className="okx-nav__inner mx-auto flex h-14 max-w-[1400px] items-center justify-between px-4 sm:px-6 md:px-10">
          <div className="flex min-w-0 items-center gap-3 md:gap-8">
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

          <div className="flex shrink-0 items-center gap-2">
            <Link to="/auth" className="okx-btn-white hidden text-xs sm:inline-flex md:text-sm">
              Begin
            </Link>
            <button
              type="button"
              className="okx-nav__menu-btn md:hidden"
              aria-label={menuOpen ? '关闭菜单' : '打开菜单'}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <span className={menuOpen ? 'okx-nav__menu-icon okx-nav__menu-icon--open' : 'okx-nav__menu-icon'} aria-hidden />
            </button>
          </div>
        </div>
      </nav>

      {menuOpen && (
        <div className="okx-nav__sheet md:hidden" role="dialog" aria-modal="true" aria-label="导航菜单">
          <button
            type="button"
            className="okx-nav__sheet-backdrop"
            aria-label="关闭菜单"
            onClick={() => setMenuOpen(false)}
          />
          <div className="okx-nav__sheet-panel">
            <div className="okx-nav__sheet-links">
              {links.map((link) => {
                const active = location.pathname === link.to;
                return (
                  <Link
                    key={link.to}
                    to={link.to}
                    className={`okx-nav__sheet-link ${active ? 'okx-nav__sheet-link--active' : ''}`}
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
            <Link to="/auth" className="okx-btn-white okx-nav__sheet-cta">
              Begin
            </Link>
          </div>
        </div>
      )}
    </>
  );
}
