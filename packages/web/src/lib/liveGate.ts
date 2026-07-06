import { shouldUseDemoData } from '@/lib/session';

/** Live Dashboard 是否要求激活码（Mock 与 VITE_LIVE_GATE=false 时关闭） */
export function isLiveGateEnabled(): boolean {
  if (shouldUseDemoData()) {
    return false;
  }
  const flag = import.meta.env.VITE_LIVE_GATE as string | undefined;
  if (flag === 'false' || flag === '0') {
    return false;
  }
  return true;
}
