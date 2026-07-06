import { describe, expect, it } from 'vitest';
import { getProtectionTone } from '@/lib/protectionStatus';

describe('getProtectionTone', () => {
  it('returns healthy when no warn or block', () => {
    expect(getProtectionTone(0, 0)).toBe('healthy');
  });

  it('returns warn when only warns present', () => {
    expect(getProtectionTone(0, 2)).toBe('warn');
  });

  it('returns block when blocks present even with warns', () => {
    expect(getProtectionTone(1, 3)).toBe('block');
  });
});
