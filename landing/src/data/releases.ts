/**
 * Release 归一化纯函数 + 类型。IO（fetch）放在 fetchReleases，本文件只导出可测纯函数。
 * 对齐 NOMAD_UPDATE_CHECK_URL schema（见 docs/commercial/RELEASE_CHECKLIST.md）。
 */

export interface FeedEntry {
  version: string;       // tag_name, e.g. "v0.2.0"
  title: string;         // release name（null 时 fallback 到 tag_name）
  body: string;          // release body markdown（null → ''）
  htmlUrl: string;       // release html url
  publishedAt: string;   // published_at ISO（null → ''）
}

/** GitHub Release raw item 子集 */
interface RawRelease {
  tag_name: string;
  name: string | null;
  body: string | null;
  html_url: string;
  published_at: string | null;
  draft: boolean;
  prerelease: boolean;
}

/**
 * 把 GitHub API 的 raw release 归一化为 FeedEntry。
 * draft 或缺关键字段（tag_name / html_url）返回 null，由调用方过滤。
 */
export function normalizeRelease(raw: RawRelease): FeedEntry | null {
  if (raw.draft) return null;
  if (!raw.tag_name || !raw.html_url) return null;
  return {
    version: raw.tag_name,
    title: raw.name || raw.tag_name,
    body: raw.body || '',
    htmlUrl: raw.html_url,
    publishedAt: raw.published_at || '',
  };
}

const REPO = 'fucheng830/planrla';
const API_URL = `https://api.github.com/repos/${REPO}/releases`;

/** fetch 失败时的兜底（与 public/desktop/latest.json 静态版保持一致） */
export const STATIC_FALLBACK: FeedEntry = {
  version: 'v0.2.0',
  title: 'v0.2.0 — 桌面端三态主题',
  body: '桌面端外观设置新增 system / light / dark 三态主题切换。',
  htmlUrl: 'https://github.com/fucheng830/planrla/releases/tag/v0.2.0',
  publishedAt: '2026-07-02T10:43:00Z',
};

/**
 * 构建时 fetch GitHub Releases，返回归一化后的 FeedEntry[]（已过滤 draft/非法）。
 * fetch 失败（限流 / 断网）返回 [STATIC_FALLBACK]，构建不挂。
 * token 可选：传 GITHUB_TOKEN 提升匿名 60/hr 限流到 5000/hr。
 */
export async function fetchReleases(token?: string): Promise<FeedEntry[]> {
  try {
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'planrla-landing',
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(API_URL, { headers });
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const raw = (await res.json()) as RawRelease[];
    const entries = raw.map(normalizeRelease).filter((r): r is FeedEntry => r !== null);
    if (entries.length === 0) throw new Error('no releases');
    return entries;
  } catch (e) {
    console.warn(`[releases] fetch failed (${(e as Error).message}), using static fallback`);
    return [STATIC_FALLBACK];
  }
}
