/**
 * MCP 客户端展示 — 仅对后端 client_name 精确匹配，禁止猜测
 */
export interface ClientDisplay {
  label: string;
  short: string;
  color: string;
  /** 仅 catalog 精确命中时提供 */
  url?: string;
  hasBackendSource: boolean;
}

const CLIENT_CATALOG: Record<string, { label: string; short: string; color: string; url?: string }> = {
  'claude-code': {
    label: 'Claude Code',
    short: 'CC',
    color: '#d97757',
    url: 'https://claude.ai/product/claude-code',
  },
  'claude-ai': {
    label: 'Claude',
    short: 'Cl',
    color: '#d97757',
    url: 'https://claude.ai/',
  },
  cursor: {
    label: 'Cursor',
    short: 'Cu',
    color: '#7c6bf0',
    url: 'https://cursor.com',
  },
  codex: {
    label: 'Codex',
    short: 'Cx',
    color: '#10a37f',
    url: 'https://openai.com/codex/',
  },
  'openai-codex': {
    label: 'Codex',
    short: 'Cx',
    color: '#10a37f',
    url: 'https://openai.com/codex/',
  },
  windsurf: { label: 'Windsurf', short: 'Ws', color: '#38bdf8', url: 'https://windsurf.com' },
  cline: { label: 'Cline', short: 'Ci', color: '#f59e0b', url: 'https://cline.bot' },
  continue: { label: 'Continue', short: 'Co', color: '#6366f1', url: 'https://continue.dev' },
  hermes: {
    label: 'Hermes',
    short: 'He',
    color: '#22d3ee',
    url: 'https://hermes-agent.nousresearch.com',
  },
  'open-claw': { label: 'Open Claw', short: 'OC', color: '#f472b6' },
  openclaw: { label: 'Open Claw', short: 'OC', color: '#f472b6' },
};

const FALLBACK_COLOR = '#6b7280';

export function isReportedClientName(clientName: string | null | undefined): boolean {
  return (clientName ?? '').trim().length > 0;
}

export function displayClient(clientName: string | null | undefined): ClientDisplay {
  const normalized = (clientName ?? '').trim();

  if (!isReportedClientName(normalized)) {
    return {
      label: '客户端待上报',
      short: '·',
      color: FALLBACK_COLOR,
      hasBackendSource: false,
    };
  }

  const catalog = CLIENT_CATALOG[normalized.toLowerCase()];
  if (catalog) {
    return { ...catalog, hasBackendSource: true };
  }

  const short =
    normalized.length <= 2
      ? normalized.toUpperCase()
      : normalized.slice(0, 2).toUpperCase();

  return {
    label: normalized,
    short,
    color: FALLBACK_COLOR,
    hasBackendSource: true,
  };
}
