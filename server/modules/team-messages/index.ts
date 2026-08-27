export { TEAM_MESSAGES_TABLE_SCHEMA_SQL } from '@/modules/database/index.js';
export { createTeamMessageStore } from './store.js';
export type { TeamMessage } from './store.js';
export { createTeamMessageRouter } from './routes.js';
export { createGatewayIngestRouter, verifyGatewayToken, normalizeThreadKey } from './gateway.routes.js';
