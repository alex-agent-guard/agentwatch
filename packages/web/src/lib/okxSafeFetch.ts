/**
 * OKX Wallet 会篡改带 JWT 的 fetch 请求头。
 * Supabase 请求改走 XHR，anon key 优先放 URL query。
 */

function resolveUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

function headersToRecord(headers?: HeadersInit): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) {
    return out;
  }
  const h = headers instanceof Headers ? headers : new Headers(headers);
  h.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function xhrRequest(url: string, init: RequestInit = {}): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(init.method ?? 'GET', url, true);
    xhr.responseType = 'text';

    const headers = headersToRecord(init.headers);
    for (const [key, value] of Object.entries(headers)) {
      try {
        xhr.setRequestHeader(key, value);
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
    }

    xhr.onload = () => {
      resolve(
        new Response(xhr.responseText, {
          status: xhr.status,
          statusText: xhr.statusText,
          headers: { 'Content-Type': xhr.getResponseHeader('Content-Type') ?? 'application/json' },
        }),
      );
    };
    xhr.onerror = () => reject(new TypeError('Network request failed'));
    xhr.send(typeof init.body === 'string' ? init.body : undefined);
  });
}

function withApiKeyInQuery(url: string, headers: Record<string, string>): { url: string; headers: Record<string, string> } {
  if (!url.includes('supabase.co') || url.includes('apikey=')) {
    return { url, headers };
  }

  const apikey =
    headers.apikey ??
    headers.Apikey ??
    (headers.Authorization?.startsWith('Bearer ') ? headers.Authorization.slice(7) : undefined);

  if (!apikey) {
    return { url, headers };
  }

  const next = { ...headers };
  delete next.apikey;
  delete next.Apikey;
  if (next.Authorization?.startsWith('Bearer ') && next.Authorization.slice(7) === apikey) {
    delete next.Authorization;
  }

  const sep = url.includes('?') ? '&' : '?';
  return {
    url: `${url}${sep}apikey=${encodeURIComponent(apikey)}`,
    headers: next,
  };
}

/** 供 Supabase createClient({ global: { fetch } }) 使用 */
export function okxSafeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const rawUrl = resolveUrl(input);
  const headers = headersToRecord(init?.headers);
  const { url, headers: safeHeaders } = withApiKeyInQuery(rawUrl, headers);

  return xhrRequest(url, {
    ...init,
    headers: safeHeaders,
  });
}
