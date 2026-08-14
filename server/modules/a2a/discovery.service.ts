// server/modules/a2a/discovery.service.ts
//
// 局域网节点自动发现(UDP 广播)。
//
// 局域网信任模式(lan)下,本机每 10 秒向网段广播地址 + 255.255.255.255 广播一条
// 自我声明;同时始终监听其他 planrla 节点的声明,维护最近 90 秒内活跃的节点表。
// 发现的节点出现在 Settings → A2A 与 MCP a2a_list 中,可用主机名直接
// a2a_call / a2a_discover(目标处于 lan 模式时免令牌)。
//
// 令牌模式(token)不广播自身(不在网络上暴露存在性),但仍监听——这样令牌模式
// 的机器也能"看到"局域网里启用了信任模式的节点;能否直连由目标机器的模式决定。

import dgram from 'node:dgram';
import os from 'node:os';

import { getTrustMode } from './trust.js';

export interface DiscoveredPeer {
  /** 广播方主机名(os.hostname()),作为 a2a 目标名。 */
  name: string;
  /** 来源 IPv4(广播报文的源地址)。 */
  ip: string;
  /** planrla server 端口。 */
  port: number;
  /** 广播方版本号。 */
  version: string;
  /** 最后一次收到声明的时间戳(ms)。 */
  lastSeen: number;
}

const BROADCAST_INTERVAL_MS = 10_000;
const PEER_TTL_MS = 90_000;
const MAGIC = 'planrla-a2a';
const PROTOCOL = 1;

let socket: dgram.Socket | null = null;
let announceTimer: NodeJS.Timeout | null = null;
let pruneTimer: NodeJS.Timeout | null = null;
const peers = new Map<string, DiscoveredPeer>();

function ownIps(): Set<string> {
  const set = new Set<string>();
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === 'IPv4') set.add(addr.address);
    }
  }
  return set;
}

function broadcastAddresses(): string[] {
  const targets = new Set<string>(['255.255.255.255']);
  for (const ip of ownIps()) {
    if (/^(10|127)\./.test(ip) || /^192\.168\./.test(ip)) {
      const m = /^(\d+\.\d+\.\d+)\./.exec(ip);
      if (m) targets.add(`${m[1]}.255`);
    } else if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) {
      const m = /^(\d+\.\d+\.\d+)\./.exec(ip);
      if (m) targets.add(`${m[1]}.255`);
    }
  }
  return [...targets];
}

function buildAnnounce(serverPort: number, version: string): Buffer {
  return Buffer.from(
    JSON.stringify({
      magic: MAGIC,
      protocol: PROTOCOL,
      name: os.hostname(),
      port: serverPort,
      version,
      mode: getTrustMode(),
    })
  );
}

function handleMessage(raw: Buffer, rinfo: dgram.RemoteInfo): void {
  // 自己的广播会经本机协议栈回到监听口;按来源 IP 过滤。
  if (ownIps().has(rinfo.address)) return;

  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(raw.toString('utf8'));
  } catch {
    return;
  }
  if (msg?.magic !== MAGIC || msg.protocol !== PROTOCOL) return;

  const name = typeof msg.name === 'string' ? msg.name.trim() : '';
  const port = Number(msg.port);
  if (!name || !Number.isInteger(port) || port <= 0 || port > 65535) return;

  const key = `${name}@${rinfo.address}`;
  peers.set(key, {
    name,
    ip: rinfo.address,
    port,
    version: typeof msg.version === 'string' ? msg.version : '',
    lastSeen: Date.now(),
  });
}

function prunePeers(): void {
  const now = Date.now();
  for (const [key, peer] of peers) {
    if (now - peer.lastSeen > PEER_TTL_MS) peers.delete(key);
  }
}

/** 当前活跃的已发现节点(最近 90 秒内有声明),按名字排序。 */
export function getDiscoveredPeers(): DiscoveredPeer[] {
  prunePeers();
  return [...peers.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** 按主机名查找已发现节点(忽略大小写),供 resolveTarget 回退使用。 */
export function findPeerByName(name: string): DiscoveredPeer | null {
  const wanted = name.trim().toLowerCase();
  for (const peer of getDiscoveredPeers()) {
    if (peer.name.toLowerCase() === wanted) return peer;
  }
  return null;
}

/**
 * 启动发现服务。仅在局域网信任模式下广播;监听始终开启。
 * @param serverPort planrla HTTP 端口
 * @param version    包版本(仅用于展示)
 */
export function startA2aDiscovery(serverPort: number, version: string): void {
  if (socket) return;

  socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  socket.on('error', (err) => {
    // 广播被防火墙/权限拦截时静默降级——手动注册模式不受影响。
    console.warn(`[a2a-discovery] udp error: ${err.message}`);
  });
  socket.on('message', handleMessage);

  socket.bind(getDiscoveryPort(), () => {
    try {
      socket?.setBroadcast(true);
    } catch {
      /* 非 Windows 或权限不足时仅监听 */
    }

    const announce = () => {
      if (getTrustMode() !== 'lan') return;
      const payload = buildAnnounce(serverPort, version);
      for (const target of broadcastAddresses()) {
        socket?.send(payload, getDiscoveryPort(), target);
      }
    };

    announce();
    announceTimer = setInterval(announce, BROADCAST_INTERVAL_MS);
    announceTimer.unref?.();
  });

  pruneTimer = setInterval(prunePeers, PEER_TTL_MS);
  pruneTimer.unref?.();
}

export function getDiscoveryPort(): number {
  const parsed = Number(process.env.A2A_DISCOVERY_PORT);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : 45690;
}

export function stopA2aDiscovery(): void {
  if (announceTimer) clearInterval(announceTimer);
  if (pruneTimer) clearInterval(pruneTimer);
  announceTimer = null;
  pruneTimer = null;
  socket?.close();
  socket = null;
  peers.clear();
}
