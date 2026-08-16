// server/modules/relay-client/relay.client.ts
//
// Home relay agent — the TS port of planrla-cloud's Python prototype
// (agent/relay_agent.py). Maintains one outbound WebSocket to the cloud relay
// (RelayDO) and bridges its mux messages to the local Planrla server:
//
//   cloud → home:  http_req / ws_open / ws_data / ws_close / ping
//   home → cloud:  http_res / ws_data / ws_close / pong
//
// All traffic is outbound from this machine — no public IP, port forwarding,
// or VPN needed. Reconnects with exponential backoff; protocol-level pings
// every 20s keep Cloudflare from reaping an idle connection.
//
// Deliberately framework-free (no Express/DB imports) so tests can drive it
// against a fake cloud relay + throwaway local servers.

import { WebSocket } from 'ws';

export type RelayAgentState = 'stopped' | 'connecting' | 'online' | 'reconnecting';

export interface RelayAgentStats {
  connectedAt: number | null;
  reconnects: number;
  httpRequests: number;
  wsStreams: number;
  lastError: string | null;
}

export interface RelayAgentOptions {
  /** Cloud relay endpoint, e.g. wss://api.planrla.com/relay — the device token is appended as ?token=. */
  relayUrl: string;
  deviceToken: string;
  /** Local server HTTP base that relayed requests are forwarded to. */
  localHttpBase: string;
  /** Local server WS base that bridged streams connect to. */
  localWsBase: string;
  /** Fresh local-server JWT; called before each connect / ws_open (tokens expire in 7d). */
  getLocalToken: () => string | null;
  /** Reconnect backoff base; overridable so tests can reconnect in milliseconds. */
  backoffBaseMs?: number;
  log?: (level: 'info' | 'warn' | 'error', message: string) => void;
}

type MuxMsg = Record<string, any>;

const RECONNECT_BASE_MS = 3_000;
const RECONNECT_MAX_MS = 30_000;
const PING_INTERVAL_MS = 20_000;
/** Cloudflare DO memory is 128MB — refuse absurd bodies instead of OOM-ing the relay. */
const MAX_BODY_BYTES = 32 * 1024 * 1024;

const utf8Strict = new TextDecoder('utf-8', { fatal: true });

/** Drops the relay `token=…` query param so it never reaches the local server. */
function stripRelayToken(path: string): string {
  const q = path.indexOf('?');
  if (q === -1) return path;
  const params = new URLSearchParams(path.slice(q + 1));
  params.delete('token');
  const qs = params.toString();
  return qs ? `${path.slice(0, q)}?${qs}` : path.slice(0, q);
}

function appendQueryParam(path: string, key: string, value: string): string {
  return path.includes('?')
    ? `${path}&${key}=${encodeURIComponent(value)}`
    : `${path}?${key}=${encodeURIComponent(value)}`;
}

export class RelayAgent {
  private readonly opts: RelayAgentOptions;
  private ws: WebSocket | null = null;
  private streams = new Map<string, WebSocket>();
  /** streamId → frames that arrived while the local socket was still CONNECTING. */
  private pending = new Map<string, Array<{ data: Buffer; binary: boolean }>>();
  private pingTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private attempt = 0;
  private stopped = true;
  private _state: RelayAgentState = 'stopped';
  private stats: RelayAgentStats = {
    connectedAt: null,
    reconnects: 0,
    httpRequests: 0,
    wsStreams: 0,
    lastError: null,
  };

  /** Optional observer; called on every state transition. */
  onStateChange: ((state: RelayAgentState) => void) | null = null;

  constructor(options: RelayAgentOptions) {
    this.opts = options;
  }

  get state(): RelayAgentState {
    return this._state;
  }

  get currentStats(): RelayAgentStats {
    return { ...this.stats, wsStreams: this.streams.size };
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.attempt = 0;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    this.closeStreams();
    if (this.ws) {
      try { this.ws.close(1000, 'agent stopped'); } catch { /* already gone */ }
      this.ws = null;
    }
    this.setState('stopped');
  }

  private setState(state: RelayAgentState): void {
    if (this._state === state) return;
    this._state = state;
    this.onStateChange?.(state);
  }

  private log(level: 'info' | 'warn' | 'error', message: string): void {
    this.opts.log?.(level, message);
  }

  private clearTimers(): void {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
  }

  private closeStreams(): void {
    for (const local of this.streams.values()) {
      try { local.close(); } catch { /* already gone */ }
    }
    this.streams.clear();
  }

  private connect(): void {
    if (this.stopped) return;
    this.setState(this.attempt === 0 ? 'connecting' : 'reconnecting');
    const url = appendQueryParam(this.opts.relayUrl, 'token', this.opts.deviceToken);
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.on('open', () => {
      if (this.ws !== ws) return;
      this.attempt = 0;
      this.stats.connectedAt = Date.now();
      this.setState('online');
      this.log('info', `relay connected: ${this.opts.relayUrl}`);
      this.pingTimer = setInterval(() => {
        try { ws.ping(); } catch { /* closed between ticks */ }
      }, PING_INTERVAL_MS);
    });

    ws.on('message', (data, isBinary) => {
      if (this.ws !== ws || isBinary) return;
      let msg: MuxMsg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      void this.dispatch(msg).catch((e) => this.log('error', `dispatch failed: ${e}`));
    });

    const onDown = (err?: Error) => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
      // Local streams cannot survive a home reconnect — RelayDO drops them when
      // the old socket closes, so tear ours down instead of leaking sockets.
      this.closeStreams();
      if (this.stopped) return;
      this.stats.reconnects += 1;
      this.stats.lastError = err ? err.message : 'connection lost';
      this.log('warn', `relay disconnected (${this.stats.lastError}); reconnecting`);
      const base = this.opts.backoffBaseMs ?? RECONNECT_BASE_MS;
      const delay = Math.min(RECONNECT_MAX_MS, base * 2 ** this.attempt);
      this.attempt += 1;
      this.setState('reconnecting');
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    };
    ws.on('close', () => onDown());
    ws.on('error', (err) => onDown(err));
  }

  private send(msg: MuxMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try { this.ws.send(JSON.stringify(msg)); } catch { /* cloud socket died mid-send */ }
    }
  }

  private async dispatch(msg: MuxMsg): Promise<void> {
    switch (msg.kind) {
      case 'http_req':
        await this.handleHttpReq(msg);
        break;
      case 'ws_open':
        this.handleWsOpen(msg);
        break;
      case 'ws_data': {
        const local = this.streams.get(msg.streamId);
        if (local) {
          this.streamSend(String(msg.streamId), local, msg.binary ? Buffer.from(msg.data, 'base64') : Buffer.from(String(msg.data), 'utf8'), Boolean(msg.binary));
        }
        break;
      }
      case 'ws_close': {
        const local = this.streams.get(msg.streamId);
        this.streams.delete(msg.streamId);
        this.pending.delete(String(msg.streamId));
        if (local) {
          try { local.close(msg.code ?? 1000); } catch { /* already gone */ }
        }
        break;
      }
      case 'ping':
        this.send({ kind: 'pong' });
        break;
      default:
        break;
    }
  }

  private async handleHttpReq(msg: MuxMsg): Promise<void> {
    const streamId = String(msg.streamId);
    const path = stripRelayToken(String(msg.path ?? '/'));
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(msg.headers ?? {})) {
      const lk = k.toLowerCase();
      if (lk === 'host' || lk === 'content-length' || lk === 'authorization' || lk === 'x-relay-token') continue;
      headers[k] = String(v);
    }
    const localToken = this.opts.getLocalToken();
    if (localToken) headers.Authorization = `Bearer ${localToken}`;

    try {
      const res = await fetch(`${this.opts.localHttpBase}${path}`, {
        method: msg.method ?? 'GET',
        headers,
        body: msg.body !== undefined ? String(msg.body) : undefined,
      });
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength > MAX_BODY_BYTES) {
        this.send({ kind: 'http_res', streamId, status: 502, headers: {}, body: 'agent error: response too large for relay' });
        return;
      }
      const resHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        const lk = k.toLowerCase();
        if (lk === 'content-encoding' || lk === 'transfer-encoding' || lk === 'content-length' || lk === 'connection') return;
        resHeaders[k] = v;
      });
      let body: string;
      try {
        body = utf8Strict.decode(buf);
      } catch {
        body = buf.toString('base64');
        resHeaders['X-Relay-Binary'] = '1';
      }
      this.stats.httpRequests += 1;
      this.send({ kind: 'http_res', streamId, status: res.status, headers: resHeaders, body });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.send({ kind: 'http_res', streamId, status: 502, headers: {}, body: `agent error: ${message}` });
    }
  }

  /** Sends a frame to a local stream, queueing it if the socket is still connecting. */
  private streamSend(streamId: string, local: WebSocket, data: Buffer, binary: boolean): void {
    if (local.readyState === WebSocket.OPEN) {
      try {
        local.send(binary ? data : data.toString('utf8'));
      } catch { /* local socket died mid-send */ }
    } else if (local.readyState === WebSocket.CONNECTING) {
      let queue = this.pending.get(streamId);
      if (!queue) {
        queue = [];
        this.pending.set(streamId, queue);
      }
      queue.push({ data, binary });
    }
  }

  private handleWsOpen(msg: MuxMsg): void {
    const streamId = String(msg.streamId);
    const path = stripRelayToken(String(msg.path ?? '/'));
    const token = this.opts.getLocalToken();
    const url = token
      ? appendQueryParam(this.opts.localWsBase + path, 'token', token)
      : this.opts.localWsBase + path;
    const local = new WebSocket(url);
    this.streams.set(streamId, local);
    this.stats.wsStreams += 1;

    local.on('open', () => {
      // The cloud may already have sent frames while we were connecting.
      const queue = this.pending.get(streamId);
      if (queue) {
        this.pending.delete(streamId);
        for (const frame of queue) this.streamSend(streamId, local, frame.data, frame.binary);
      }
    });
    local.on('message', (data, isBinary) => {
      const buf = Buffer.from(data as ArrayBuffer);
      if (isBinary) {
        this.send({ kind: 'ws_data', streamId, data: buf.toString('base64'), binary: true });
      } else {
        this.send({ kind: 'ws_data', streamId, data: buf.toString('utf8') });
      }
    });
    // Notify the cloud exactly once per stream, and only while we still own it
    // (a replacement ws_open for the same id must not emit a stale close).
    const cleanup = () => {
      if (this.streams.get(streamId) === local) {
        this.streams.delete(streamId);
        this.pending.delete(streamId);
        this.send({ kind: 'ws_close', streamId });
      }
    };
    local.on('close', cleanup);
    local.on('error', cleanup);
  }
}
