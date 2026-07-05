#!/usr/bin/env node
/**
 * REQ-011: Upload electron-builder artifacts (latest.yml + exe + zip + blockmap)
 * to the Cloudflare R2 update source so packaged desktop builds can auto-update.
 *
 * Uses `wrangler r2 object put`. Credentials env:
 *   CF_ACCOUNT_ID + CLOUDFLARE_API_TOKEN   (recommended)
 *   or R2_ACCESS_KEY + R2_SECRET_KEY       (wrangler auto-detects)
 *
 * Usage: node scripts/publish-r2.js [--version <x.y.z>]
 * Version defaults to package.json version. Release dir defaults to ./release.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const BUCKET = process.env.R2_BUCKET || 'planrla-updates';

/**
 * Build the list of {local, remote} objects to upload for a given version.
 * Filters out files that don't exist locally (e.g. blockmap may be absent).
 * Currently Windows-only (nsis + zip); mac/linux handled in future phases.
 */
export function buildR2Objects({ version, releaseDir }) {
  const arch = 'x64';
  const base = `${releaseDir}/planrla-${version}-${arch}`;
  return [
    { local: `${releaseDir}/latest.yml`, remote: `desktop/latest.yml` },
    { local: `${base}.exe`, remote: `desktop/planrla-${version}-${arch}.exe` },
    { local: `${base}.exe.blockmap`, remote: `desktop/planrla-${version}-${arch}.exe.blockmap` },
    { local: `${base}.zip`, remote: `desktop/planrla-${version}-${arch}.zip` },
  ].filter((o) => fs.existsSync(o.local));
}

function main() {
  const args = Object.fromEntries(
    process.argv.slice(2).reduce((acc, a, i, arr) => {
      if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]);
      return acc;
    }, [])
  );
  const version = args.version || require('../package.json').version;
  const releaseDir = args['release-dir'] || 'release';
  const objs = buildR2Objects({ version, releaseDir });
  if (objs.length === 0) {
    console.error(`[publish-r2] no artifacts in ${releaseDir}/ — run "npm run desktop:dist:win" first`);
    process.exit(1);
  }
  for (const { local, remote } of objs) {
    const cmd = `wrangler r2 object put ${BUCKET}/${remote} --file="${local}" --remote=true`;
    console.log(`[publish-r2] $ ${cmd}`);
    execSync(cmd, { stdio: 'inherit' });
  }
  console.log(`[publish-r2] ✓ Uploaded ${objs.length} objects to R2 bucket "${BUCKET}" (desktop/ prefix).`);
}

const invokedDirectly = import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`;
if (invokedDirectly) main();

export { main };
