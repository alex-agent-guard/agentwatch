import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { getSession, onAuthStateChange } from '@/lib/auth';
import { isGuestMode } from '@/lib/session';
import { USE_MOCK } from '@/lib/supabase';

interface RequireAuthProps {
  children: ReactNode;
}

export default function RequireAuth({ children }: RequireAuthProps) {
  const location = useLocation();
  const [ready, setReady] = useState(USE_MOCK || isGuestMode());
  const [allowed, setAllowed] = useState(USE_MOCK || isGuestMode());

  useEffect(() => {
    if (USE_MOCK) {
      setAllowed(true);
      setReady(true);
      return;
    }

    const syncGuest = () => {
      if (isGuestMode()) {
        setAllowed(true);
        setReady(true);
      }
    };

    syncGuest();

    let cancelled = false;
    void getSession().then((session) => {
      if (cancelled) {
        return;
      }
      setAllowed(isGuestMode() || session !== null);
      setReady(true);
    });

    const unsubscribe = onAuthStateChange((session) => {
      if (cancelled) {
        return;
      }
      setAllowed(isGuestMode() || session !== null);
      setReady(true);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [location.pathname]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#131a26] text-sm text-white/60">
        正在验证登录…
      </div>
    );
  }

  if (!allowed) {
    return <Navigate to="/auth" replace state={{ from: location.pathname }} />;
  }

  return children;
}
