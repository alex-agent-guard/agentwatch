import {
  clearAuthRedirect,
  peekAuthRedirect,
  type AuthRedirectPath,
} from '@/lib/authRedirect';
import { fetchLiveEntitlementStatus } from '@/lib/liveEntitlement';
import { isLiveGateEnabled } from '@/lib/liveGate';
import { listUserAgents } from '@/lib/userAgents';
import { shouldUseDemoData } from '@/lib/session';

/** 登录 / 兑换后落地页：Live → Agent 绑定 → 原目标页 */
export async function resolvePostLoginRoute(): Promise<AuthRedirectPath | '/activate'> {
  const intended = peekAuthRedirect();
  clearAuthRedirect();

  if (shouldUseDemoData()) {
    return intended ?? '/home';
  }

  if (isLiveGateEnabled()) {
    const live = await fetchLiveEntitlementStatus();
    if (!live.entitled) {
      return '/activate';
    }
  }

  const { data } = await listUserAgents();
  if (data.length === 0) {
    return '/settings';
  }

  if (intended === '/reports' || intended === '/dashboard' || intended === '/home') {
    return intended;
  }

  return '/home';
}

/** @deprecated 使用 resolvePostLoginRoute */
export async function getPostAuthRoute(): Promise<AuthRedirectPath | '/activate'> {
  return resolvePostLoginRoute();
}
