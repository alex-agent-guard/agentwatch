import type { Session, User } from '@supabase/supabase-js';

import { clearGuestMode } from '@/lib/session';
import { supabase } from '@/lib/supabase';

const WEB3_STATEMENT = 'Sign in to AgentWatch Dashboard';

function authRedirectUrl(): string {
  return `${window.location.origin}${window.location.pathname}`;
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

export async function signInWithGitHub(): Promise<{ error: string | null }> {
  clearGuestMode();

  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'github',
    options: {
      redirectTo: authRedirectUrl(),
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

export async function getCurrentUser(): Promise<User | null> {
  const session = await getSession();
  return session?.user ?? null;
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
