import { useId } from 'react';

import { BRAND_IMAGE_ASSETS, type BrandIconId } from '@/lib/brandIcons';

interface BrandIconProps {
  id: BrandIconId;
  size?: number;
  className?: string;
}

function BrandImageIcon({ src, className }: { src: string; className: string }) {
  return (
    <img
      src={src}
      alt=""
      className={`brand-icon brand-icon--img ${className}`.trim()}
      draggable={false}
      decoding="async"
    />
  );
}

/** 品牌图标 — Claude / Cursor / Codex / Hermes 用官方 PNG，OKX 用 SVG */
export default function BrandIcon({ id, size = 28, className = '' }: BrandIconProps) {
  const imageSrc = BRAND_IMAGE_ASSETS[id];
  if (imageSrc) {
    return <BrandImageIcon src={imageSrc} className={className} />;
  }

  const uid = useId().replace(/:/g, '');

  const common = {
    width: size,
    height: size,
    className: `brand-icon ${className}`.trim(),
    'aria-hidden': true as const,
  };

  if (id === 'okx') {
    const grad = `okx-g-${uid}`;
    return (
      <svg viewBox="0 0 48 48" {...common}>
        <defs>
          <linearGradient id={grad} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="100%" stopColor="#c4c4c4" />
          </linearGradient>
        </defs>
        <rect width="48" height="48" rx="11.5" fill="#000000" />
        <rect x="8" y="8" width="10.5" height="10.5" rx="1.2" fill={`url(#${grad})`} />
        <rect x="29.5" y="8" width="10.5" height="10.5" rx="1.2" fill={`url(#${grad})`} />
        <rect x="18.75" y="18.75" width="10.5" height="10.5" rx="1.2" fill={`url(#${grad})`} />
        <rect x="8" y="29.5" width="10.5" height="10.5" rx="1.2" fill={`url(#${grad})`} />
        <rect x="29.5" y="29.5" width="10.5" height="10.5" rx="1.2" fill={`url(#${grad})`} />
      </svg>
    );
  }

  return null;
}
