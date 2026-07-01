import { type Request, type Response, Router } from 'express';

import { searchSessions } from './session-search.service.js';

const router = Router();

// GET /api/search/sessions?q=<query>&provider=&projectPath=&limit=
// Authentication is applied at the mount point (server/index.js), consistent with
// every other backend route module.
router.get('/sessions', (req: Request, res: Response) => {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  const provider = typeof req.query.provider === 'string' ? req.query.provider : undefined;
  const projectPath = typeof req.query.projectPath === 'string' ? req.query.projectPath : undefined;
  const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;

  try {
    const results = searchSessions(q, { provider, projectPath, limit });
    res.json({ results });
  } catch (error) {
    // FTS5 语法错（query 含特殊字符且转义失败）→ 空结果而非 500
    console.error('[search] query failed:', (error as Error)?.message);
    res.json({ results: [], error: 'query_failed' });
  }
});

export default router;
