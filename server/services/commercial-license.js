import crypto from 'crypto';

import { appConfigDb } from '../modules/database/index.js';

const LICENSE_CONFIG_KEY = 'commercial_license_key';
const LICENSE_PREFIX = 'nomad_';

function normalizePublicKey(value) {
  if (!value) return null;
  return value.replace(/\\n/g, '\n').trim();
}

function decodeBase64Url(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function getConfiguredPublicKey() {
  return normalizePublicKey(process.env.NOMAD_LICENSE_PUBLIC_KEY);
}

function getStoredLicenseKey() {
  return process.env.NOMAD_LICENSE_KEY || appConfigDb.get(LICENSE_CONFIG_KEY);
}

function verifySignature(payloadPart, signaturePart, publicKey) {
  const verifier = crypto.createVerify('SHA256');
  verifier.update(payloadPart);
  verifier.end();
  return verifier.verify(publicKey, Buffer.from(signaturePart, 'base64url'));
}

function parseLicenseKey(licenseKey) {
  if (!licenseKey || typeof licenseKey !== 'string') {
    throw new Error('License key is required');
  }

  const normalized = licenseKey.trim();
  if (!normalized.startsWith(LICENSE_PREFIX)) {
    throw new Error('License key has an invalid prefix');
  }

  const [payloadPart, signaturePart] = normalized.slice(LICENSE_PREFIX.length).split('.');
  if (!payloadPart || !signaturePart) {
    throw new Error('License key has an invalid format');
  }

  const payload = JSON.parse(decodeBase64Url(payloadPart));
  if (payload.product && payload.product !== 'nomad') {
    throw new Error('License key is for a different product');
  }

  return { normalized, payloadPart, signaturePart, payload };
}

function evaluatePayload(payload) {
  const expiresAt = payload.expiresAt ? new Date(payload.expiresAt) : null;
  const expired = expiresAt ? Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now() : false;

  return {
    status: expired ? 'expired' : 'active',
    plan: payload.plan || 'commercial',
    customer: payload.customer || null,
    seats: Number.isFinite(Number(payload.seats)) ? Number(payload.seats) : null,
    features: Array.isArray(payload.features) ? payload.features : [],
    issuedAt: payload.issuedAt || null,
    expiresAt: payload.expiresAt || null,
  };
}

export function getLicenseStatus() {
  if (process.env.NOMAD_LICENSE_BYPASS === 'true') {
    return {
      status: 'active',
      plan: 'development',
      customer: 'Development override',
      seats: null,
      features: ['all'],
      issuedAt: null,
      expiresAt: null,
      requireLicense: process.env.NOMAD_REQUIRE_LICENSE === 'true',
      source: 'bypass',
    };
  }

  const licenseKey = getStoredLicenseKey();
  if (!licenseKey) {
    return {
      status: 'unlicensed',
      plan: null,
      customer: null,
      seats: null,
      features: [],
      issuedAt: null,
      expiresAt: null,
      requireLicense: process.env.NOMAD_REQUIRE_LICENSE === 'true',
      source: null,
    };
  }

  const publicKey = getConfiguredPublicKey();
  if (!publicKey) {
    return {
      status: 'invalid',
      error: 'NOMAD_LICENSE_PUBLIC_KEY is not configured',
      requireLicense: process.env.NOMAD_REQUIRE_LICENSE === 'true',
      source: process.env.NOMAD_LICENSE_KEY ? 'env' : 'stored',
    };
  }

  try {
    const parsed = parseLicenseKey(licenseKey);
    if (!verifySignature(parsed.payloadPart, parsed.signaturePart, publicKey)) {
      throw new Error('License signature is invalid');
    }

    return {
      ...evaluatePayload(parsed.payload),
      requireLicense: process.env.NOMAD_REQUIRE_LICENSE === 'true',
      source: process.env.NOMAD_LICENSE_KEY ? 'env' : 'stored',
    };
  } catch (error) {
    return {
      status: 'invalid',
      error: error instanceof Error ? error.message : 'Invalid license key',
      requireLicense: process.env.NOMAD_REQUIRE_LICENSE === 'true',
      source: process.env.NOMAD_LICENSE_KEY ? 'env' : 'stored',
    };
  }
}

export function activateLicense(licenseKey) {
  const publicKey = getConfiguredPublicKey();
  if (!publicKey) {
    throw new Error('NOMAD_LICENSE_PUBLIC_KEY must be configured before activation');
  }

  const parsed = parseLicenseKey(licenseKey);
  if (!verifySignature(parsed.payloadPart, parsed.signaturePart, publicKey)) {
    throw new Error('License signature is invalid');
  }

  const status = evaluatePayload(parsed.payload);
  if (status.status !== 'active') {
    throw new Error('License is expired');
  }

  appConfigDb.set(LICENSE_CONFIG_KEY, parsed.normalized);
  return getLicenseStatus();
}

export function clearLicense() {
  appConfigDb.set(LICENSE_CONFIG_KEY, '');
}

export function enforceCommercialLicense(req, res, next) {
  if (process.env.NOMAD_REQUIRE_LICENSE !== 'true') return next();

  const status = getLicenseStatus();
  if (status.status === 'active') return next();

  return res.status(402).json({
    error: 'Commercial license required',
    license: status,
  });
}
