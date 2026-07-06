import { useCallback, useEffect, useRef, useState } from 'react';

import CinematicFallback from '@/components/CinematicFallback';
import { AUTH_NORWAY_PLAYLIST } from '@/data/videoAssets';
import { bindMobileVideoPlayback } from '@/lib/videoPlayback';
import { resolveVideoCandidates } from '@/lib/videoSources';

/** 登录页：挪威 4→5 依次播放，同一时刻仅一条视频 */
export default function AuthVideoBackdrop() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playlistIndex, setPlaylistIndex] = useState(0);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [failed, setFailed] = useState(false);

  const baseSrc = AUTH_NORWAY_PLAYLIST[playlistIndex] ?? AUTH_NORWAY_PLAYLIST[0];
  const candidates = resolveVideoCandidates(baseSrc);
  const activeSrc = candidates[candidateIndex] ?? baseSrc;

  const tryNextCandidate = useCallback(() => {
    setCandidateIndex((prev) => {
      if (prev + 1 < candidates.length) {
        return prev + 1;
      }
      // 当前片段全部候选失败 → 切下一条（如 auth-norway-5 无 web 版则跳回 4）
      setPlaylistIndex((p) => (p + 1) % AUTH_NORWAY_PLAYLIST.length);
      return 0;
    });
  }, [candidates.length]);

  useEffect(() => {
    setCandidateIndex(0);
    setFailed(false);
  }, [baseSrc]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || failed) {
      return;
    }

    el.playbackRate = 0.88;
    const unbind = bindMobileVideoPlayback(el);

    const onEnded = () => {
      setPlaylistIndex((prev) => (prev + 1) % AUTH_NORWAY_PLAYLIST.length);
    };

    el.addEventListener('ended', onEnded);
    return () => {
      unbind();
      el.removeEventListener('ended', onEnded);
    };
  }, [activeSrc, failed]);

  return (
    <div className="auth-bg pointer-events-none fixed inset-0 z-0 overflow-hidden bg-[#2a3544]" aria-hidden>
      <div className="auth-bg__video auth-bg__video--wide">
        {failed ? (
          <CinematicFallback variant="auth" className="auth-bg__cine-fallback" />
        ) : (
          <video
            ref={videoRef}
            key={activeSrc}
            className="auth-bg__clip absolute inset-0 h-full w-full object-cover"
            src={activeSrc}
            autoPlay
            muted
            playsInline
            preload="auto"
            onError={tryNextCandidate}
            style={{
              objectPosition: 'center center',
              filter: 'saturate(1.15) brightness(1.12) contrast(1.02)',
            }}
          />
        )}
      </div>
      <div className="auth-bg__veil" />
      <div className="auth-bg__vignette" />
      <div className="auth-bg__noise" />
    </div>
  );
}
