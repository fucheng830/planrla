/**
 * 批量 SQL（sessionsDb.getSessionsByProjectPathsFirstPage）返回的行：每行带
 * 组内序号 rn + 该项目总数 total。本纯函数把它们按 project_path 分组，映射成
 * 「首页 session + total + hasMore」。与 DB 无关 —— SQL 只返回 rn <= offset+limit
 * 的行，本函数不再做窗口过滤，只分组 + 计算 hasMore。
 *
 * 边界：当某项目 offset >= total（翻到末页之外）时，SQL 不返回该项目的行，
 * 此时 total 保持初始值 0（无法从空结果恢复真实 total）。当前调用方只用
 * offset=0（首页），且 offset=0 + total>0 时总会返回行，故不受影响；若后续
 * 支持 offset 翻页，需在 SQL 层单独查 total。
 */

export type SessionBatchRow = {
  session_id: string;
  provider: string;
  custom_name?: string | null;
  project_path: string;
  updated_at?: string | null;
  created_at?: string | null;
  rn: number;
  total: number;
};

export type SessionSummary = {
  id: string;
  provider: string;
  summary: string;
  messageCount: number;
  lastActivity: string;
};

export type ProjectSessionPage = {
  sessions: SessionSummary[];
  total: number;
  hasMore: boolean;
};

function mapRowToSummary(row: SessionBatchRow): SessionSummary {
  return {
    id: row.session_id,
    provider: row.provider,
    summary: row.custom_name || '',
    messageCount: 0,
    lastActivity: row.updated_at ?? row.created_at ?? new Date().toISOString(),
  };
}

export function groupSessionRowsByProject(
  rows: SessionBatchRow[],
  projectPaths: string[],
  pagination: { limit: number; offset: number },
): Map<string, ProjectSessionPage> {
  const result = new Map<string, ProjectSessionPage>();
  // 初始化所有项目（含 0 session 的）为空页
  for (const p of projectPaths) {
    result.set(p, { sessions: [], total: 0, hasMore: false });
  }
  // 按 rn 升序保证首页顺序；分到各项目
  const sorted = [...rows].sort((a, b) => a.rn - b.rn);
  for (const row of sorted) {
    const page = result.get(row.project_path);
    if (!page) continue; // 行属于未请求的项目（不应发生，防御）
    page.sessions.push(mapRowToSummary(row));
    page.total = row.total;
    page.hasMore = page.total > pagination.offset + page.sessions.length;
  }
  return result;
}
