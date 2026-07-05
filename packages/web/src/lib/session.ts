import { USE_MOCK } from '@/lib/supabase';

export const GUEST_MODE_KEY = 'agentwatch_guest_mode';

/** 游客模式 — 无需登录，Dashboard 展示 Demo 数据 */
export function isGuestMode(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return window.localStorage.getItem(GUEST_MODE_KEY) === '1';
}

export function enterGuestMode(): void {
  window.localStorage.setItem(GUEST_MODE_KEY, '1');
}

export function clearGuestMode(): void {
  window.localStorage.removeItem(GUEST_MODE_KEY);
}

/** Mock 环境变量 或 游客模式 → 使用 Demo 数据，不走 Supabase RLS */
export function shouldUseDemoData(): boolean {
  return USE_MOCK || isGuestMode();
}

/** 已 GitHub 登录且非 Demo → 读 Supabase Live 数据 */
export function isLiveDataMode(): boolean {
  return !shouldUseDemoData();
}
