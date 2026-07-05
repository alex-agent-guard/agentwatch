/** 是否触屏手机/平板（含 iPad） */
export function isTouchMobile(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(max-width: 768px), (hover: none) and (pointer: coarse)').matches
  );
}

/** iOS Safari（含 WebKit 视频渲染限制） */
export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** Android 浏览器通常不支持 .mov */
export function prefersMp4Only(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android/i.test(navigator.userAgent);
}
