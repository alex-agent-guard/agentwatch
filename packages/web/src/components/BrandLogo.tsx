import { Link } from 'react-router-dom';

export const BRAND_LOGO_SRC = '/assets/logo.png';
export const BRAND_NAME_CN = '汐底';
export const BRAND_NAME_EN = 'Deep Trench';

const sizeMap = {
  xs: 'h-6 w-6',
  sm: 'h-7 w-7',
  md: 'h-8 w-8',
  lg: 'h-10 w-10',
} as const;

const wordmarkSizeMap = {
  xs: { cn: 'text-[13px]', en: 'text-[9px]' },
  sm: { cn: 'text-[15px]', en: 'text-[10px]' },
  md: { cn: 'text-[17px]', en: 'text-[11px]' },
  lg: { cn: 'text-xl', en: 'text-xs' },
} as const;

interface BrandLogoProps {
  size?: keyof typeof sizeMap;
  showText?: boolean;
  className?: string;
  to?: string;
}

export default function BrandLogo({
  size = 'sm',
  showText = true,
  className = '',
  to = '/',
}: BrandLogoProps) {
  const wordmark = wordmarkSizeMap[size];

  const content = (
    <>
      <img
        src={BRAND_LOGO_SRC}
        alt={`${BRAND_NAME_CN} ${BRAND_NAME_EN}`}
        className={`${sizeMap[size]} shrink-0 rounded-md object-contain`}
      />
      {showText ? (
        <span className="brand-wordmark flex flex-col items-start justify-center leading-none">
          <span className={`brand-wordmark-cn ${wordmark.cn}`}>{BRAND_NAME_CN}</span>
          <span className={`brand-wordmark-en ${wordmark.en}`}>{BRAND_NAME_EN}</span>
        </span>
      ) : null}
    </>
  );

  if (to) {
    return (
      <Link to={to} className={`flex items-center gap-2.5 ${className}`}>
        {content}
      </Link>
    );
  }

  return <div className={`flex items-center gap-2.5 ${className}`}>{content}</div>;
}
