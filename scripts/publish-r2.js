#!/usr/bin/env node
/**
 * REQ-011: Upload electron-builder artifacts (latest.yml + exe + zip + blockmap)
 * to the Cloudflare R2 update source so packaged desktop builds can auto-update.
 *
 * Uses `npx wrangler r2 object put` (wrangler isn't a direct dep; npx resolves it
 * from the cached install). Auth: wrangler OAuth (`npx wrangler login`) OR env
 * CF_ACCOUNT_ID + CLOUDFLARE_API_TOKEN.
 *
 * Usage: node scripts/publish-r2.js [--version <x.y.z>] [--prefix <channel>]
 * Version defaults to package.json version. Release dir defaults to ./release.
 * Prefix defaults to `desktop` (production feed); dev builds push to `desktop-dev`
 * so they never pollute the production update source. `--prefix` arg wins over
 * env R2_PREFIX.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const BUCKET = process.env.R2_BUCKET || 'planrla-updates';

/**
 * Build the list of {local, remote} objects to upload for a given version.
 * Filters out files that don't exist locally (e.g. blockmap may be absent).
 * Currently Windows-only (nsis + zip); mac/linux handled in future phases.
 */
export function buildR2Objects({ version, releaseDir, prefix = 'desktop' }) {
  const arch = 'x64';
  const base = `${releaseDir}/planrla-${version}-${arch}`;
  return [
    { local: `${releaseDir}/latest.yml`, remote: `${prefix}/latest.yml` },
    { local: `${base}.exe`, remote: `${prefix}/planrla-${version}-${arch}.exe` },
    { local: `${base}.exe.blockmap`, remote: `${prefix}/planrla-${version}-${arch}.exe.blockmap` },
    { local: `${base}.zip`, remote: `${prefix}/planrla-${version}-${arch}.zip` },
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
  // 生产(desktop)与开发(desktop-dev)更新源隔离:开发构建永不污染生产 feed(2026-11-17 版本策略)
  const prefix = args.prefix || process.env.R2_PREFIX || 'desktop';
  const objs = buildR2Objects({ version, releaseDir, prefix });
  if (objs.length === 0) {
    console.error(`[publish-r2] no artifacts in ${releaseDir}/ — run "npm run desktop:dist:win" first`);
    process.exit(1);
  }
  for (const { local, remote } of objs) {
    const cmd = `npx wrangler r2 object put ${BUCKET}/${remote} --file="${local}" --remote=true`;
    console.log(`[publish-r2] $ ${cmd}`);
    try {
      execSync(cmd, { stdio: 'inherit' });
    } catch (e) {
      // wrangler r2 object put caps at 300 MiB; large artifacts (e.g. the portable
      // zip ~338 MiB) can't go up via wrangler. Skip with a warning — GitHub Release
      // serves them, and electron-updater's NSIS feed only needs latest.yml + exe.
      const sizeMiB = (fs.statSync(local).size / 1048576).toFixed(0);
      console.warn(`[publish-r2] ⚠ skipped ${remote} (${sizeMiB} MiB): ${String(e.message || e).split('\n')[0]}`);
    }
  }
  console.log(`[publish-r2] ✓ Processed ${objs.length} objects (failures warned above). Bucket "${BUCKET}", prefix ${prefix}/.`);
}

// Run main() only when invoked directly (not when imported by tests).
// pathToFileURL normalizes argv[1] to the same file:// URL form import.meta.url uses
// (avoids the file:// vs file:/// slash-count mismatch on Windows).
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();

export { main };
