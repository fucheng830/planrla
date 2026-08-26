// Barrel for the sync module — cross-module imports must go through here
// (eslint boundaries/dependencies), e.g. kanban's assembly pulls
// recordTombstone for task-deletion propagation.
export { recordTombstone } from '@/modules/sync/sync.db.js';
