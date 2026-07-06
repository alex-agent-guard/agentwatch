export interface AppNavItem {
  to: string;
  label: string;
}

/** 是否在 Demo 产品体验壳内（/preview/*） */
export function isPreviewNavigation(pathname: string): boolean {
  return pathname.startsWith('/preview/');
}

/** 应用内主导航 — 首页 / 仪表盘 / 报告 / 设置 */
export function getAppNavItems(pathname: string): AppNavItem[] {
  const base = isPreviewNavigation(pathname) ? '/preview' : '';
  return [
    { to: `${base}/home`, label: '首页' },
    { to: `${base}/dashboard`, label: '仪表盘' },
    { to: `${base}/reports`, label: '报告' },
    { to: `${base}/settings`, label: '设置' },
  ];
}

export function isAppNavActive(pathname: string, target: string): boolean {
  if (pathname === target) {
    return true;
  }
  // 兼容旧预览 URL /preview/protection
  if (target.endsWith('/home') && pathname === target.replace('/home', '/protection')) {
    return true;
  }
  return false;
}
