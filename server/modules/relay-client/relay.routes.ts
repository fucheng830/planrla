// server/modules/relay-client/relay.routes.ts
//
// Express routes for the remote-access relay agent. Mounted under /api/relay
// behind authenticateToken: the browser sends the cloud device token it just
// minted, and this server keeps the outbound relay connection running.

import express from 'express';

import { disableRelay, enableRelay, getRelayStatus } from './relay.service.js';

const router = express.Router();

/** GET /api/relay/status — config + live connection state. */
router.get('/status', (_req, res) => {
  res.json(getRelayStatus());
});

/** POST /api/relay/enable — store the device token and connect now (falls back to the stored token). */
router.post('/enable', (req, res) => {
  const { deviceToken, relayUrl, deviceName } = (req.body ?? {}) as {
    deviceToken?: string;
    relayUrl?: string;
    deviceName?: string;
  };
  try {
    res.json(enableRelay({ deviceToken, relayUrl, deviceName }));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** POST /api/relay/disable — stop the agent and remember the choice. */
router.post('/disable', (_req, res) => {
  res.json(disableRelay());
});

export default router;
