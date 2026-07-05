import { useEffect, useRef, useState } from 'react';
import { AUTH_NORWAY_PLAYLIST } from '@/data/videoAssets';
import { bindMobileVideoPlayback } from '@/lib/videoPlayback';

/** 登录页：挪威 4→5 依次播放，同一时刻仅一条视频 */
export default function AuthVideoBackdrop() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [index, setIndex] = useState(0);
  const src = AUTH_NORWAY_PLAYLIST[index];

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    el.playbackRate = 0.88;
    const unbind = bindMobileVideoPlayback(el);

    const onEnded = () => {
      setIndex((prev) => (prev + 1) % AUTH_NORWAY_PLAYLIST.length);
    };

    el.addEventListener('ended', onEnded);
    return () => {
      unbind();
      el.removeEventListener('ended', onEnded);
    };
  }, [src]);

  return (
    <div className="auth-bg pointer-events-none fixed inset-0 z-0 overflow-hidden bg-[#2a3544]" aria-hidden>
      <div className="auth-bg__video auth-bg__video--wide">
        <video
          ref={videoRef}
          key={src}
          className="auth-bg__clip absolute inset-0 h-full w-full object-cover"
          src={src}
          autoPlay
          muted
          playsInline
          preload="auto"
          style={{
            objectPosition: 'center center',
            filter: 'saturate(1.15) brightness(1.12) contrast(1.02)',
          }}
        />
      </div>
      <div className="auth-bg__veil" />
      <div className="auth-bg__vignette" />
      <div className="auth-bg__noise" />
    </div>
  );
}
