import { useEffect, useState, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';

import { useActiveInstall } from '@/hooks/useActiveInstall';
import { isLiveDataMode } from '@/lib/session';
import { getActiveInstallId } from '@/types/events';

interface RequireBoundAgentProps {
  children: ReactNode;
}

function hasLocalBoundInstall(): boolean {
  const id = getActiveInstallId();
  return id.startsWith('agent_') && id !== 'demo-install';
}

/** Live 模式下未绑定 Agent 时，重定向到设置引导页 */
export default function RequireBoundAgent({ children }: RequireBoundAgentProps) {
  const { agents, loading, error } = useActiveInstall();
  const [ready, setReady] = useState(!isLiveDataMode());

  useEffect(() => {
    if (!loading) {
      setReady(true);
    }
  }, [loading]);

  if (!isLiveDataMode()) {
    return children;
  }

  if (!ready || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#131a26] text-sm text-white/60">
        正在加载…
      </div>
    );
  }

  if (agents.length === 0) {
    if (hasLocalBoundInstall()) {
      return children;
    }

    if (error) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[#131a26] px-6 text-center text-sm text-white/70">
          <p>无法加载 Agent 绑定信息</p>
          <p className="text-white/45">{error}</p>
          <a href="#/settings" className="text-[#8fd4a8] underline">
            前往设置页重试
          </a>
        </div>
      );
    }

    return <Navigate to="/settings" replace />;
  }

  return children;
}
