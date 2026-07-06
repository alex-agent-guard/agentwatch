import type { CSSProperties, ReactNode } from 'react';

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
  href?: string;
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
  href,
}: EntityBrandAvatarProps) {
  const iconId = resolveIcon(kind, entityKey);
  const px = size === 'sm' ? 22 : 32;

  const wrapLink = (node: ReactNode) => {
    if (!href) {
      return node;
    }
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="protect-matrix__avatar-link"
        title={iconId ? brandIconLabel(iconId) : undefined}
        aria-label={iconId ? `${brandIconLabel(iconId)} 官网` : '服务官网'}
      >
        {node}
      </a>
    );
  };

  if (iconId) {
    return wrapLink(
      <span
        className={`protect-matrix__avatar protect-matrix__avatar--brand ${muted ? 'protect-matrix__avatar--muted' : ''}`}
        title={href ? undefined : brandIconLabel(iconId)}
        aria-hidden={href ? undefined : true}
      >
        <BrandIcon id={iconId} size={px} />
      </span>,
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
