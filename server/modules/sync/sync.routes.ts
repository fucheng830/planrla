// server/modules/sync/sync.routes.ts
//
// Express routes for team sync configuration. The browser never talks to
// planrla-cloud directly; it goes through this server (which holds the JWT and
// instance token), mirroring how the rest of the settings API works.
//
// Flow: user creates/joins a team → this server proxies to cloud, stores the
// returned team_id + instance token in sync_config → the background SyncEngine
// picks them up and begins pushing/pulling.

import express from 'express';
import os from 'node:os';

import { getConnection } from '@/modules/database/index.js';
import { createSyncConfigRepository } from './sync.db.js';
import { getSyncEngine, startSyncScheduler } from './sync.client.js';

const router = express.Router();

/** Default relay; users only override for self-hosted deployments. */
const DEFAULT_CLOUD_URL = 'https://api.planrla.com';

/** Explicit value wins (trimmed); otherwise persisted config; otherwise the
 *  public default — which is then persisted so the UI reflects it. */
function resolveCloudUrl(repo: ReturnType<typeof createSyncConfigRepository>, explicit?: string): string {
  const url = (explicit?.trim() || repo.get('cloud_url') || DEFAULT_CLOUD_URL).replace(//+$/, '');
  if (!repo.get('cloud_url')) repo.set('cloud_url', url);
  return url;
}

/** GET /api/sync/config — current sync configuration + connection status. */
router.get('/config', async (_req, res) => {
  const repo = createSyncConfigRepository(getConnection());
  const cfg = repo.getAll();
  res.json({
    configured: repo.isConfigured(),
    cloudUrl: cfg.cloud_url ?? '',
    teamId: cfg.team_id ?? '',
    teamName: cfg.team_name ?? '',
    instanceId: cfg.instance_id ?? '',
    instanceName: cfg.instance_name ?? '',
    // Never echo the full token to the browser; a masked preview is enough.
    instanceTokenMasked: cfg.instance_token ? `${cfg.instance_token.slice(0, 12)}…` : '',
    lastPullAt: cfg.last_pull_at ?? '',
  });
});

/** POST /api/sync/config — set just the cloud URL (step 1, before team ops). */
router.post('/config', async (req, res) => {
  const { cloudUrl } = req.body as { cloudUrl?: string };
  const repo = createSyncConfigRepository(getConnection());
  res.json({ success: true, cloudUrl: resolveCloudUrl(repo, cloudUrl) });
});

/** POST /api/sync/team/create — create a team on cloud and store credentials. */
router.post('/team/create', async (req, res) => {
  try {
    const { name } = req.body as { name?: string };
    if (!name?.trim()) return res.status(400).json({ error: 'team name required' });
    const repo = createSyncConfigRepository(getConnection());
    const cloudUrl = resolveCloudUrl(repo);
    const jwt = req.headers.authorization ?? '';

    const r = await fetch(`${cloudUrl.replace(/\/+$/, '')}/api/teams`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: jwt },
      body: JSON.stringify({ name: name.trim() }),
    });
    if (!r.ok) {
      const body = await r.text();
      return res.status(r.status).json({ error: `cloud: ${body.slice(0, 200)}` });
    }
    const body = await r.json() as { team: { id: string; name: string; invite_code: string } };
    repo.setMany({
      team_id: body.team.id,
      team_name: body.team.name,
    });
    res.json({ team: body.team });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** POST /api/sync/team/join — join a team with an invite code. */
router.post('/team/join', async (req, res) => {
  try {
    const { inviteCode } = req.body as { inviteCode?: string };
    if (!inviteCode?.trim()) return res.status(400).json({ error: 'inviteCode required' });
    const repo = createSyncConfigRepository(getConnection());
    const cloudUrl = resolveCloudUrl(repo);
    const jwt = req.headers.authorization ?? '';

    const r = await fetch(`${cloudUrl.replace(/\/+$/, '')}/api/teams/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: jwt },
      body: JSON.stringify({ invite_code: inviteCode.trim() }),
    });
    if (!r.ok) {
      const body = await r.text();
      return res.status(r.status).json({ error: `cloud: ${body.slice(0, 200)}` });
    }
    const body = await r.json() as { team: { id: string; name: string; invite_code: string } };
    repo.setMany({ team_id: body.team.id, team_name: body.team.name });
    res.json({ team: body.team });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** POST /api/sync/instance/register — register this instance on cloud, get token. */
router.post('/instance/register', async (req, res) => {
  try {
    const { name } = req.body as { name?: string };
    const repo = createSyncConfigRepository(getConnection());
    const cloudUrl = resolveCloudUrl(repo);
    const teamId = repo.get('team_id');
    const jwt = req.headers.authorization ?? '';
    if (!teamId) return res.status(400).json({ error: 'join a team before registering an instance' });

    const r = await fetch(`${cloudUrl.replace(/\/+$/, '')}/api/teams/${teamId}/instances`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: jwt },
      body: JSON.stringify({ name: name?.trim() || os.hostname() }),
    });
    if (!r.ok) {
      const body = await r.text();
      return res.status(r.status).json({ error: `cloud: ${body.slice(0, 200)}` });
    }
    const body = await r.json() as { instance: { id: string; name: string; token: string } };
    repo.setMany({
      instance_id: body.instance.id,
      instance_name: body.instance.name,
      instance_token: body.instance.token,
    });
    // Provisioning complete — kick the scheduler so it starts using the new token.
    startSyncScheduler();
    res.json({ instance: { id: body.instance.id, name: body.instance.name } });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** GET /api/sync/instances — list teammates' instances (from cloud). */
router.get('/instances', async (req, res) => {
  try {
    const repo = createSyncConfigRepository(getConnection());
    const cloudUrl = repo.get('cloud_url');
    const teamId = repo.get('team_id');
    const jwt = req.headers.authorization ?? '';
    if (!cloudUrl || !teamId) return res.json({ instances: [] });

    const r = await fetch(`${cloudUrl.replace(/\/+$/, '')}/api/teams/${teamId}/instances`, {
      headers: { authorization: jwt },
    });
    if (!r.ok) return res.status(r.status).json({ error: 'cloud error' });
    const body = await r.json() as { instances: unknown[] };
    res.json({ instances: body.instances ?? [] });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** POST /api/sync/now — trigger an immediate sync cycle. */
router.post('/now', async (_req, res) => {
  const engine = getSyncEngine();
  if (!engine) return res.status(400).json({ error: 'sync not configured' });
  try {
    const result = await engine.runCycle();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** GET /api/sync/status — last sync outcome. */
router.get('/status', async (_req, res) => {
  const engine = getSyncEngine();
  if (!engine) return res.json({ configured: false });
  res.json(engine.getStatus());
});

export default router;
