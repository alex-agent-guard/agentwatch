import { useEffect, useRef } from 'react';
import { bindMobileVideoPlayback } from '@/lib/videoPlayback';

interface LoopVideoProps {
  src: string;
  className?: string;
  /** 0–1 */
  opacity?: number;
  objectPosition?: string;
  playbackRate?: number;
  filter?: string;
}

/** 无缝循环背景视频 */
export default function LoopVideo({
  src,
  className = '',
  opacity = 1,
  objectPosition = 'center',
  playbackRate = 1,
  filter,
}: LoopVideoProps) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.playbackRate = playbackRate;
    return bindMobileVideoPlayback(el);
  }, [src, playbackRate]);

  return (
    <video
      ref={ref}
      className={`absolute inset-0 h-full w-full object-cover ${className}`}
      style={{
        opacity,
        objectPosition,
        transition: 'opacity 0.55s ease',
        filter,
      }}
      src={src}
      autoPlay
      muted
      loop
      playsInline
      preload="auto"
      aria-hidden
    />
  );
}
