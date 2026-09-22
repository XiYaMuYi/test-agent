export { schemaMigrationsBaseline } from './0001-schema-migrations.js';
export { coreMvpSchemaMigration } from './0002-core-mvp.js';
export { workerEvaluationLeaseMigration } from './0003-worker-evaluation-lease.js';
export { personaTemplatesMigration } from './0014-persona-templates.js';
export { cFirstDualTrackMigration } from './0015-c-first-dual-track.js';
export { finalizeDualTrackMigration } from './0016-finalize-dual-track.js';
export { conversationOpeningMigration } from './0017-conversation-opening.js';
export { customerStateProgressionMigration } from './0018-customer-state-progression.js';
export { adminConfigurationMainlineMigration } from './0019-admin-configuration-mainline.js';
export { assignmentTaskOverrideMigration } from './0020-assignment-task-override.js';
export { MigrationRunner } from './migration-runner.js';
export { createPostgresExecutor } from './postgres-executor.js';
import { schemaMigrationsBaseline } from './0001-schema-migrations.js';
import { coreMvpSchemaMigration } from './0002-core-mvp.js';
import { workerEvaluationLeaseMigration } from './0003-worker-evaluation-lease.js';
import { personaTemplatesMigration } from './0014-persona-templates.js';
import { cFirstDualTrackMigration } from './0015-c-first-dual-track.js';
import { finalizeDualTrackMigration } from './0016-finalize-dual-track.js';
import { conversationOpeningMigration } from './0017-conversation-opening.js';
import { customerStateProgressionMigration } from './0018-customer-state-progression.js';
import { adminConfigurationMainlineMigration } from './0019-admin-configuration-mainline.js';
import { assignmentTaskOverrideMigration } from './0020-assignment-task-override.js';
export const registeredMigrations = Object.freeze([
    schemaMigrationsBaseline,
    coreMvpSchemaMigration,
    workerEvaluationLeaseMigration,
    personaTemplatesMigration,
    cFirstDualTrackMigration,
    finalizeDualTrackMigration,
    conversationOpeningMigration,
    customerStateProgressionMigration,
    adminConfigurationMainlineMigration,
    assignmentTaskOverrideMigration,
]);
