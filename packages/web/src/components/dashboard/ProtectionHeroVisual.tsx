import { useCallback, useEffect, useRef, useState } from 'react';

import { PROTECTION_ASSETS, VIDEO_ASSETS } from '@/data/videoAssets';
import type { ProtectionTone } from '@/lib/protectionStatus';

interface ProtectionHeroVisualProps {
  muted: boolean;
  tone: ProtectionTone;
}

const LOOP_CROSSFADE_MS = 520;
const LOOP_LEAD_SEC = 0.55;

const TONE_HERO_IMAGE: Partial<Record<ProtectionTone, string>> = {
  warn: PROTECTION_ASSETS.warnHero,
  block: PROTECTION_ASSETS.blockHero,
};

function bindVideoElement(video: HTMLVideoElement, muted: boolean): void {
  video.muted = muted;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
}

function ProtectionHeroImage({ src }: { src: string }) {
  const [ready, setReady] = useState(false);

  return (
    <img
      className={`protect-shell__hero-image${ready ? ' protect-shell__hero-image--ready' : ''}`}
      src={src}
      alt=""
      decoding="async"
      onLoad={() => setReady(true)}
      onError={() => setReady(false)}
    />
  );
}

/** 保护态背景 — healthy 用视频，warn/block 用静态图 */
export default function ProtectionHeroVisual({ muted, tone }: ProtectionHeroVisualProps) {
  const videoARef = useRef<HTMLVideoElement>(null);
  const videoBRef = useRef<HTMLVideoElement>(null);
  const crossfadeLockRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const heroImage = TONE_HERO_IMAGE[tone];
  const useVideo = heroImage === undefined;

  const tryPlay = useCallback(
    (video: HTMLVideoElement) => {
      bindVideoElement(video, muted);
      void video.play().catch(() => undefined);
    },
    [muted],
  );

  useEffect(() => {
    if (!useVideo) {
      setReady(false);
      setFailed(false);
      return;
    }

    const videoA = videoARef.current;
    const videoB = videoBRef.current;
    if (!videoA || !videoB || failed) {
      return;
    }

    bindVideoElement(videoA, muted);
    bindVideoElement(videoB, muted);

    const swapLoop = (from: HTMLVideoElement, to: HTMLVideoElement): void => {
      if (crossfadeLockRef.current) {
        return;
      }

      const duration = from.duration;
      if (!Number.isFinite(duration) || duration <= 0) {
        return;
      }

      const remaining = duration - from.currentTime;
      if (remaining > LOOP_LEAD_SEC || remaining <= 0.02) {
        return;
      }

      crossfadeLockRef.current = true;
      to.currentTime = 0;
      bindVideoElement(to, muted);

      void to
        .play()
        .then(() => {
          from.classList.remove('protect-shell__video--front');
          to.classList.add('protect-shell__video--front');

          window.setTimeout(() => {
            from.pause();
            from.currentTime = 0;
            crossfadeLockRef.current = false;
          }, LOOP_CROSSFADE_MS);
        })
        .catch(() => {
          crossfadeLockRef.current = false;
        });
    };

    const onTimeUpdateA = (): void => {
      if (videoA.classList.contains('protect-shell__video--front')) {
        swapLoop(videoA, videoB);
      }
    };

    const onTimeUpdateB = (): void => {
      if (videoB.classList.contains('protect-shell__video--front')) {
        swapLoop(videoB, videoA);
      }
    };

    const onReady = (): void => {
      setReady(true);
      if (!videoA.classList.contains('protect-shell__video--front')) {
        videoA.classList.add('protect-shell__video--front');
      }
      tryPlay(videoA);
    };

    const onVisible = (): void => {
      if (document.visibilityState === 'hidden') {
        return;
      }
      const front = videoA.classList.contains('protect-shell__video--front') ? videoA : videoB;
      tryPlay(front);
    };

    videoA.addEventListener('loadeddata', onReady);
    videoA.addEventListener('canplay', onReady);
    videoA.addEventListener('timeupdate', onTimeUpdateA);
    videoB.addEventListener('timeupdate', onTimeUpdateB);
    document.addEventListener('visibilitychange', onVisible);

    tryPlay(videoA);

    return () => {
      videoA.removeEventListener('loadeddata', onReady);
      videoA.removeEventListener('canplay', onReady);
      videoA.removeEventListener('timeupdate', onTimeUpdateA);
      videoB.removeEventListener('timeupdate', onTimeUpdateB);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [failed, muted, tryPlay, useVideo]);

  const videoClass = (front: boolean): string => {
    const parts = ['protect-shell__video'];
    if (ready) {
      parts.push('protect-shell__video--ready');
    }
    if (front) {
      parts.push('protect-shell__video--front');
    }
    return parts.join(' ');
  };

  if (heroImage) {
    return (
      <>
        <ProtectionHeroImage src={heroImage} />
        <div className="protect-shell__video-fallback protect-shell__video-fallback--hidden" aria-hidden />
      </>
    );
  }

  return (
    <>
      {!failed && (
        <>
          <video
            ref={videoARef}
            className={videoClass(true)}
            src={VIDEO_ASSETS.protectionHero}
            autoPlay
            muted={muted}
            playsInline
            preload="auto"
            onError={() => setFailed(true)}
          />
          <video
            ref={videoBRef}
            className={videoClass(false)}
            src={VIDEO_ASSETS.protectionHero}
            muted={muted}
            playsInline
            preload="auto"
            onError={() => setFailed(true)}
          />
        </>
      )}
      <div
        className={`protect-shell__video-fallback${ready && !failed ? ' protect-shell__video-fallback--hidden' : ''}`}
        aria-hidden
      />
    </>
  );
}
