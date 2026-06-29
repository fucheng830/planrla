import express from 'express';

import { activateLicense, clearLicense, getLicenseStatus } from '../services/commercial-license.js';

const router = express.Router();

router.get('/status', (req, res) => {
  res.json({ license: getLicenseStatus() });
});

router.post('/activate', (req, res) => {
  try {
    const license = activateLicense(req.body?.licenseKey);
    res.json({ success: true, license });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to activate license',
      license: getLicenseStatus(),
    });
  }
});

router.delete('/activate', (req, res) => {
  clearLicense();
  res.json({ success: true, license: getLicenseStatus() });
});

export default router;
