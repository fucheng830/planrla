// One-off smoke test for server/kimi-cli.js spawnKimi against the real CLI.
// Run: TSX_TSCONFIG_PATH=server/tsconfig.json node --import tsx debug/kimi-spawn-smoke.mjs <cwd>
import { spawnKimi } from '../server/kimi-cli.js';

const events = [];
const writer = {
  send: (msg) => events.push(msg),
  setSessionId: (id) => events.push({ kind: 'writer_set_session', id }),
  userId: null,
};

const cwd = process.argv[2] || process.cwd();
try {
  await spawnKimi('Reply with exactly: ok', { cwd }, writer);
} catch (error) {
  console.log('SPAWN_REJECTED:', error.message);
}

const kinds = events.map((event) => event.kind ?? event.type);
console.log('EVENT_KINDS:', JSON.stringify(kinds));
console.log('SESSION_CREATED:', events.some((event) => event.kind === 'session_created'));
console.log('COMPLETE:', events.some((event) => event.type === 'complete'));
const text = events.filter((event) => event.kind === 'stream_delta').map((event) => event.content).join('');
console.log('TEXT:', JSON.stringify(text));
const sessionId = events.find((event) => event.kind === 'session_created')?.newSessionId;
console.log('SESSION_ID:', sessionId);
process.exit(0);
