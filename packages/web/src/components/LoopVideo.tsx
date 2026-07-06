import { useCallback, useEffect, useRef, useState } from 'react';

import CinematicFallback from '@/components/CinematicFallback';
import { bindMobileVideoPlayback } from '@/lib/videoPlayback';
import type { CinematicVariant } from '@/lib/videoSources';
import { resolveVideoCandidates } from '@/lib/videoSources';

interface LoopVideoProps {
  src: string;
  className?: string;
  /** 0–1 */
  opacity?: number;
  objectPosition?: string;
  playbackRate?: number;
  filter?: string;
  /** 全部候选加载失败时显示 */
  fallbackVariant?: CinematicVariant;
}

type LoadState = 'loading' | 'playing' | 'failed';

/** 无缝循环背景视频 — 自动尝试 web/CDN 候选，失败优雅降级 */
export default function LoopVideo({
  src,
  className = '',
  opacity = 1,
  objectPosition = 'center',
  playbackRate = 1,
  filter,
  fallbackVariant = 'hero',
}: LoopVideoProps) {
  const ref = useRef<HTMLVideoElement>(null);
  const candidates = resolveVideoCandidates(src);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const activeSrc = candidates[candidateIndex] ?? src;

  const tryNextCandidate = useCallback(() => {
    setCandidateIndex((prev) => {
      if (prev + 1 < candidates.length) {
        setLoadState('loading');
        return prev + 1;
      }
      setLoadState('failed');
      return prev;
    });
  }, [candidates.length]);

  useEffect(() => {
    setCandidateIndex(0);
    setLoadState('loading');
  }, [src]);

  useEffect(() => {
    const el = ref.current;
    if (!el || loadState === 'failed') {
      return;
    }

    el.playbackRate = playbackRate;
    const unbind = bindMobileVideoPlayback(el);

    const onReady = () => {
      setLoadState('playing');
    };

    el.addEventListener('loadeddata', onReady);
    el.addEventListener('canplay', onReady);

    return () => {
      unbind();
      el.removeEventListener('loadeddata', onReady);
      el.removeEventListener('canplay', onReady);
    };
  }, [activeSrc, playbackRate, loadState]);

  const showVideo = loadState !== 'failed';
  const videoOpacity = loadState === 'playing' ? opacity : 0;

  return (
    <div className={`loop-video ${className}`.trim()}>
      <CinematicFallback variant={fallbackVariant} className="loop-video__fallback" />
      {showVideo ? (
        <video
          ref={ref}
          key={activeSrc}
          className="loop-video__clip absolute inset-0 h-full w-full object-cover"
          style={{
            opacity: videoOpacity,
            objectPosition,
            transition: 'opacity 0.85s ease',
            filter,
          }}
          src={activeSrc}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          aria-hidden
          onError={tryNextCandidate}
        />
      ) : null}
    </div>
  );
}
