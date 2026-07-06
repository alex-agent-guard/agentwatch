import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { bootstrapAuthSession, onAuthStateChange } from '@/lib/auth';
import { persistBindPrefillFromSearch } from '@/lib/agentBindPrefill';
import { storeAuthRedirect } from '@/lib/authRedirect';
import { USE_MOCK } from '@/lib/supabase';

interface RequireAuthProps {
  children: ReactNode;
}

export default function RequireAuth({ children }: RequireAuthProps) {
  const location = useLocation();
  const [ready, setReady] = useState(USE_MOCK);
  const [allowed, setAllowed] = useState(USE_MOCK);

  useEffect(() => {
    if (USE_MOCK) {
      setAllowed(true);
      setReady(true);
      return;
    }

    let cancelled = false;

    void bootstrapAuthSession().then((session) => {
      if (cancelled) {
        return;
      }
      setAllowed(session !== null);
      setReady(true);
    });

    const unsubscribe = onAuthStateChange((session) => {
      if (cancelled) {
        return;
      }
      setAllowed(session !== null);
      setReady(true);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#131a26] text-sm text-white/60">
        正在验证登录…
      </div>
    );
  }

  if (!allowed) {
    storeAuthRedirect(location.pathname);
    persistBindPrefillFromSearch(location.search);
    return <Navigate to="/auth" replace />;
  }

  return children;
}
