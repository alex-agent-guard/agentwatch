import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  clearAuthCallbackFromUrl,
  onAuthStateChange,
  readAuthCallbackError,
  resetAuthFlow,
} from '@/lib/auth';
import { completeOAuthCallback, hasOAuthCallbackInUrl } from '@/lib/githubOAuthPopup';
import { resolvePostLoginRoute } from '@/lib/postAuthRoute';
import { clearGuestMode } from '@/lib/session';
import { USE_MOCK } from '@/lib/supabase';

export const AUTH_ERROR_STORAGE_KEY = 'agentwatch_auth_error';

async function routeAfterLogin(navigate: ReturnType<typeof useNavigate>): Promise<void> {
  clearGuestMode();
  const route = await resolvePostLoginRoute();
  navigate(route, { replace: true });
  window.history.replaceState(
    {},
    '',
    `${window.location.origin}${window.location.pathname}#${route}`,
  );
}

/** GitHub OAuth 回调：?code= 落在根路径时换 session 并进 Dashboard */
export default function AuthSessionBootstrap() {
  const navigate = useNavigate();
  const handledRef = useRef(false);

  useEffect(() => {
    if (USE_MOCK || !hasOAuthCallbackInUrl()) {
      return;
    }

    let oauthPending = true;

    const finishLogin = (): void => {
      if (handledRef.current) {
        return;
      }
      handledRef.current = true;
      oauthPending = false;
      void routeAfterLogin(navigate);
    };

    void (async () => {
      const callbackError = readAuthCallbackError();
      if (callbackError) {
        oauthPending = false;
        clearAuthCallbackFromUrl();
        await resetAuthFlow();
        sessionStorage.setItem(AUTH_ERROR_STORAGE_KEY, callbackError);
        navigate('/auth', { replace: true });
        return;
      }

      const ok = await completeOAuthCallback();
      if (ok) {
        finishLogin();
        return;
      }

      clearAuthCallbackFromUrl();
    })();

    const unsubscribe = onAuthStateChange((session) => {
      if (!oauthPending || handledRef.current || !session) {
        return;
      }
      void completeOAuthCallback().then((done) => {
        if (done) {
          finishLogin();
        }
      });
    });

    const fallbackTimer = window.setTimeout(() => {
      if (handledRef.current) {
        return;
      }
      oauthPending = false;
      sessionStorage.setItem(
        AUTH_ERROR_STORAGE_KEY,
        '登录回调超时，请返回登录页重试',
      );
      navigate('/auth', { replace: true });
    }, 20_000);

    return () => {
      oauthPending = false;
      window.clearTimeout(fallbackTimer);
      unsubscribe();
    };
  }, [navigate]);

  return null;
}
