import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import { onAuthStateChange } from '@/lib/auth';
import { clearGuestMode } from '@/lib/session';
import { supabase, USE_MOCK } from '@/lib/supabase';

function hasAuthCallbackInUrl(): boolean {
  const search = window.location.search;
  const hash = window.location.hash;
  return (
    search.includes('code=') ||
    hash.includes('access_token=') ||
    hash.includes('error=') ||
    hash.includes('error_description=')
  );
}

async function finishAuthCallback(navigate: (path: string, opts?: { replace?: boolean }) => void): Promise<boolean> {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.error('[AuthSessionBootstrap] getSession failed', error.message);
    return false;
  }
  if (!data.session) {
    return false;
  }

  clearGuestMode();
  navigate('/dashboard', { replace: true });
  window.history.replaceState({}, '', `${window.location.origin}${window.location.pathname}#/dashboard`);
  return true;
}

/**
 * GitHub OAuth + HashRouter：Supabase 回调可能在 ?code= 或 #access_token=。
 */
export default function AuthSessionBootstrap() {
  const navigate = useNavigate();

  useEffect(() => {
    if (USE_MOCK) {
      return;
    }

    if (hasAuthCallbackInUrl()) {
      void finishAuthCallback(navigate);
    }

    const unsubscribe = onAuthStateChange((session) => {
      if (!session) {
        return;
      }
      // 仅 OAuth 回调完成后跳转 Dashboard，避免开局从首页被拽走
      if (hasAuthCallbackInUrl()) {
        void finishAuthCallback(navigate);
      }
    });

    return unsubscribe;
  }, [navigate]);

  return null;
}
