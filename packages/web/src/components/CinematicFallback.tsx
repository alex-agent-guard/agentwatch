import type { CinematicVariant } from '@/lib/videoSources';

interface CinematicFallbackProps {
  variant: CinematicVariant;
  className?: string;
}

const VARIANT_CLASS: Record<CinematicVariant, string> = {
  hero: 'cine-fallback--hero',
  auth: 'cine-fallback--auth',
  discover: 'cine-fallback--discover',
  intercept: 'cine-fallback--intercept',
  audit: 'cine-fallback--audit',
  protection: 'cine-fallback--protection',
};

/** 视频不可用时的电影感兜底 — 渐变 + 星点 + 慢速呼吸 */
export default function CinematicFallback({ variant, className = '' }: CinematicFallbackProps) {
  return (
    <div
      className={`cine-fallback ${VARIANT_CLASS[variant]} ${className}`.trim()}
      aria-hidden
    >
      <div className="cine-fallback__mesh" />
      <div className="cine-fallback__stars" />
      <div className="cine-fallback__grain" />
    </div>
  );
}
