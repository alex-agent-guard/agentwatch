import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';

import AgentOnboarding from '@/components/AgentOnboarding';
import DevAppShell from '@/components/dashboard/DevAppShell';
import { getCurrentUser } from '@/lib/auth';
import { isLiveDataMode } from '@/lib/session';

/** 产品体验 — 设置 / 绑 Agent（未登录：无完整流程；已登录：跳转真实设置） */
export default function DevSettingsPreview() {
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    if (!isLiveDataMode()) {
      setAuthed(false);
      return;
    }
    void getCurrentUser().then((user) => setAuthed(user !== null));
  }, []);

  if (authed === null) {
    return (
      <DevAppShell>
        <div className="flex min-h-[40vh] items-center justify-center text-sm text-text-muted">
          加载中…
        </div>
      </DevAppShell>
    );
  }

  if (authed) {
    return <Navigate to="/settings" replace />;
  }

  return (
    <DevAppShell
      badge={
        <>
          产品体验
          {' · '}
          <Link to="/auth" className="agent-onboard-preview-badge__link">
            登录后开始绑定
          </Link>
        </>
      }
    >
      <AgentOnboarding
        demoPreview
        accountLabel={null}
        providerLabel={null}
        agentId=""
        uploadSecret=""
        fieldError={null}
        busy={false}
        showUploadSecret
        onAgentIdChange={() => undefined}
        onUploadSecretChange={() => undefined}
        onSubmit={(e: FormEvent) => e.preventDefault()}
        onSignOut={() => undefined}
      />
    </DevAppShell>
  );
}
