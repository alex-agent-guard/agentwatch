import type { ProxyServerConfig } from '@packages/shared/types';

/**
 * 从 Proxy 启动配置解析 MCP 服务标识 — 写入 CloudEventPayload.toolCall.serviceName
 * 优先取 npm 包名（如 @okx_ai/okx-trade-mcp），否则回退 command / 脚本名
 */
export function resolveMcpServiceName(server: ProxyServerConfig): string {
  const args = server.args ?? [];

  for (const token of args) {
    if (token.startsWith('-')) continue;
    if (token.startsWith('@')) return token;
    if (/^[a-z0-9][\w.-]*$/i.test(token) && !token.endsWith('.js') && !token.endsWith('.mjs')) {
      return token;
    }
  }

  const scriptArg = args.find((t) => t.endsWith('.js') || t.endsWith('.mjs'));
  if (scriptArg !== undefined) {
    const base = scriptArg.split(/[/\\]/).pop() ?? scriptArg;
    return base.replace(/\.(m)?js$/, '');
  }

  const command = server.command.trim();
  if (command.length > 0 && command !== 'npx' && command !== 'node') {
    return command;
  }

  return 'unknown-mcp-server';
}
