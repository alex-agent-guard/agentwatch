import { useId } from 'react';

import type { BrandIconId } from '@/lib/brandIcons';

interface BrandIconProps {
  id: BrandIconId;
  size?: number;
  className?: string;
}

/** 品牌图标 — 全部 SVG，任意尺寸清晰（尤其移动端 Retina） */
export default function BrandIcon({ id, size = 28, className = '' }: BrandIconProps) {
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

  if (id === 'claude-code') {
    return (
      <svg viewBox="0 0 48 48" {...common}>
        <rect width="48" height="48" rx="11.5" fill="#d97757" />
        <g stroke="#1a120e" strokeWidth="2.1" strokeLinecap="round">
          <line x1="24" y1="13" x2="24" y2="35" />
          <line x1="24" y1="13" x2="24" y2="35" transform="rotate(45 24 24)" />
          <line x1="24" y1="13" x2="24" y2="35" transform="rotate(90 24 24)" />
          <line x1="24" y1="13" x2="24" y2="35" transform="rotate(135 24 24)" />
          <line x1="24" y1="16" x2="24" y2="32" transform="rotate(22.5 24 24)" />
          <line x1="24" y1="16" x2="24" y2="32" transform="rotate(67.5 24 24)" />
          <line x1="24" y1="16" x2="24" y2="32" transform="rotate(112.5 24 24)" />
          <line x1="24" y1="16" x2="24" y2="32" transform="rotate(157.5 24 24)" />
        </g>
      </svg>
    );
  }

  if (id === 'cursor') {
    return (
      <svg viewBox="0 0 48 48" {...common}>
        <rect width="48" height="48" rx="11.5" fill="#1c1c1c" />
        <path
          d="M24 13.5 33.5 19v10L24 34.5 14.5 29V19L24 13.5z"
          fill="none"
          stroke="#ececec"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path d="M24 13.5v10.5M33.5 19 24 24M14.5 19 24 24" stroke="#ececec" strokeWidth="1.4" />
        <path d="M24 24 33.5 29M24 24 14.5 29" stroke="#8a8a8a" strokeWidth="1.4" />
        <path d="M21.5 21.5 27 24 21.5 26.5z" fill="#ececec" />
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
        <rect width="48" height="48" rx="11.5" fill="#eef0f4" />
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

  if (id === 'hermes') {
    const wingGrad = `hermes-g-${uid}`;
    return (
      <svg viewBox="0 0 48 48" {...common}>
        <defs>
          <linearGradient id={wingGrad} x1="12" y1="12" x2="36" y2="36" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#67e8f9" />
            <stop offset="100%" stopColor="#0891b2" />
          </linearGradient>
        </defs>
        <rect width="48" height="48" rx="11.5" fill="#0b1220" />
        <path
          d="M10 26c4-6 10-9 14-9s10 3 14 9"
          fill="none"
          stroke={`url(#${wingGrad})`}
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <path
          d="M14 26c2.5-3.5 6.5-5.5 10-5.5s7.5 2 10 5.5"
          fill="none"
          stroke={`url(#${wingGrad})`}
          strokeWidth="1.8"
          strokeLinecap="round"
          opacity="0.75"
        />
        <circle cx="24" cy="28" r="3.2" fill={`url(#${wingGrad})`} />
        <path
          d="M24 18.5v5.5"
          stroke={`url(#${wingGrad})`}
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  return null;
}
