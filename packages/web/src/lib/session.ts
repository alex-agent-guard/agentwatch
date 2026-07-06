import { USE_MOCK } from '@/lib/supabase';

export const GUEST_MODE_KEY = 'agentwatch_guest_mode';

/** Dev Mock 游客标记（Live 模式下 enterGuestMode 为 no-op） */
export function isGuestMode(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return window.localStorage.getItem(GUEST_MODE_KEY) === '1';
}

export function enterGuestMode(): void {
  if (!USE_MOCK) {
    return;
  }
  window.localStorage.setItem(GUEST_MODE_KEY, '1');
}

export function clearGuestMode(): void {
  window.localStorage.removeItem(GUEST_MODE_KEY);
}

/** Dev Mock 或历史 guest 标记 → Demo 数据；Live 模式必须 GitHub/Wallet 登录 */
export function shouldUseDemoData(): boolean {
  return USE_MOCK;
}

/** GitHub / Wallet 已登录且 Live 配置 → 读 Supabase */
export function isLiveDataMode(): boolean {
  return !USE_MOCK;
}
