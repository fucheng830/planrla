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

/** 兜底数据。⚠️ 修改 body/version 等字段时需同步 public/desktop/latest.json（两份必须一致） */
export const STATIC_FALLBACK: FeedEntry = {
  version: 'v0.2.0',
  title: 'v0.2.0 — 桌面端三态主题',
  body: '桌面端外观设置新增 system / light / dark 三态主题切换。\n\n- feat(theme): theme mode pure fns (system/light/dark)\n- feat(theme): three-state theme context\n- feat(theme): theme mode selector control\n- feat(theme): appearance tab + i18n (11 locales)',
  htmlUrl: 'https://updates.planrla.com/desktop',
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

// ---------------------------------------------------------------------------
// 本地发版录数据源（主用）。仓库为私有,GitHub Releases API 对外 404、v0.10.0 起
// 也不再打 tag——而 docs/process/releases/*.md 每版必写。构建时直接读本地文件,
// 无网络依赖、不依赖 token。fetchReleases 保留作公开仓库后的备用通道。
// ---------------------------------------------------------------------------

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RELEASES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../docs/process/releases');

function compareSemverDesc(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pb[i] ?? 0) - (pa[i] ?? 0);
  }
  return 0;
}

/** 读取 docs/process/releases/*.md,解析 主题/日期 头字段,按版本倒序。 */
export function readLocalReleases(): FeedEntry[] {
  let files: string[];
  try {
    files = readdirSync(RELEASES_DIR);
  } catch {
    return [];
  }
  const entries: FeedEntry[] = [];
  for (const file of files) {
    const m = /^v(\d+)\.(\d+)\.(\d+)\.md$/.exec(file);
    if (!m) continue;
    const raw = readFileSync(join(RELEASES_DIR, file), 'utf8');
    const title = raw.match(/\*\*主题\*\*[:：]\s*(.+)/)?.[1]?.trim() ?? '';
    const date = raw.match(/\*\*日期\*\*[:：]\s*(\d{4}-\d{2}-\d{2})/)?.[1];
    entries.push({
      version: `v${m[1]}.${m[2]}.${m[3]}`,
      title,
      body: raw,
      htmlUrl: 'https://updates.planrla.com/desktop',
      publishedAt: date ? `${date}T00:00:00Z` : '',
    });
  }
  entries.sort((a, b) => compareSemverDesc(a.version, b.version));
  return entries;
}
