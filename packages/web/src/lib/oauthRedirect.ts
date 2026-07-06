/** OAuth 回调 URL — 必须与 Supabase Auth → Redirect URLs 完全一致（无 hash） */
export function getOAuthRedirectUrl(): string {
  if (typeof window === 'undefined') {
    return '/';
  }
  const origin = window.location.origin.replace(/\/$/, '');
  // HashRouter 下 pathname 通常为 /；统一成 origin/ 避免尾斜杠不一致
  return `${origin}/`;
}

/** 微信 / QQ 等内置浏览器无法完成 GitHub OAuth */
export function isRestrictedInAppBrowser(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }
  const ua = navigator.userAgent;
  return /MicroMessenger|QQ\/|MQQBrowser|Weibo|Douban|Bytedance|Toutiao|AlipayClient|MiniProgram/i.test(
    ua,
  );
}

export function inAppBrowserHint(): string {
  return '当前在微信/QQ 等内置浏览器中，GitHub 登录无法完成。请点击右上角「在浏览器中打开」或复制链接到 Safari / Chrome 再试。';
}
