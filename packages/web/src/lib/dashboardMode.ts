export const PROTECTION_GRADUATE_THRESHOLD = 20;

const STORAGE_KEY = 'agentwatch_dashboard_mode';

export type DashboardMode = 'protection' | 'full';

export function getStoredDashboardMode(): DashboardMode {
  if (typeof window === 'undefined') return 'protection';
  return localStorage.getItem(STORAGE_KEY) === 'full' ? 'full' : 'protection';
}

export function setStoredDashboardMode(mode: DashboardMode): void {
  localStorage.setItem(STORAGE_KEY, mode);
}

export function shouldShowProtectionLanding(
  eventCount: number,
  mode: DashboardMode,
  live: boolean,
): boolean {
  if (!live) return false;
  if (eventCount >= PROTECTION_GRADUATE_THRESHOLD) return false;
  if (mode === 'full') return false;
  return true;
}
