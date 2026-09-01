import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { getConnection } from '@/modules/database/connection.js';
import type { CreateProjectPathResult, ProjectRepositoryRow } from '@/shared/types.js';
import { normalizeProjectPath } from '@/shared/utils.js';

function normalizeProjectDisplayName(projectPath: string, customProjectName: string | null): string {
    const trimmedCustomName = typeof customProjectName === 'string' ? customProjectName.trim() : '';
    if (trimmedCustomName.length > 0) {
        return trimmedCustomName;
    }

    const directoryName = path.basename(projectPath);
    return directoryName || projectPath;
}

export /** Kanban agent worktrees must never surface as user projects — sessions
 * inside them still record the path (sessions FK), but the project row is
 * created pre-archived and never revived, keeping the sidebar clean. */
function isKanbanWorktreePath(p: string): boolean {
    return /[\\/].worktree[\\/]kanban[\\/]/i.test(p);
}

export const projectsDb = {
    /** 「已忘记」项目墓碑:被用户从列表移除(但保留会话数据)的项目路径。
     * 会话同步扫到这些路径的 jsonl 时仍会建档,但必须保持归档不复活——
     * 否则删掉的项目会被下一次同步悄悄拉回活动列表(实测发生过:
     * C:\Users\HONOR 反复回到创建任务卡的默认项目里)。表结构在
     * schema.ts 的 PROJECTS_TABLE_SCHEMA_SQL 里随启动补建。 */
    insertProjectTombstone(projectPath: string): void {
        const db = getConnection();
        db.prepare(`
            INSERT OR IGNORE INTO project_tombstones (project_path, created_at)
            VALUES (?, ?)
        `).run(normalizeProjectPath(projectPath), new Date().toISOString());
    },
    isProjectPathTombstoned(projectPath: string): boolean {
        const db = getConnection();
        const row = db.prepare(`
            SELECT 1 FROM project_tombstones WHERE project_path = ?
        `).get(normalizeProjectPath(projectPath));
        return Boolean(row);
    },
    /** 显式恢复(归档区「恢复」按钮)清除墓碑:用户意图胜过同步压制。 */
    deleteProjectTombstone(projectPath: string): void {
        const db = getConnection();
        db.prepare('DELETE FROM project_tombstones WHERE project_path = ?')
            .run(normalizeProjectPath(projectPath));
    },
    /** Active project paths (for local-image proxy allow-list). */
    listProjectPaths(): string[] {
        const db = getConnection();
        return (db.prepare('SELECT project_path FROM projects WHERE isArchived = 0').all() as Array<{ project_path: string }>)
            .map((row) => row.project_path);
    },
    createProjectPath(projectPath: string, customProjectName: string | null = null): CreateProjectPathResult {
        const db = getConnection();
        let normalizedProjectPath = normalizeProjectPath(projectPath);

        // Windows paths are case-insensitive: providers record cwds in
        // arbitrary casing ("c:\ws" vs "C:\WS"), which would otherwise split
        // one project into two sidebar entries. Reuse the existing row's
        // casing whenever it matches case-insensitively.
        if (/^[a-zA-Z]:[\\/]/.test(normalizedProjectPath)) {
            // NOTE: `rowid` (insertion order) stands in for creation time — the
            // projects table has no created_at column, and a bare `created_at`
            // here resolves against projects and throws "no such column".
            const canonical = db.prepare(`
                SELECT project_path FROM projects
                WHERE LOWER(project_path) = LOWER(?)
                ORDER BY (SELECT COUNT(*) FROM sessions WHERE sessions.project_path = projects.project_path) DESC,
                         rowid ASC
                LIMIT 1
            `).get(normalizedProjectPath) as { project_path: string } | undefined;
            if (canonical?.project_path) {
                normalizedProjectPath = canonical.project_path;
            }
        }

        const normalizedProjectName = normalizeProjectDisplayName(normalizedProjectPath, customProjectName);
        // Defense-in-depth: kanban worktree paths reaching this layer (e.g. a
        // caller bypassing session attribution) are created pre-archived and
        // forced back to archived on conflict — they must never revive. The
        // same applies to tombstoned ("forgotten") projects: session sync may
        // still see their jsonl files, but the row must stay archived.
        const wantArchived = isKanbanWorktreePath(normalizedProjectPath) || projectsDb.isProjectPathTombstoned(normalizedProjectPath) ? 1 : 0;
        const attemptedId = randomUUID();
        const row = db.prepare(`
        INSERT INTO projects (project_id, project_path, custom_project_name, isArchived)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(project_path) DO UPDATE SET
            isArchived = ${wantArchived}
            WHERE projects.isArchived <> ${wantArchived}
            RETURNING project_id, project_path, custom_project_name, isStarred, isArchived
        `).get(attemptedId, normalizedProjectPath, normalizedProjectName, wantArchived) as ProjectRepositoryRow | undefined;

        if (row) {
            return {
                outcome: row.project_id === attemptedId ? 'created' : 'reactivated_archived',
                project: row,
            };
        }

        const existingProject = projectsDb.getProjectPath(normalizedProjectPath);
        return {
            outcome: 'active_conflict',
            project: existingProject,
        };
    },

    getProjectPath(projectPath: string): ProjectRepositoryRow | null {
        const db = getConnection();
        const normalizedProjectPath = normalizeProjectPath(projectPath);
        const row = db.prepare(`
            SELECT project_id, project_path, custom_project_name, isStarred, isArchived
            FROM projects
            WHERE project_path = ?
        `).get(normalizedProjectPath) as ProjectRepositoryRow | undefined;

        return row ?? null;
    },

    getProjectById(projectId: string): ProjectRepositoryRow | null {
        const db = getConnection();
        const row = db.prepare(`
            SELECT project_id, project_path, custom_project_name, isStarred, isArchived
            FROM projects
            WHERE project_id = ?
        `).get(projectId) as ProjectRepositoryRow | undefined;

        return row ?? null;
    },

    /**
     * Resolve the absolute project directory from a database project_id.
     *
     * This is the canonical lookup used after the projectName → projectId migration:
     * API routes receive the DB-assigned `projectId` and must resolve the real folder
     * path through this helper before touching the filesystem. Returns `null` when the
     * project row does not exist so callers can respond with a 404.
     */
    getProjectPathById(projectId: string): string | null {
        const db = getConnection();
        const row = db.prepare(`
            SELECT project_path
            FROM projects
            WHERE project_id = ?
        `).get(projectId) as Pick<ProjectRepositoryRow, 'project_path'> | undefined;

        return row?.project_path ?? null;
    },

    getProjectPaths(): ProjectRepositoryRow[] {
        const db = getConnection();
        return db.prepare(`
            SELECT project_id, project_path, custom_project_name, isStarred, isArchived, sortIndex
            FROM projects
            WHERE isArchived = 0
            ORDER BY CASE WHEN sortIndex >= 0 THEN 0 ELSE 1 END, sortIndex ASC, rowid ASC
        `).all() as ProjectRepositoryRow[];
    },

    /**
     * Archived rows are queried separately so archive-focused UIs can present
     * hidden workspaces without reintroducing them into the active sidebar list.
     */
    getArchivedProjectPaths(): ProjectRepositoryRow[] {
        const db = getConnection();
        return db.prepare(`
            SELECT project_id, project_path, custom_project_name, isStarred, isArchived
            FROM projects
            WHERE isArchived = 1
        `).all() as ProjectRepositoryRow[];
    },

    getCustomProjectName(projectPath: string): string | null {
        const db = getConnection();
        const normalizedProjectPath = normalizeProjectPath(projectPath);
        const row = db.prepare(`
            SELECT custom_project_name
            FROM projects
            WHERE project_path = ?
        `).get(normalizedProjectPath) as Pick<ProjectRepositoryRow, 'custom_project_name'> | undefined;

        return row?.custom_project_name ?? null;
    },

    updateCustomProjectName(projectPath: string, customProjectName: string | null): void {
        const db = getConnection();
        const normalizedProjectPath = normalizeProjectPath(projectPath);
        db.prepare(`
            INSERT INTO projects (project_id, project_path, custom_project_name)
            VALUES (?, ?, ?)
            ON CONFLICT(project_path) DO UPDATE SET custom_project_name = excluded.custom_project_name
        `).run(randomUUID(), normalizedProjectPath, customProjectName);
    },

    updateCustomProjectNameById(projectId: string, customProjectName: string | null): void {
        const db = getConnection();
        db.prepare(`
            UPDATE projects
            SET custom_project_name = ?
            WHERE project_id = ?
        `).run(customProjectName, projectId);
    },

    updateProjectIsStarred(projectPath: string, isStarred: boolean): void {
        const db = getConnection();
        const normalizedProjectPath = normalizeProjectPath(projectPath);
        db.prepare(`
            UPDATE projects
            SET isStarred = ?
            WHERE project_path = ?
        `).run(isStarred ? 1 : 0, normalizedProjectPath);
    },

    updateProjectIsStarredById(projectId: string, isStarred: boolean): void {
        const db = getConnection();
        db.prepare(`
            UPDATE projects
            SET isStarred = ?
            WHERE project_id = ?
        `).run(isStarred ? 1 : 0, projectId);
    },

    /** Persists sidebar drag-and-drop ordering in one transaction. Unknown
     *  or archived ids are ignored so a stale client cannot reorder ghosts. */
    updateProjectSortIndexes(projectIdsInOrder: string[]): void {
        const db = getConnection();
        const assign = db.prepare(`
            UPDATE projects
            SET sortIndex = ?
            WHERE project_id = ? AND isArchived = 0
        `);
        const run = db.transaction((ids: string[]) => {
            ids.forEach((projectId, index) => assign.run(index, projectId));
        });
        run(projectIdsInOrder);
    },

    /** Clears manual ordering so every project falls back to auto sort. */
    clearProjectSortIndexes(): void {
        const db = getConnection();
        db.prepare('UPDATE projects SET sortIndex = -1').run();
    },

    updateProjectIsArchived(projectPath: string, isArchived: boolean): void {
        const db = getConnection();
        const normalizedProjectPath = normalizeProjectPath(projectPath);
        db.prepare(`
            UPDATE projects
            SET isArchived = ?
            WHERE project_path = ?
        `).run(isArchived ? 1 : 0, normalizedProjectPath);
    },

    updateProjectIsArchivedById(projectId: string, isArchived: boolean): void {
        const db = getConnection();
        db.prepare(`
            UPDATE projects
            SET isArchived = ?
            WHERE project_id = ?
        `).run(isArchived ? 1 : 0, projectId);
    },

    deleteProjectPath(projectPath: string): void {
        const db = getConnection();
        const normalizedProjectPath = normalizeProjectPath(projectPath);
        db.prepare(`
            DELETE FROM projects
            WHERE project_path = ?
        `).run(normalizedProjectPath);
    },

    deleteProjectById(projectId: string): void {
        const db = getConnection();
        db.prepare(`
            DELETE FROM projects
            WHERE project_id = ?
        `).run(projectId);
    },
};
