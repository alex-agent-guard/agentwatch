import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/supabase';

type Web3TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  msg?: string;
  error?: string;
  error_code?: string;
  code?: number;
};

/** OKX 等扩展会劫持 window.fetch，XHR 绕过以避免 Invalid value */
function postJsonWithXhr(url: string, headers: Record<string, string>, body: unknown): Promise<Web3TokenResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    for (const [key, value] of Object.entries(headers)) {
      xhr.setRequestHeader(key, value);
    }
    xhr.onload = () => {
      try {
        const parsed = JSON.parse(xhr.responseText) as Web3TokenResponse;
        resolve(parsed);
      } catch {
        reject(new Error(`Supabase 响应解析失败 (HTTP ${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error('网络请求失败，请检查网络或稍后重试'));
    xhr.send(JSON.stringify(body));
  });
}

function mapWeb3AuthError(payload: Web3TokenResponse, fallbackStatus?: number): string {
  const msg = payload.msg ?? payload.error ?? `Wallet 登录失败 (HTTP ${fallbackStatus ?? 'unknown'})`;
  if (/web3_provider_disabled|Web3 provider is disabled/i.test(msg)) {
    return 'Supabase 未启用 Web3 Wallet。请打开 Supabase → Authentication → Providers → Web3 → 启用 Ethereum，保存后重试。';
  }
  if (/invalid|signature|siwe|chain|validation/i.test(msg)) {
    return `Wallet 验签失败：${msg}`;
  }
  return msg;
}

/** 直接调用 Supabase /auth/v1/token?grant_type=web3，不经过 supabase-js fetch */
export async function exchangeWeb3Token(input: {
  message: string;
  signature: `0x${string}`;
}): Promise<{ accessToken: string; refreshToken: string } | { error: string }> {
  const endpoint = `${SUPABASE_URL.replace(/\/$/, '')}/auth/v1/token?grant_type=web3`;
  const headers = {
    'Content-Type': 'application/json',
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    'X-Client-Info': 'agentwatch-web3',
  };

  try {
    const payload = await postJsonWithXhr(endpoint, headers, {
      chain: 'ethereum',
      message: input.message,
      signature: input.signature,
    });

    if (payload.access_token && payload.refresh_token) {
      return {
        accessToken: payload.access_token,
        refreshToken: payload.refresh_token,
      };
    }

    return { error: mapWeb3AuthError(payload) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/Invalid value|fetch/i.test(msg)) {
      return {
        error:
          '钱包扩展干扰了网络请求。请换 Chrome + OKX Wallet 重试；仍失败可改用 MetaMask 或在 OKX App 内置浏览器打开。',
      };
    }
    return { error: msg };
  }
}
