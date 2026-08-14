// server/modules/a2a/config.route.ts
//
// A2A configuration API for the Settings panel. Returns the local machine's
// A2A endpoint + shared token (so the user can share it with remote machines),
// and manages the list of registered remote agents (add/remove, one-time setup).
// Also reads/writes the trust-mode / share-all-sessions settings and lists
// auto-discovered LAN peers (UDP broadcast).
import { Router } from 'express';

import { a2aAgentsDb } from '@/modules/database/repositories/a2a-agents.js';
import { getA2aToken, getLanHost } from './inbound.route.js';
import {
  getShareAllSessions,
  getTrustMode,
  setShareAllSessions,
  setTrustMode,
  type A2aTrustMode,
} from './trust.js';
import { getDiscoveredPeers } from './discovery.service.js';

export function createA2aConfigRouter(): Router {
  const router = Router();

  /** GET /api/a2a-cfg/config — local endpoint + token + remote agents + trust settings + discovered peers */
  router.get('/config', (_req, res) => {
    const port = process.env.SERVER_PORT || 3001;
    const host = getLanHost();
    const token = getA2aToken();
    const agents = a2aAgentsDb.getAgentsList(1); // single-user host
    res.json({
      success: true,
      data: {
        endpoint: `http://${host}:${port}/api/a2a`,
        token,
        agents,
        trustMode: getTrustMode(),
        shareAllSessions: getShareAllSessions(),
        discoveredPeers: getDiscoveredPeers(),
      },
    });
  });

  /** POST /api/a2a-cfg/settings — update trust mode / share-all-sessions */
  router.post('/settings', (req, res) => {
    const body = (req.body || {}) as { trustMode?: unknown; shareAllSessions?: unknown };
    if (body.trustMode !== undefined) {
      if (body.trustMode !== 'token' && body.trustMode !== 'lan') {
        return res.status(400).json({ error: 'trustMode must be "token" or "lan"' });
      }
      setTrustMode(body.trustMode as A2aTrustMode);
    }
    if (body.shareAllSessions !== undefined) {
      if (typeof body.shareAllSessions !== 'boolean') {
        return res.status(400).json({ error: 'shareAllSessions must be a boolean' });
      }
      setShareAllSessions(body.shareAllSessions);
    }
    res.json({
      success: true,
      data: { trustMode: getTrustMode(), shareAllSessions: getShareAllSessions() },
    });
  });

  /** POST /api/a2a-cfg/agents — register a remote agent (one-time setup) */
  router.post('/agents', (req, res) => {
    const { name, url, authToken, description } = req.body || {};
    if (!name?.trim() || !url?.trim()) {
      return res.status(400).json({ error: 'name and url are required' });
    }
    const id = a2aAgentsDb.createAgent(
      1,
      name.trim(),
      url.trim(),
      description?.trim() || null,
      authToken?.trim() || null,
    );
    res.status(201).json({ success: true, data: { id } });
  });

  /** DELETE /api/a2a-cfg/agents/:id — remove a registered remote agent */
  router.delete('/agents/:id', (req, res) => {
    const id = Number(req.params.id);
    const deleted = a2aAgentsDb.deleteAgent(1, id);
    if (!deleted) return res.status(404).json({ error: 'agent not found' });
    res.json({ success: true });
  });

  return router;
}
