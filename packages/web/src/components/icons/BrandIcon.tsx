import { useId } from 'react';

import { BRAND_IMAGE_ASSETS, type BrandIconId } from '@/lib/brandIcons';

interface BrandIconProps {
  id: BrandIconId;
  size?: number;
  className?: string;
}

function BrandImageIcon({ src, size, className }: { src: string; size: number; className: string }) {
  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className={`brand-icon brand-icon--img ${className}`.trim()}
      draggable={false}
      decoding="async"
    />
  );
}

/** 品牌图标 — Claude / Cursor 用官方 PNG，其余用 SVG */
export default function BrandIcon({ id, size = 28, className = '' }: BrandIconProps) {
  const imageSrc = BRAND_IMAGE_ASSETS[id];
  if (imageSrc) {
    return <BrandImageIcon src={imageSrc} size={size} className={className} />;
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

  const cloudGrad = `codex-g-${uid}`;
  if (id === 'codex') {
    return (
    <svg viewBox="0 0 48 48" {...common}>
      <defs>
        <linearGradient id={cloudGrad} x1="24" y1="10" x2="24" y2="36" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#c4b5fd" />
          <stop offset="55%" stopColor="#818cf8" />
          <stop offset="100%" stopColor="#2563eb" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="11.5" fill="#f3f4f6" />
      <path
        d="M14 28c-3.3 0-6-2.4-6-5.4 0-2.7 2-5 4.7-5.5.8-3.5 4-6.1 7.8-6.1 3.1 0 5.8 1.7 7.2 4.2 3.5.3 6.3 3.1 6.3 6.6 0 3.7-3 6.2-6.7 6.2H14z"
        fill={`url(#${cloudGrad})`}
      />
      <text
        x="24"
        y="27.5"
        textAnchor="middle"
        fill="#ffffff"
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
        fontSize="11"
        fontWeight="700"
      >
        &gt;_
      </text>
    </svg>
    );
  }

  return null;
}
