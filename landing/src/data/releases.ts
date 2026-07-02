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
