import {
  clearAuthCallbackFromUrl,
  getSession,
  readAuthCallbackError,
  waitForAuthSession,
} from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export const AUTH_MESSAGE = {
  success: 'agentwatch-auth-success',
  error: 'agentwatch-auth-error',
} as const;

/** OAuth 回调页（整页或弹窗）处理 code / error */
export async function completeOAuthCallback(): Promise<boolean> {
  const callbackError = readAuthCallbackError();
  if (callbackError) {
    clearAuthCallbackFromUrl();
    return false;
  }

  // detectSessionInUrl 会自动换 code；先等 session 就绪，避免竞态误判失败
  let session = await waitForAuthSession(6000);
  if (!session) {
    const code = new URLSearchParams(window.location.search).get('code');
    if (code) {
      const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
      if (!exchangeError) {
        session = await waitForAuthSession(3000);
      }
    }
  }

  if (!session) {
    session = await getSession();
  }

  if (!session) {
    return false;
  }

  clearAuthCallbackFromUrl();
  return true;
}

export function hasOAuthCallbackInUrl(): boolean {
  const search = window.location.search;
  const hash = window.location.hash;
  return (
    search.includes('code=') ||
    search.includes('error=') ||
    hash.includes('access_token=') ||
    hash.includes('error=')
  );
}
