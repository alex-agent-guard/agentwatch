/** 激活码格式：AW-LIVE-XXXX-XXXX → 规范化 AWLIVE + 8 位 [A-Z0-9] */

const CODE_PATTERN = /^AWLIVE[A-Z0-9]{8}$/;

export function normalizeActivationCode(input: string): string | null {
  const compact = input.trim().toUpperCase().replace(/[\s-]/g, '');
  if (!CODE_PATTERN.test(compact)) {
    return null;
  }
  return compact;
}

export function formatActivationCode(normalized: string): string {
  const tail = normalized.slice(6);
  return `AW-LIVE-${tail.slice(0, 4)}-${tail.slice(4)}`;
}

export function isActivationCodeFormat(input: string): boolean {
  return normalizeActivationCode(input) !== null;
}
