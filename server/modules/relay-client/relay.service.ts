// server/modules/relay-client/relay.service.ts
//
// Glue between config persistence and the RelayAgent singleton. The browser
// never runs the agent itself — it POSTs the minted device token here and the
// server owns the outbound connection, persisting the enabled flag so remote
// access survives app restarts (autostartRelay() at boot).

import jwt from 'jsonwebtoken';

import { appConfigDb, getConnection, userDb } from '@/modules/database/index.js';

import { createRelayConfigRepository, type RelayConfigRepository } from './relay.db.js';
import { RelayAgent, type RelayAgentState, type RelayAgentStats } from './relay.client.js';

export const DEFAULT_RELAY_URL = 'wss://api.planrla.com/relay';

// Same derivation as middleware/auth.js (modules can't import unclassified
// paths) — keep the payload {userId, username} in sync with generateToken there.
const JWT_SECRET = process.env.JWT_SECRET || appConfigDb.getOrCreateJwtSecret();

export interface RelayStatus {
  enabled: boolean;
  configured: boolean;
  state: RelayAgentState;
  relayUrl: string;
  deviceName: string;
  /** Masked preview only — the browser already holds the full token from mint time. */
  deviceTokenMasked: string;
  stats: RelayAgentStats;
}

let agent: RelayAgent | null = null;
let repo: RelayConfigRepository | null = null;

function getRepo(): RelayConfigRepository {
  if (!repo) repo = createRelayConfigRepository(getConnection());
  return repo;
}

function localHttpBase(): string {
  const port = process.env.SERVER_PORT || 3001;
  return `http://127.0.0.1:${port}`;
}

/** Fresh local-server JWT for relayed traffic; re-minted per connect (7d expiry). */
function mintLocalToken(): string | null {
  const user = userDb.getFirstUser();
  if (!user) return null;
  return jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
}

function stopAgent(): void {
  if (agent) {
    agent.stop();
    agent = null;
  }
}

function startAgent(): void {
  const cfg = getRepo().getAll();
  if (!cfg.device_token) return;
  stopAgent();
  agent = new RelayAgent({
    relayUrl: cfg.relay_url ?? DEFAULT_RELAY_URL,
    deviceToken: cfg.device_token,
    localHttpBase: localHttpBase(),
    localWsBase: localHttpBase().replace(/^http/, 'ws'),
    getLocalToken: mintLocalToken,
    log: (level, message) => {
      if (level === 'error') console.error(`[relay] ${message}`);
      else if (level === 'warn') console.warn(`[relay] ${message}`);
      else console.log(`[relay] ${message}`);
    },
  });
  agent.start();
}

export function getRelayStatus(): RelayStatus {
  const cfg = getRepo().getAll();
  const token = cfg.device_token ?? '';
  return {
    enabled: cfg.enabled === '1',
    configured: Boolean(token),
    state: agent?.state ?? 'stopped',
    relayUrl: cfg.relay_url ?? DEFAULT_RELAY_URL,
    deviceName: cfg.device_name ?? '',
    deviceTokenMasked: token ? `…${token.slice(-6)}` : '',
    stats: agent?.currentStats ?? {
      connectedAt: null,
      reconnects: 0,
      httpRequests: 0,
      wsStreams: 0,
      lastError: null,
    },
  };
}

export function enableRelay(input: { deviceToken?: string; relayUrl?: string; deviceName?: string }): RelayStatus {
  const r = getRepo();
  // A fresh token from the browser wins; falling back to the stored one lets a
  // previously-disabled setup be re-enabled without re-minting a device.
  const deviceToken = (input.deviceToken ?? r.get('device_token') ?? '').trim();
  if (!deviceToken) {
    throw new Error('deviceToken required (none stored yet)');
  }
  if (!/^relay-[A-Za-z0-9]+$/.test(deviceToken)) {
    throw new Error('invalid device token (expected relay-…)');
  }
  stopAgent();
  r.set('device_token', deviceToken);
  r.set('relay_url', input.relayUrl?.trim() || DEFAULT_RELAY_URL);
  if (input.deviceName?.trim()) r.set('device_name', input.deviceName.trim());
  r.set('enabled', '1');
  startAgent();
  return getRelayStatus();
}

export function disableRelay(): RelayStatus {
  stopAgent();
  getRepo().set('enabled', '0');
  return getRelayStatus();
}

/** Server boot hook — start the agent when it was enabled before shutdown. */
export function autostartRelay(): void {
  const cfg = getRepo().getAll();
  if (cfg.enabled === '1' && cfg.device_token) startAgent();
}
