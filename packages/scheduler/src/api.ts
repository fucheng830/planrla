/**
 * @planrla/scheduler API 层 — 独立包内自带的认证请求工具。
 *
 * 与 @planrla/chat 相同的注入模式:宿主应用通过 configureSchedulerApi
 * 改写 baseUrl;未配置时与宿主同源(开发态走 Vite 代理)。
 */

let API_BASE = '';

export function configureSchedulerApi(cfg: { baseUrl?: string } = {}) {
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

export const schedulerApi = {
  get: (endpoint: string) => authenticatedFetch(`/api${endpoint}`),
  post: (endpoint: string, body?: unknown) =>
    authenticatedFetch(`/api${endpoint}`, {
      method: 'POST',
      body: body instanceof FormData ? body : JSON.stringify(body ?? {}),
    }),
  put: (endpoint: string, body?: unknown) =>
    authenticatedFetch(`/api${endpoint}`, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
  patch: (endpoint: string, body?: unknown) =>
    authenticatedFetch(`/api${endpoint}`, { method: 'PATCH', body: JSON.stringify(body ?? {}) }),
  delete: (endpoint: string) => authenticatedFetch(`/api${endpoint}`, { method: 'DELETE' }),
};
