import type { Session, User } from '@supabase/supabase-js';

import { clearInstallBindSessionFlags } from '@/lib/authCleanup';
import {
  getOAuthRedirectUrl,
  inAppBrowserHint,
  isRestrictedInAppBrowser,
} from '@/lib/oauthRedirect';
import { clearGuestMode } from '@/lib/session';
import { supabase } from '@/lib/supabase';

import {
  buildSiweMessage,
  personalSign,
  readChainId,
  requestAccounts,
  resolveEvmWallet,
} from '@/lib/evmWallet';
import { exchangeWeb3Token } from '@/lib/web3AuthExchange';

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
  const cleanedHash = url.hash.replace(/[#?&](access_token|error|error_description|code)=[^&]*/g, '');
  url.hash = cleanedHash && cleanedHash !== '#' ? cleanedHash : '#/';
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
  clearInstallBindSessionFlags();
  clearAuthCallbackFromUrl();
  await supabase.auth.signOut({ scope: 'local' });
}

export async function signOut(): Promise<void> {
  clearGuestMode();
  clearInstallBindSessionFlags();
  await supabase.auth.signOut({ scope: 'global' });
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

/** 整页跳转 GitHub OAuth（移动端必须显式 assign，避免跳转被吞） */
export async function signInWithGitHub(): Promise<{ error: string | null }> {
  if (isRestrictedInAppBrowser()) {
    return { error: inAppBrowserHint() };
  }

  clearGuestMode();
  clearAuthCallbackFromUrl();

  const redirectTo = getOAuthRedirectUrl();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'github',
    options: {
      redirectTo,
      skipBrowserRedirect: true,
    },
  });

  if (error) {
    return { error: error.message };
  }

  if (!data?.url) {
    return { error: '无法获取 GitHub 授权地址，请检查网络或稍后重试' };
  }

  // 移动端 Safari / Chrome 需显式跳转；部分 WebView 不会自动 follow
  window.location.assign(data.url);
  return { error: null };
}

function mapWalletAuthError(msg: string, chainId?: number): string {
  if (/Invalid value|fetch/i.test(msg)) {
    return '钱包扩展干扰了网络请求。请换 Chrome + OKX Wallet 重试；仍失败可改用 MetaMask 或在 OKX App 内置浏览器打开。';
  }
  if (/web3_provider_disabled|Web3 provider is disabled/i.test(msg)) {
    return 'Supabase 未启用 Web3 Wallet。请打开 Supabase → Authentication → Providers → Web3 → 启用 Ethereum，保存后重试。';
  }
  if (/invalid|signature|siwe|chain|validation/i.test(msg)) {
    return chainId !== undefined
      ? `Wallet 验签失败：${msg}（当前 Chain ID: ${chainId}）`
      : `Wallet 验签失败：${msg}`;
  }
  return msg;
}

export async function signInWithWallet(): Promise<{ error: string | null }> {
  clearGuestMode();

  const wallet = resolveEvmWallet();
  if (!wallet) {
    return { error: '未检测到 EVM 钱包。请安装 OKX Wallet 或 MetaMask 浏览器扩展，并用 Chrome 打开本站。' };
  }

  try {
    const address = await requestAccounts(wallet);
    const chainId = await readChainId(wallet);
    const pageUrl = new URL(window.location.href);
    const message = buildSiweMessage({
      domain: pageUrl.host,
      address,
      statement: WEB3_STATEMENT,
      uri: pageUrl.href,
      chainId,
    });
    const signature = await personalSign(wallet, message, address);

    const tokenResult = await exchangeWeb3Token({ message, signature });
    if ('error' in tokenResult) {
      return { error: mapWalletAuthError(tokenResult.error, chainId) };
    }

    const { error } = await supabase.auth.setSession({
      access_token: tokenResult.accessToken,
      refresh_token: tokenResult.refreshToken,
    });
    if (error) {
      return { error: mapWalletAuthError(error.message ?? 'Session 写入失败', chainId) };
    }

    return { error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: mapWalletAuthError(msg) };
  }
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
