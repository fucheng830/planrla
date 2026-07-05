// Planrla cloud-account client (api.planrla.com). Completely separate from the local
// app's utils/api.js — different origin (absolute URL), different token (cloud JWT stored
// in safeStorage), never mixed with the local server's auth-token. Used for the commercial
// "remote access" feature; M3 (login/account) + M4 (device tokens for relay).

const CLOUD_API_BASE = 'https://api.planrla.com';

export interface CloudUser {
  id: string;
  email: string;
  plan: string;
}

interface CloudAuthResponse {
  token: string;
  user: CloudUser;
}

export interface CloudDevice {
  id: string;
  token: string;
  name: string;
}

async function cloudRequest<T>(path: string, options: RequestInit & { token?: string } = {}): Promise<T> {
  const { token, headers, ...rest } = options;
  const res = await fetch(`${CLOUD_API_BASE}${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (body as { error?: string })?.error || `request failed (${res.status})`;
    throw new Error(msg);
  }
  return body as T;
}

export async function cloudLogin(email: string, password: string): Promise<CloudAuthResponse> {
  return cloudRequest<CloudAuthResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function cloudSignup(email: string, password: string): Promise<CloudAuthResponse> {
  return cloudRequest<CloudAuthResponse>('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function cloudMe(token: string): Promise<CloudUser> {
  const body = await cloudRequest<{ user: CloudUser }>('/api/auth/me', { method: 'GET', token });
  return body.user;
}

// M4 (remote access): mint a device token this desktop's relay agent will use to register
// with api.planrla.com, and list existing devices.
export async function cloudRegisterDevice(token: string, name: string): Promise<CloudDevice> {
  return cloudRequest<CloudDevice>('/api/devices', {
    method: 'POST',
    token,
    body: JSON.stringify({ name }),
  });
}

export async function cloudListDevices(token: string): Promise<CloudDevice[]> {
  const body = await cloudRequest<{ devices: CloudDevice[] }>('/api/devices', { method: 'GET', token });
  return body.devices ?? [];
}
