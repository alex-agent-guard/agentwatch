/** 退出登录时清理安装脚本 / 自动绑定残留 */
export function clearInstallBindSessionFlags(): void {
  const keys = ['agentwatch_bind_prefill', 'agentwatch_auto_bind', 'agentwatch_auth_error'];
  for (const key of keys) {
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}
