#!/usr/bin/env node
/**
 * Sync native modules (better-sqlite3 / bcrypt / node-pty) to a target ABI.
 *
 * Why this exists: this machine's electron-builder internal rebuild does not pick
 * up the VS C++ toolchain, so it silently falls back to whatever .node is on disk.
 * `npm install` ships Node-ABI prebuilt (NODE_MODULE_VERSION 127); the Electron
 * runtime used by `npm run desktop` and packaged builds needs ABI 139. A single
 * node_modules can only hold one ABI, so we explicitly rebuild to the right target
 * before the relevant command:
 *   - electron (139): `npm run desktop`, `npm run desktop:dist*`
 *   - node    (127): `npm run dev` / `npm run server:dev` / `npm run dev:desktop`
 *
 * Skip optimization: once a target has been built, it is recorded in
 * `node_modules/.native-abi-current`; if a later invocation asks for the same
 * target the slow rebuild is skipped (keeps `dev`/`dev:desktop` startup fast).
 * Pass `--force` to rebuild unconditionally (e.g. after reinstalling native deps).
 *
 * Usage:
 *   node scripts/sync-native-abi.js --target=electron
 *   node scripts/sync-native-abi.js --target=node [--force]
 *
 * Wired via package.json: `sync:electron`, `sync:node`, and prepended to every
 * `desktop:dist*` / `desktop:pack`. With `build.npmRebuild=false`, electron-builder
 * trusts the .node files produced here instead of re-running its own (failing) rebuild.
 *
 * @module scripts/sync-native-abi
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const args = process.argv.slice(2);
const targetArg = args.find((a) => a.startsWith('--target='));
const target = targetArg ? targetArg.split('=')[1] : '';
const force = args.includes('--force');

const NATIVE_MODULES = ['better-sqlite3', 'bcrypt', 'node-pty'];
const MARKER = 'node_modules/.native-abi-current';

function run(cmd) {
  console.log(`[sync-native-abi] $ ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
}

function currentAbi() {
  try {
    return fs.existsSync(MARKER) ? fs.readFileSync(MARKER, 'utf8').trim() : null;
  } catch {
    return null;
  }
}

if (target !== 'electron' && target !== 'node') {
  console.error('Usage: node scripts/sync-native-abi.js --target=electron|node [--force]');
  console.error('  electron — for npm run desktop / desktop:dist* (ABI 139)');
  console.error('  node     — for npm run dev / server:dev (ABI 127)');
  process.exit(1);
}

if (!force && currentAbi() === target) {
  console.log(`[sync-native-abi] native ABI already '${target}' (per ${MARKER}); skipping rebuild. Use --force to rebuild.`);
  process.exit(0);
}

if (target === 'electron') {
  console.log('[sync-native-abi] Rebuilding native modules for Electron runtime (ABI 139)...');
  run('npx electron-rebuild -f');
} else {
  console.log('[sync-native-abi] Rebuilding native modules for system Node runtime (ABI 127)...');
  run(`npm rebuild ${NATIVE_MODULES.join(' ')}`);
}

try {
  fs.writeFileSync(MARKER, target);
} catch {
  /* best-effort; marker is only an optimization */
}
console.log(`[sync-native-abi] ✓ Done (target=${target}).`);
