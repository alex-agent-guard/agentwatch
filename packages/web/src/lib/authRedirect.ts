export const AUTH_REDIRECT_KEY = 'agentwatch_auth_redirect';

export type AuthRedirectPath = '/home' | '/dashboard' | '/reports' | '/settings';

const ALLOWED: AuthRedirectPath[] = ['/home', '/dashboard', '/reports', '/settings'];

export function isAuthRedirectPath(path: string): path is AuthRedirectPath {
  return ALLOWED.includes(path as AuthRedirectPath);
}

/** 记录登录成功后应回到的页面（GitHub 整页 OAuth 会丢失 react-router state） */
export function storeAuthRedirect(path: string): void {
  if (isAuthRedirectPath(path)) {
    sessionStorage.setItem(AUTH_REDIRECT_KEY, path);
  }
}

export function peekAuthRedirect(): AuthRedirectPath | null {
  const raw = sessionStorage.getItem(AUTH_REDIRECT_KEY);
  return raw && isAuthRedirectPath(raw) ? raw : null;
}

export function clearAuthRedirect(): void {
  sessionStorage.removeItem(AUTH_REDIRECT_KEY);
}
