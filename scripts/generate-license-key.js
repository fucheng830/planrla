#!/usr/bin/env node
const crypto = require('node:crypto');

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}`);
    process.exit(1);
  }
  return value;
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

const privateKey = requireEnv('NOMAD_LICENSE_PRIVATE_KEY').replace(/\\n/g, '\n');
const payload = {
  product: 'nomad',
  customer: requireEnv('CUSTOMER'),
  plan: process.env.PLAN || 'commercial',
  seats: Number(process.env.SEATS || 1),
  features: (process.env.FEATURES || 'all').split(',').map((feature) => feature.trim()).filter(Boolean),
  issuedAt: new Date().toISOString(),
  expiresAt: requireEnv('EXPIRES_AT'),
};

const payloadPart = base64UrlJson(payload);
const signer = crypto.createSign('SHA256');
signer.update(payloadPart);
signer.end();
const signaturePart = signer.sign(privateKey).toString('base64url');

console.log(`nomad_${payloadPart}.${signaturePart}`);
