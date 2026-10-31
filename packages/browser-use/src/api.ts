/**
 * @planrla/browser-use API 层 — 独立包内自带的认证请求工具。
 *
 * 与 @planrla/chat 相同的注入模式:宿主通过 configureBrowserUseApi 改写
 * baseUrl;未配置时与宿主同源(开发态走 Vite 代理)。
 */

let API_BASE = '';

export function configureBrowserUseApi(cfg: { baseUrl?: string } = {}) {
  API_BASE = (cfg.baseUrl || '').replace(/\/+$/, '');
}

function withBase(url: string) {
  return API_BASE && url.startsWith('/') ? API_BASE + url : url;
}

function readToken(): string | null {
  try {
    return localStorage.getItem('auth-token');
  } catch {
    return null;
  }
}

function storeRefreshedToken(response: Response) {
  const refreshed = response.headers.get('X-Refreshed-Token');
  if (refreshed) {
    try {
      localStorage.setItem('auth-token', refreshed);
    } catch {
      /* ignore */
    }
  }
}

export const authenticatedFetch = (url: string, options: RequestInit = {}): Promise<Response> => {
  const token = readToken();
  const headers: Record<string, string> = { ...(options.headers as Record<string, string>) };
  if (!(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(withBase(url), { ...options, headers }).then((response) => {
    storeRefreshedToken(response);
    return response;
  });
};
