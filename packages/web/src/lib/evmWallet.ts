/** EIP-1193 最小接口 */
export interface EvmWalletProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

type WindowWithWallets = Window & {
  ethereum?: EvmWalletProvider & {
    providers?: Array<EvmWalletProvider & { isMetaMask?: boolean; isOkxWallet?: boolean; isOKExWallet?: boolean }>;
    isMetaMask?: boolean;
    isOkxWallet?: boolean;
    isOKExWallet?: boolean;
  };
  okxwallet?: EvmWalletProvider;
};

function hasRequest(obj: unknown): obj is EvmWalletProvider {
  return typeof obj === 'object' && obj !== null && 'request' in obj && typeof (obj as EvmWalletProvider).request === 'function';
}

/** 优先 OKX 独立 provider，避免多钱包抢占 window.ethereum 导致签名失败 */
export function resolveEvmWallet(): EvmWalletProvider | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const w = window as WindowWithWallets;

  if (hasRequest(w.okxwallet)) {
    return w.okxwallet;
  }

  const eth = w.ethereum;
  if (!eth || !hasRequest(eth)) {
    return null;
  }

  if (Array.isArray(eth.providers) && eth.providers.length > 0) {
    const okx = eth.providers.find((p) => p.isOkxWallet || p.isOKExWallet);
    if (okx && hasRequest(okx)) {
      return okx;
    }
    const mm = eth.providers.find((p) => p.isMetaMask);
    if (mm && hasRequest(mm)) {
      return mm;
    }
    return eth.providers[0] ?? null;
  }

  return eth;
}

function normalizeAddress(address: string): string {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new Error(`无效钱包地址: ${address}`);
  }
  return address.toLowerCase();
}

/** EIP-4361 / SIWE 消息（与 Supabase auth-js 格式对齐） */
export function buildSiweMessage(input: {
  domain: string;
  address: string;
  statement: string;
  uri: string;
  chainId: number;
  nonce?: string;
  issuedAt?: Date;
}): string {
  const address = normalizeAddress(input.address);
  const issuedAt = (input.issuedAt ?? new Date()).toISOString();
  const nonceLine = input.nonce ? `\nNonce: ${input.nonce}` : '';
  return `${input.domain} wants you to sign in with your Ethereum account:
${address}

${input.statement}

URI: ${input.uri}
Version: 1
Chain ID: ${input.chainId}${nonceLine}
Issued At: ${issuedAt}`;
}

export async function requestAccounts(wallet: EvmWalletProvider): Promise<string> {
  const accounts = (await wallet.request({ method: 'eth_requestAccounts' })) as string[] | undefined;
  if (!accounts?.length) {
    throw new Error('钱包未返回账户，请先在扩展里解锁并授权本站');
  }
  return normalizeAddress(accounts[0]);
}

export async function readChainId(wallet: EvmWalletProvider): Promise<number> {
  const hex = (await wallet.request({ method: 'eth_chainId' })) as string;
  const chainId = Number.parseInt(hex, 16);
  if (!Number.isFinite(chainId)) {
    throw new Error(`无法读取 chainId: ${hex}`);
  }
  return chainId;
}

function utf8ToHex(value: string): string {
  const bytes = new TextEncoder().encode(value);
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function readSignatureValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['signature', 'sig', 'result', 'data'] as const) {
      if (typeof record[key] === 'string') {
        return record[key] as string;
      }
    }
  }
  throw new Error('钱包返回的签名格式无效，请重试或换 MetaMask');
}

/** 统一为 Supabase 要求的 0x + hex 签名 */
export function normalizeSignature(value: unknown): `0x${string}` {
  const raw = readSignatureValue(value).trim();
  const hex = raw.startsWith('0x') ? raw.slice(2) : raw;
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length < 128) {
    throw new Error('钱包签名长度异常，请重试');
  }
  return `0x${hex}` as `0x${string}`;
}

/** OKX 用明文 message；MetaMask 有时需要 hex — 两种都试 */
export async function personalSign(wallet: EvmWalletProvider, message: string, address: string): Promise<`0x${string}`> {
  try {
    const sig = await wallet.request({
      method: 'personal_sign',
      params: [message, address],
    });
    return normalizeSignature(sig);
  } catch {
    const sig = await wallet.request({
      method: 'personal_sign',
      params: [utf8ToHex(message), address],
    });
    return normalizeSignature(sig);
  }
}
