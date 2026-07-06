import type { CSSProperties } from 'react';

import BrandIcon from '@/components/icons/BrandIcon';
import {
  brandIconLabel,
  clientBrandIcon,
  serviceBrandIcon,
  type BrandIconId,
} from '@/lib/brandIcons';

interface EntityBrandAvatarProps {
  kind: 'client' | 'service';
  entityKey: string;
  fallbackShort: string;
  fallbackColor: string;
  muted?: boolean;
  size?: 'sm' | 'md';
}

function resolveIcon(kind: 'client' | 'service', entityKey: string): BrandIconId | null {
  return kind === 'client' ? clientBrandIcon(entityKey) : serviceBrandIcon(entityKey);
}

export default function EntityBrandAvatar({
  kind,
  entityKey,
  fallbackShort,
  fallbackColor,
  muted = false,
  size = 'md',
}: EntityBrandAvatarProps) {
  const iconId = resolveIcon(kind, entityKey);
  const px = size === 'sm' ? 18 : 28;

  if (iconId) {
    return (
      <span
        className={`protect-matrix__avatar protect-matrix__avatar--brand ${muted ? 'protect-matrix__avatar--muted' : ''}`}
        title={brandIconLabel(iconId)}
        aria-hidden
      >
        <BrandIcon id={iconId} size={px} />
      </span>
    );
  }

  return (
    <span
      className={`protect-matrix__avatar ${muted ? 'protect-matrix__avatar--muted' : ''}`}
      style={{ '--avatar-color': fallbackColor } as CSSProperties}
      aria-hidden
    >
      {fallbackShort}
    </span>
  );
}
