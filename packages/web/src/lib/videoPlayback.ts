/** 绑定 muted inline 视频在移动端的播放恢复（autoplay 常被拦） */
export function bindMobileVideoPlayback(video: HTMLVideoElement): () => void {
  const tryPlay = () => {
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    void video.play().catch(() => {
      /* 等用户首次触摸 */
    });
  };

  tryPlay();

  const events = ['touchstart', 'touchend', 'click', 'scroll', 'visibilitychange'] as const;
  const onResume = () => {
    if (document.visibilityState === 'hidden') return;
    tryPlay();
  };

  for (const name of events) {
    document.addEventListener(name, onResume, { passive: true });
  }

  video.addEventListener('canplay', tryPlay);
  video.addEventListener('loadeddata', tryPlay);

  return () => {
    for (const name of events) {
      document.removeEventListener(name, onResume);
    }
    video.removeEventListener('canplay', tryPlay);
    video.removeEventListener('loadeddata', tryPlay);
  };
}
