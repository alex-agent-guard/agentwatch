/** 已知 MCP 客户端 / 服务 — 品牌图标映射 */
export type BrandIconId = 'okx' | 'claude-code' | 'codex' | 'cursor' | 'hermes' | 'hyperliquid';

/** 官方 PNG 素材（圆角由 CSS 统一裁切） */
export const BRAND_IMAGE_ASSETS: Partial<Record<BrandIconId, string>> = {
  'claude-code': '/assets/images/brands/claude-code.png',
  cursor: '/assets/images/brands/cursor.png',
  codex: '/assets/images/brands/codex.png',
  hermes: '/assets/images/brands/hermes.png',
  hyperliquid: '/assets/images/brands/hyperliquid.png',
};

const CLIENT_ICON: Record<string, BrandIconId> = {
  'claude-code': 'claude-code',
  'claude-ai': 'claude-code',
  codex: 'codex',
  'openai-codex': 'codex',
  cursor: 'cursor',
  hermes: 'hermes',
};

const SERVICE_ICON: Record<string, BrandIconId> = {
  '@okx_ai/okx-trade-mcp': 'okx',
  '@okxguild/mcp-server-okx': 'okx',
  '@hyperliquid/mcp-server-hyperliquid': 'hyperliquid',
};

export function clientBrandIcon(clientName: string | null | undefined): BrandIconId | null {
  const key = (clientName ?? '').trim().toLowerCase();
  return CLIENT_ICON[key] ?? null;
}

export function serviceBrandIcon(serviceName: string | null | undefined): BrandIconId | null {
  const key = (serviceName ?? '').trim();
  return SERVICE_ICON[key] ?? null;
}

export function brandIconLabel(id: BrandIconId): string {
  switch (id) {
    case 'okx':
      return 'OKX';
    case 'claude-code':
      return 'Claude Code';
    case 'codex':
      return 'Codex';
    case 'cursor':
      return 'Cursor';
    case 'hermes':
      return 'Hermes';
    case 'hyperliquid':
      return 'Hyperliquid';
  }
}
