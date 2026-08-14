// server/modules/a2a/trust.ts
//
// A2A 信任模式与会话共享开关。
//
// 信任模式(trust mode)决定"谁能连入":
//   - 'token'(默认): 回环免认证;远程调用方必须带 Authorization: Bearer <共享令牌>。
//   - 'lan': 局域网信任模式。回环 + 同一局域网(私有网段 IPv4)免令牌直连,
//     配合 discovery.service.ts 的 UDP 广播实现零配置互连;公网来源仍需令牌。
//
// 会话共享开关(share all)决定"能看到什么":
//   - 关闭(默认): 仅列出/委托标记了 a2a_exposed 的会话。
//   - 开启: 卡片列出全部未归档会话,且任意会话均可被委托(跳过白名单)。
// 两个开关正交,均持久化在 app_config。

import { appConfigDb } from '@/modules/database/repositories/app-config.js';

export type A2aTrustMode = 'token' | 'lan';

const TRUST_MODE_KEY = 'a2a_trust_mode';
const SHARE_ALL_KEY = 'a2a_share_all_sessions';

export function getTrustMode(): A2aTrustMode {
  try {
    const raw = appConfigDb.get(TRUST_MODE_KEY);
    return raw === 'lan' ? 'lan' : 'token';
  } catch {
    return 'token';
  }
}

export function setTrustMode(mode: A2aTrustMode): void {
  appConfigDb.set(TRUST_MODE_KEY, mode);
}

export function getShareAllSessions(): boolean {
  try {
    return appConfigDb.get(SHARE_ALL_KEY) === '1';
  } catch {
    return false;
  }
}

export function setShareAllSessions(enabled: boolean): void {
  appConfigDb.set(SHARE_ALL_KEY, enabled ? '1' : '0');
}

/**
 * 是否为私有网段 IPv4(192.168.x / 10.x / 172.16-31.x)。IPv6 仅放行回环
 * (由调用方的 LOOPBACK 集合处理)——局域网信任暂不覆盖 IPv6 ULA。
 * 接受 `::ffff:192.168.0.9` 形式的 IPv4-mapped 地址。
 */
export function isPrivateLanIp(ip: string): boolean {
  const normalized = ip.replace(/^::ffff:/i, '');
  if (/^(10|127)\./.test(normalized)) return true;
  if (/^192\.168\./.test(normalized)) return true;
  const m = /^172\.(\d{1,3})\./.exec(normalized);
  if (m) {
    const second = Number(m[1]);
    return second >= 16 && second <= 31;
  }
  return false;
}
