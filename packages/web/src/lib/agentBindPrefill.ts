/** 安装脚本写入、Settings 读取 — 登录跳转不丢 Agent 凭证 */
const BIND_PREFILL_KEY = 'agentwatch_bind_prefill';
const AUTO_BIND_KEY = 'agentwatch_auto_bind';

export interface AgentBindPrefill {
  agentId: string;
  uploadSecret: string;
}

export function parseBindPrefillFromSearch(search: string): AgentBindPrefill | null {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const agentId = (params.get('agentId') ?? params.get('install_id') ?? '').trim();
  const uploadSecret = (params.get('uploadSecret') ?? params.get('upload_secret') ?? '').trim();
  if (!agentId && !uploadSecret) {
    return null;
  }
  return { agentId, uploadSecret };
}

export function storeAgentBindPrefill(prefill: AgentBindPrefill): void {
  try {
    sessionStorage.setItem(BIND_PREFILL_KEY, JSON.stringify(prefill));
  } catch {
    /* ignore */
  }
}

/** 安装脚本跳转 — 登录后自动绑定，无需手点「接入」 */
export function markAutoBindAfterLogin(): void {
  try {
    sessionStorage.setItem(AUTO_BIND_KEY, '1');
  } catch {
    /* ignore */
  }
}

export function consumeAutoBindAfterLogin(): boolean {
  try {
    const should = sessionStorage.getItem(AUTO_BIND_KEY) === '1';
    sessionStorage.removeItem(AUTO_BIND_KEY);
    return should;
  } catch {
    return false;
  }
}

/** 读取并清除 — 避免密钥长期留在 sessionStorage */
export function consumeAgentBindPrefill(): AgentBindPrefill | null {
  try {
    const raw = sessionStorage.getItem(BIND_PREFILL_KEY);
    sessionStorage.removeItem(BIND_PREFILL_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<AgentBindPrefill>;
    const agentId = (parsed.agentId ?? '').trim();
    const uploadSecret = (parsed.uploadSecret ?? '').trim();
    if (!agentId && !uploadSecret) {
      return null;
    }
    return { agentId, uploadSecret };
  } catch {
    return null;
  }
}

export function persistBindPrefillFromSearch(search: string): void {
  const prefill = parseBindPrefillFromSearch(search);
  if (prefill !== null) {
    storeAgentBindPrefill(prefill);
    if (prefill.agentId && prefill.uploadSecret) {
      markAutoBindAfterLogin();
    }
  }
}
