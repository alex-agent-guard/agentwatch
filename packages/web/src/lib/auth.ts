import type { Session, User } from '@supabase/supabase-js';

import { clearGuestMode } from '@/lib/session';
import { supabase } from '@/lib/supabase';

const WEB3_STATEMENT = 'Sign in to AgentWatch Dashboard';

/** OAuth 回调后清理 ?code= / ?error=，避免 HashRouter 重复触发 */
export function clearAuthCallbackFromUrl(): void {
  if (typeof window === 'undefined') {
    return;
  }
  const url = new URL(window.location.href);
  const hadAuthParams =
    url.searchParams.has('code') ||
    url.searchParams.has('error') ||
    url.searchParams.has('error_description') ||
    url.hash.includes('access_token=') ||
    url.hash.includes('error=');

  if (!hadAuthParams) {
    return;
  }

  url.searchParams.delete('code');
  url.searchParams.delete('error');
  url.searchParams.delete('error_description');
  url.searchParams.delete('state');
  const hash = url.hash.replace(/[#?&](access_token|error|error_description|code)=[^&]*/g, '');
  url.hash = hash || '#/auth';
  window.history.replaceState({}, '', url.toString());
}

/** 从 OAuth 回调 URL 读取错误（GitHub / Supabase 跳回时） */
export function readAuthCallbackError(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const search = new URLSearchParams(window.location.search);
  const fromQuery = search.get('error_description') ?? search.get('error');
  if (fromQuery) {
    return decodeURIComponent(fromQuery.replace(/\+/g, ' '));
  }
  const hash = window.location.hash;
  const hashMatch = hash.match(/error_description=([^&]+)/);
  if (hashMatch?.[1]) {
    return decodeURIComponent(hashMatch[1].replace(/\+/g, ' '));
  }
  return null;
}

/** 退出并重置 OAuth 状态，便于「重新登录」 */
export async function resetAuthFlow(): Promise<void> {
  clearGuestMode();
  clearAuthCallbackFromUrl();
  await supabase.auth.signOut({ scope: 'local' });
}

function truncateAddress(address: string): string {
  if (address.length <= 12) {
    return address;
  }
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function readWalletAddress(user: User): string | null {
  const meta = user.user_metadata as Record<string, unknown> | undefined;
  if (typeof meta?.address === 'string' && meta.address.startsWith('0x')) {
    return meta.address;
  }

  for (const identity of user.identities ?? []) {
    const data = identity.identity_data as Record<string, unknown> | undefined;
    const sub = data?.sub;
    if (typeof sub === 'string' && sub.startsWith('0x')) {
      return sub;
    }
  }

  if (user.email?.endsWith('@wallet.local')) {
    const candidate = user.email.replace('@wallet.local', '');
    if (candidate.startsWith('0x')) {
      return candidate;
    }
  }

  return null;
}

/** 整页跳转 GitHub OAuth（避免弹窗卡在 GitHub 错误页无法返回） */
export async function signInWithGitHub(): Promise<{ error: string | null }> {
  clearGuestMode();
  clearAuthCallbackFromUrl();

  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'github',
    options: {
      redirectTo: `${window.location.origin}${window.location.pathname}`,
    },
  });

  return { error: error?.message ?? null };
}

export async function signInWithWallet(): Promise<{ error: string | null }> {
  clearGuestMode();

  if (typeof window.ethereum === 'undefined') {
    return { error: '未检测到 EVM 钱包（MetaMask 等）' };
  }

  const { error } = await supabase.auth.signInWithWeb3({
    chain: 'ethereum',
    statement: WEB3_STATEMENT,
  });

  return { error: error?.message ?? null };
}

export async function signOut(): Promise<void> {
  clearGuestMode();
  await supabase.auth.signOut();
}

export async function getSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

/** OAuth 回调时 Supabase 可能尚未写完 session，轮询等待 */
export async function waitForAuthSession(timeoutMs = 8000): Promise<Session | null> {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    const session = await getSession();
    if (session) {
      return session;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 120));
  }
  return null;
}

/** 等 Supabase 从 localStorage 恢复 session，避免误判未登录 */
export async function bootstrapAuthSession(timeoutMs = 4000): Promise<Session | null> {
  return new Promise((resolve) => {
    let settled = false;

    const finish = (session: Session | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      subscription.unsubscribe();
      window.clearTimeout(timer);
      resolve(session);
    };

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION') {
        finish(session);
      }
    });
    const subscription = data.subscription;

    void getSession().then((session) => {
      if (session) {
        finish(session);
      }
    });

    const timer = window.setTimeout(() => {
      void getSession().then(finish);
    }, timeoutMs);
  });
}

export async function getCurrentUser(): Promise<User | null> {
  const session = await getSession();
  return session?.user ?? null;
}

export function getAuthProvider(user: User | null): 'github' | 'wallet' | null {
  if (!user) {
    return null;
  }
  if (readWalletAddress(user)) {
    return 'wallet';
  }
  const provider =
    user.app_metadata?.provider ??
    user.identities?.find((id) => id.provider)?.provider;
  if (provider === 'github') {
    return 'github';
  }
  if (provider === 'ethereum' || provider === 'web3') {
    return 'wallet';
  }
  return 'github';
}

export function formatAccountLabel(user: User | null): string | null {
  if (!user) {
    return null;
  }

  const wallet = readWalletAddress(user);
  if (wallet) {
    return truncateAddress(wallet);
  }

  const meta = user.user_metadata as Record<string, unknown> | undefined;
  const rawName = meta?.user_name ?? meta?.full_name ?? meta?.name;
  if (typeof rawName === 'string' && rawName.trim()) {
    const handle = rawName.trim().replace(/^@/, '');
    return `@${handle}`;
  }

  if (user.email && !user.email.endsWith('@wallet.local')) {
    return user.email;
  }

  return '已登录';
}

export function onAuthStateChange(
  callback: (session: Session | null) => void,
): () => void {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session);
  });
  return () => {
    data.subscription.unsubscribe();
  };
}
