/**
 * 展示层：仅对后端上报的 service_name 做精确匹配，禁止按 tool 名猜测
 * 未知或未上报时原样/占位显示，不虚构 OKX 等标签
 */
export interface ServiceDisplay {
  /** 列表/图表展示用 */
  label: string;
  /** 仅 catalog 精确命中时提供 */
  url?: string;
  /** 是否有后端 service_name（非 tools/call 占位） */
  hasBackendSource: boolean;
}

/** 精确 service_name → 展示名/官网（key 必须与 CLI resolveMcpServiceName 输出一致） */
const SERVICE_CATALOG: Record<string, { label: string; url?: string; color: string }> = {
  '@okx_ai/okx-trade-mcp': {
    label: 'OKX Trade MCP',
    url: 'https://okx.ai',
    color: '#000000',
  },
  '@okxguild/mcp-server-okx': {
    label: 'OKX MCP',
    url: 'https://okx.ai',
    color: '#000000',
  },
  '@hyperliquid/mcp-server-hyperliquid': {
    label: 'Hyperliquid MCP',
    url: 'https://hyperliquid.xyz/',
    color: '#50fa9f',
  },
  '@modelcontextprotocol/server-everything': {
    label: 'MCP Everything',
    url: 'https://modelcontextprotocol.io/',
    color: '#a78bfa',
  },
};

const FALLBACK_COLOR = '#6b7280';

const PLACEHOLDER_SERVICE_NAMES = new Set(['tools/call', 'unknown-mcp-server', '']);

export function isReportedServiceName(serviceName: string | null | undefined): boolean {
  const normalized = (serviceName ?? '').trim();
  return normalized.length > 0 && !PLACEHOLDER_SERVICE_NAMES.has(normalized);
}

export function displayService(serviceName: string | null | undefined): ServiceDisplay & { color: string } {
  const normalized = (serviceName ?? '').trim();

  if (!isReportedServiceName(normalized)) {
    return {
      label: '服务待上报',
      hasBackendSource: false,
      color: FALLBACK_COLOR,
    };
  }

  const catalog = SERVICE_CATALOG[normalized];
  if (catalog) {
    return {
      label: catalog.label,
      url: catalog.url,
      hasBackendSource: true,
      color: catalog.color,
    };
  }

  return {
    label: normalized,
    hasBackendSource: true,
    color: FALLBACK_COLOR,
  };
}

export function serviceColor(serviceName: string): string {
  const normalized = serviceName.trim();
  return SERVICE_CATALOG[normalized]?.color ?? FALLBACK_COLOR;
}
