import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { fetchLiveEntitlementStatus } from '@/lib/liveEntitlement';
import { isLiveGateEnabled } from '@/lib/liveGate';

interface RequireLiveProps {
  children: ReactNode;
}

export default function RequireLive({ children }: RequireLiveProps) {
  const location = useLocation();
  const [ready, setReady] = useState(!isLiveGateEnabled());
  const [entitled, setEntitled] = useState(!isLiveGateEnabled());

  useEffect(() => {
    if (!isLiveGateEnabled()) {
      setEntitled(true);
      setReady(true);
      return;
    }

    let cancelled = false;

    void fetchLiveEntitlementStatus().then((status) => {
      if (cancelled) return;
      setEntitled(status.entitled);
      setReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#131a26] text-sm text-white/60">
        正在验证 Live 权限…
      </div>
    );
  }

  if (!entitled) {
    return <Navigate to="/activate" replace state={{ from: location.pathname }} />;
  }

  return children;
}
