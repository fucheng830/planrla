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
 *   - node    (127): `npm run dev` / `npm run server:dev`
 *
 * Usage:
 *   node scripts/sync-native-abi.js --target=electron
 *   node scripts/sync-native-abi.js --target=node
 *
 * Wired via package.json: `sync:electron`, `sync:node`, and prepended to every
 * `desktop:dist*` / `desktop:pack`. With `build.npmRebuild=false`, electron-builder
 * trusts the .node files produced here instead of re-running its own (failing) rebuild.
 *
 * @module scripts/sync-native-abi
 */
import { execSync } from 'node:child_process';

const arg = process.argv.slice(2).find((a) => a.startsWith('--target='));
const target = arg ? arg.split('=')[1] : '';

const NATIVE_MODULES = ['better-sqlite3', 'bcrypt', 'node-pty'];

function run(cmd) {
  console.log(`[sync-native-abi] $ ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
}

if (target === 'electron') {
  console.log('[sync-native-abi] Rebuilding native modules for Electron runtime (ABI 139)...');
  run('npx electron-rebuild -f');
} else if (target === 'node') {
  console.log('[sync-native-abi] Rebuilding native modules for system Node runtime (ABI 127)...');
  run(`npm rebuild ${NATIVE_MODULES.join(' ')}`);
} else {
  console.error('Usage: node scripts/sync-native-abi.js --target=electron|node');
  console.error('  electron — for npm run desktop / desktop:dist* (ABI 139)');
  console.error('  node     — for npm run dev / server:dev (ABI 127)');
  process.exit(1);
}

console.log(`[sync-native-abi] ✓ Done (target=${target}).`);
