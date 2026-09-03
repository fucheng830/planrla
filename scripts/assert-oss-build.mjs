#!/usr/bin/env node
// Guard: the packaged desktop app must always be an OSS-mode build.
//
// A stray VITE_IS_PLATFORM=true (e.g. from a dev-only .env.local) gets inlined
// by Vite at build time and silently breaks auth in the installed app: the
// client renders as "platform user" and skips login, while the packaged
// server still requires a JWT - every API call 401s and the UI shows empty
// data with no login prompt.
//
// Wired as the "prebuild:client" npm hook. Set PLANRLA_ALLOW_PLATFORM_BUILD=1
// only for intentional platform-mode builds.
import fs from 'node:fs';

if (process.env.PLANRLA_ALLOW_PLATFORM_BUILD === '1') {
  console.log('[assert-oss-build] PLANRLA_ALLOW_PLATFORM_BUILD=1 - allowing platform-mode client build');
  process.exit(0);
}

const offenders = [];

if (process.env.VITE_IS_PLATFORM === 'true') {
  offenders.push('environment variable VITE_IS_PLATFORM=true');
}

for (const file of ['.env.local', '.env.production', '.env.production.local', '.env']) {
  if (!fs.existsSync(file)) continue;
  const hit = fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .find((line) => /^\s*VITE_IS_PLATFORM\s*=\s*true/.test(line));
  if (hit) offenders.push(file + ': ' + hit.trim());
}

if (offenders.length > 0) {
  console.error('[assert-oss-build] refusing to build: platform-mode flag would be baked into the client bundle:');
  for (const o of offenders) console.error('  - ' + o);
  console.error('Remove VITE_IS_PLATFORM=true (dev-only convenience) or set PLANRLA_ALLOW_PLATFORM_BUILD=1 to override.');
  process.exit(1);
}

console.log('[assert-oss-build] OK: OSS-mode client build');
