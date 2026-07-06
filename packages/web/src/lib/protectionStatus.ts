/** 首页保护态视觉档位 — 无警告/拦截为 healthy */
export type ProtectionTone = 'healthy' | 'warn' | 'block';

export function getProtectionTone(blockCount: number, warnCount: number): ProtectionTone {
  if (blockCount > 0) return 'block';
  if (warnCount > 0) return 'warn';
  return 'healthy';
}

export function isProtectionHealthy(tone: ProtectionTone): boolean {
  return tone === 'healthy';
}
