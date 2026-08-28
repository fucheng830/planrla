/**
 * REQ-052 / kanban task #4 E2E helper: programmatic Vite dev server.
 *
 * The vite CLI shuts down when stdin closes under non-TTY runners, so the
 * acceptance capture script starts vite through this file instead (Node API
 * keeps the process alive). Proxies /api + /ws to the isolated server on
 * SERVER_PORT (default 3101).
 *
 * Usage: SERVER_PORT=3101 node debug/vite-e2e-server.mjs [port]
 */
import { createServer } from 'vite';

const port = Number(process.argv[2] || 5273);
const server = await createServer({
  configFile: 'vite.config.js',
  server: { port, strictPort: true },
  logLevel: 'info',
});

await server.listen();
console.log(`[vite-e2e] ready on http://localhost:${port} (proxy → 127.0.0.1:${process.env.SERVER_PORT || 3001})`);

const shutdown = async () => {
  await server.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
