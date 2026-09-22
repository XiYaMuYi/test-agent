import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { createPostgresExecutor, MigrationRunner, registeredMigrations } from '../../src/database/migrations/index.js';
import { createPostgresTestSupport } from '../support/postgres.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ORG_A = '11111111-1111-1111-1111-111111111111';
const ORG_B = '22222222-2222-2222-2222-222222222222';

const ADMIN_A = 'fixture:identity:admin-organization-a';
const STREAMER_A = 'fixture:identity:valid';
const STREAMER_A_OTHER = 'fixture:identity:streamer-organization-a-other';
const ADMIN_B = 'fixture:identity:cross-organization';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createApp(databaseUrl: string) {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = databaseUrl;
  try {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    return app;
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
}

async function loadWorkerModule(connectionString: string) {
  const loadWorkerMain = new Function('path', 'return import(path)') as (
    path: string,
  ) => Promise<{
    bootstrapWorker(connectionString?: string): Promise<{
      pollOnce(): Promise<{ scanned: number; dispatched: number; succeeded?: number; failed?: number }>;
      close?(): Promise<void>;
    }>;
  }>;
  const { bootstrapWorker } = await loadWorkerMain('../../../../worker/dist/main.js');
  return await bootstrapWorker(connectionString);
}

// ---------------------------------------------------------------------------
// Test: Full P0 MVP flow — admin → publish → assign → train → evaluate → read
// ---------------------------------------------------------------------------

test(
  'P1-10: core MVP end-to-end flow from scenario draft to evaluation report',
  { timeout: 180_000 },
  async (context) => {
    // -----------------------------------------------------------------------
    // 1. Infrastructure
    // -----------------------------------------------------------------------
    const postgres = await createPostgresTestSupport().start();
    const db = createPostgresExecutor(postgres.connectionUri);
    const runner = new MigrationRunner(db, registeredMigrations);
    await runner.applyAll();

    const app = await createApp(postgres.connectionUri);
    const worker = await loadWorkerModule(postgres.connectionUri);

    context.after(async () => {
      await worker.close?.();
      await app.close();
      await db.close();
      await postgres.stop();
    });

    const http = app.getHttpServer();

    // -----------------------------------------------------------------------
    // 2. Admin creates scenario draft
    // -----------------------------------------------------------------------
    const draftId = crypto.randomUUID();

    const createDraft = await request(http)
      .post('/admin/scenarios')
      .set('x-access-token', ADMIN_A)
      .send({
        id: draftId,
        payload: {
          title: '新品话术陪练',
          knowledgeVersions: ['knowledge-welcome@v1'],
          scoringRules: ['rule-greeting', 'rule-product', 'rule-closing'],
          agentConfig: {},
        },
      })
      .expect(201);
    assert.equal(createDraft.body.status, 'created');

    // -----------------------------------------------------------------------
    // 3. Admin validates the draft
    // -----------------------------------------------------------------------
    const validate = await request(http)
      .post(`/admin/scenarios/${draftId}/validate`)
      .set('x-access-token', ADMIN_A)
      .expect(200);
    assert.equal(validate.body.valid, true);

    // -----------------------------------------------------------------------
    // 4. Admin publishes — generates release snapshot
    // -----------------------------------------------------------------------
    await request(http)
      .post(`/admin/scenarios/${draftId}/publish`)
      .set('x-access-token', ADMIN_A)
      .expect(201);

    // Assert: exactly one snapshot exists for this draft
    const snapshots = await db.query<{ id: string; snapshot: Record<string, unknown> }>(
      'SELECT id, snapshot FROM release_snapshot WHERE scenario_draft_id = $1',
      [draftId],
    );
    assert.equal(snapshots.rows.length, 1, 'Exactly one release snapshot should exist');
    const snapshotRow = snapshots.rows[0];
    assert.ok(snapshotRow, 'Snapshot row should exist');
    const releaseSnapshotId = snapshotRow.id;
    const snapshot = snapshotRow.snapshot;
    assert.equal(snapshot.schemaVersion, 'release-snapshot/v1');
    assert.equal(Array.isArray(snapshot.knowledgeVersions), true);
    assert.equal(Array.isArray(snapshot.scoringRules), true);

    // Assert: outbox event created
    const outboxEvents = await db.query<{ event_type: string; status: string }>(
      "SELECT event_type, status FROM outbox_event WHERE event_type = 'release.published' ORDER BY created_at",
    );
    assert.ok(outboxEvents.rows.length >= 1);

    // -----------------------------------------------------------------------
    // 5. Admin creates assignment targeting the streamer
    // -----------------------------------------------------------------------
    const assignmentId = crypto.randomUUID();
    const createAssignment = await request(http)
      .post('/admin/assignments')
      .set('x-access-token', ADMIN_A)
      .send({
        id: assignmentId,
        releaseSnapshotId,
        name: '新品陪练投放',
        status: 'active',
        startsAt: new Date(Date.now() - 60_000).toISOString(),
        endsAt: new Date(Date.now() + 60 * 60_000).toISOString(),
        maxAttempts: 3,
        targetPrincipalIds: ['streamer-001'],
      })
      .expect(201);
    assert.equal(createAssignment.body.assignmentId, assignmentId);

    // Assert: assignment and learner_assignment belong to ORG_A
    const assignmentRow = await db.query<{ organization_id: string }>(
      'SELECT organization_id FROM assignment WHERE id = $1',
      [assignmentId],
    );
    const firstAssignmentRow = assignmentRow.rows[0];
    assert.ok(firstAssignmentRow, 'Assignment row should exist');
    assert.equal(firstAssignmentRow.organization_id, ORG_A);

    // -----------------------------------------------------------------------
    // 6. Streamer queries own tasks — can see only own assignment
    // -----------------------------------------------------------------------
    const myTasks = await request(http)
      .get('/me/assignments')
      .set('x-access-token', STREAMER_A)
      .expect(200);
    assert.ok(myTasks.body.items.length >= 1);
    const myTask = myTasks.body.items.find((t: { assignmentId: string }) => t.assignmentId === assignmentId);
    assert.ok(myTask, 'Streamer should see the assignment targeted to them');
    assert.equal(myTask.name, '新品陪练投放');

    // Assert: same organization, different streamer cannot see this targeted assignment
    const sameOrgOtherTasks = await request(http)
      .get('/me/assignments')
      .set('x-access-token', STREAMER_A_OTHER)
      .expect(200);
    const sameOrgOtherSeesTarget = sameOrgOtherTasks.body.items.find(
      (t: { assignmentId: string }) => t.assignmentId === assignmentId,
    );
    assert.equal(sameOrgOtherSeesTarget, undefined, 'Same-org other streamer must not see this targeted assignment');

    // Assert: cross-organization principal cannot see this assignment
    const crossOrgTasks = await request(http)
      .get('/me/assignments')
      .set('x-access-token', ADMIN_B)
      .expect(200);
    const crossOrgTask = crossOrgTasks.body.items.find((t: { assignmentId: string }) => t.assignmentId === assignmentId);
    assert.equal(crossOrgTask, undefined, 'Cross-organization principal must not see this assignment');

    // -----------------------------------------------------------------------
    // 7. Streamer starts training — server creates attempt + conversation
    // -----------------------------------------------------------------------
    const idempotencyKey = `e2e-flow-${crypto.randomUUID()}`;
    const startAttempt = await request(http)
      .post(`/me/assignments/${assignmentId}/attempts`)
      .set('x-access-token', STREAMER_A)
      .set('Idempotency-Key', idempotencyKey)
      .expect(201);

    const attemptId: string = startAttempt.body.attemptId;
    const conversationId: string = startAttempt.body.conversationId;
    assert.equal(typeof attemptId, 'string');
    assert.ok(attemptId.length > 0, 'attemptId must be a non-empty string');
    assert.equal(typeof conversationId, 'string');
    assert.ok(conversationId.length > 0, 'conversationId must be a non-empty string');

    // Assert: conversation is bound to the release snapshot and attempt
    const convRow = await db.query<{
      training_attempt_id: string;
      release_snapshot_id: string;
      organization_id: string;
      status: string;
    }>(
      'SELECT training_attempt_id, release_snapshot_id, organization_id, status FROM conversation WHERE id = $1',
      [conversationId],
    );
    const firstConvRow = convRow.rows[0];
    assert.ok(firstConvRow, 'Conversation row should exist');
    assert.equal(firstConvRow.training_attempt_id, attemptId);
    assert.equal(firstConvRow.release_snapshot_id, releaseSnapshotId);
    assert.equal(firstConvRow.organization_id, ORG_A);
    assert.equal(firstConvRow.status, 'created');

    // -----------------------------------------------------------------------
    // 8. Streamer sends three ordered messages (idempotent client_message_id)
    // -----------------------------------------------------------------------
    const messages = [
      { clientMessageId: 'e2e-msg-1', sequence: 1, content: '您好，欢迎了解我们的新品！' },
      { clientMessageId: 'e2e-msg-2', sequence: 2, content: '这款产品的核心卖点是……' },
      { clientMessageId: 'e2e-msg-3', sequence: 3, content: '如果您有疑问，可以随时问我。' },
    ];

    const messageIds: string[] = [];
    const firstMessageResponses: Array<Record<string, unknown>> = [];
    const firstMessageSuggestions: Array<Record<string, unknown> | undefined> = [];
    for (const msg of messages) {
      const res = await request(http)
        .post(`/me/conversations/${conversationId}/messages`)
        .set('x-access-token', STREAMER_A)
        .send(msg)
        .expect(201);
      assert.equal(res.body.sequence, msg.sequence);
      messageIds.push(res.body.messageId);
      firstMessageResponses.push(res.body as Record<string, unknown>);
      // I-02: Capture each round's Agent suggestion for replay verification
      firstMessageSuggestions.push(res.body.suggestion as Record<string, unknown> | undefined);
    }

    // Assert: sequences are strictly increasing
    assert.deepEqual(messageIds.length, 3);
    for (let i = 0; i < messageIds.length; i++) {
      const msgId = messageIds[i];
      assert.ok(typeof msgId === 'string' && msgId.length > 0);
    }

    // I-02: Assert each round received a controlled Agent suggestion
    for (let i = 0; i < firstMessageSuggestions.length; i++) {
      const sug = firstMessageSuggestions[i];
      assert.ok(sug !== undefined, `Message ${i + 1} must have received an Agent suggestion`);
      assert.equal(sug.schemaVersion, 'agent-output/v1', `Message ${i + 1} suggestion must use agent-output/v1`);
      assert.equal(typeof sug.replyText, 'string', `Message ${i + 1} must have replyText`);
      assert.ok(
        ['ask_follow_up', 'advance', 'end'].includes(sug.suggestedAction as string),
        `Message ${i + 1} must have valid suggestedAction`,
      );
    }

    // I-02: Assert: replay returns same messageId AND same Agent suggestion (full idempotent response)
    const replay = await request(http)
      .post(`/me/conversations/${conversationId}/messages`)
      .set('x-access-token', STREAMER_A)
      .send(messages[0])
      .expect(201);
    assert.deepEqual(replay.body, firstMessageResponses[0], 'Replay must return the complete first business response');

    // I-03: Assert conversation reached 'active' after model call completed successfully.
    // The two-phase protocol is: Phase 1 commits message + 'awaiting_model' (outside transaction);
    // Phase 2 calls model outside transaction and only advances to 'active' on success.
    // Model failure paths (timeout/schema-error) are verified in unit tests:
    //   conversation.service.unit.ts — model failure leaves status='awaiting_model'
    //   agent-orchestrator.test.ts — schema validation rejects bad responses
    // This E2E covers the happy path where all three rounds receive valid Agent suggestions.
    const convAfterMessages = await db.query<{ status: string; last_sequence: string }>(
      'SELECT status, last_sequence::text AS last_sequence FROM conversation WHERE id = $1',
      [conversationId],
    );
    const convAfterMsgsRow = convAfterMessages.rows[0];
    assert.ok(convAfterMsgsRow, 'Conversation row should exist');
    assert.equal(convAfterMsgsRow.status, 'active');
    assert.equal(convAfterMsgsRow.last_sequence, '3');

    // -----------------------------------------------------------------------
    // 9. Streamer ends training — server creates evaluation_job + outbox_event
    // -----------------------------------------------------------------------
    const endResult = await request(http)
      .post(`/me/conversations/${conversationId}/end`)
      .set('x-access-token', STREAMER_A)
      .expect(201);
    assert.equal(endResult.body.status, 'ended');

    // Assert: conversation status is ended
    const convEnded = await db.query<{ status: string }>(
      'SELECT status FROM conversation WHERE id = $1',
      [conversationId],
    );
    const convEndedRow = convEnded.rows[0];
    assert.ok(convEndedRow, 'Conversation row should exist');
    assert.equal(convEndedRow.status, 'ended');

    // Assert: evaluation_job created
    const evalJobs = await db.query<{ id: string; status: string; conversation_id: string }>(
      'SELECT id, status, conversation_id FROM evaluation_job WHERE conversation_id = $1',
      [conversationId],
    );
    assert.equal(evalJobs.rows.length, 1, 'Exactly one evaluation_job should be created');
    const evalJobRow = evalJobs.rows[0];
    assert.ok(evalJobRow, 'Evaluation job row should exist');
    assert.equal(evalJobRow.conversation_id, conversationId);
    assert.equal(evalJobRow.status, 'queued');

    // Assert: outbox_event for evaluation.requested
    const evalOutbox = await db.query<{ event_type: string; status: string; deduplication_key: string }>(
      "SELECT event_type, status, deduplication_key FROM outbox_event WHERE aggregate_id = $1 AND event_type = 'evaluation.requested'",
      [conversationId],
    );
    assert.equal(evalOutbox.rows.length, 1, 'Exactly one evaluation outbox event should exist');
    const evalOutboxRow = evalOutbox.rows[0];
    assert.ok(evalOutboxRow, 'Evaluation outbox row should exist');
    assert.equal(evalOutboxRow.deduplication_key, `evaluation:${conversationId}`);

    // -----------------------------------------------------------------------
    // 10. Worker consumes the evaluation event and generates a report
    // -----------------------------------------------------------------------
    // I-05: Assert no report exists before Worker runs (causal boundary)
    const reportsBeforeWorker = await db.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM evaluation_report WHERE conversation_id = $1',
      [conversationId],
    );
    assert.equal(reportsBeforeWorker.rows[0]?.count, '0', 'No evaluation report should exist before Worker poll');

    const pollResult = await worker.pollOnce();
    assert.ok(pollResult.scanned >= 1, 'Worker should scan at least one event');
    assert.equal(pollResult.succeeded, 1, 'Worker should succeed on exactly one event');

    // I-05: Assert outbox event transitioned from pending to published
    const outboxAfterWorker = await db.query<{ status: string }>(
      "SELECT status FROM outbox_event WHERE aggregate_id = $1 AND event_type = 'evaluation.requested'",
      [conversationId],
    );
    assert.equal(outboxAfterWorker.rows[0]?.status, 'published', 'Outbox event should be published after Worker');

    // I-05: Assert evaluation_job transitioned from queued to succeeded
    const evalJobAfterWorker = await db.query<{ status: string }>(
      'SELECT status FROM evaluation_job WHERE conversation_id = $1',
      [conversationId],
    );
    assert.equal(evalJobAfterWorker.rows[0]?.status, 'succeeded', 'Evaluation job should be succeeded after Worker');

    // Assert: exactly one evaluation_report for this conversation
    const reports = await db.query<{
      id: string;
      organization_id: string;
      conversation_id: string;
      evaluation_job_id: string;
      report: Record<string, unknown>;
    }>(
      'SELECT id, organization_id, conversation_id, evaluation_job_id, report FROM evaluation_report WHERE conversation_id = $1',
      [conversationId],
    );
    assert.equal(reports.rows.length, 1, 'Exactly one evaluation report should be generated');
    const reportRow = reports.rows[0];
    assert.ok(reportRow, 'Report row should exist');
    assert.equal(reportRow.conversation_id, conversationId);
    assert.equal(reportRow.organization_id, ORG_A);

    // M-02: This E2E verifies causal generation and the succeeded job state.
    // Published-report UPDATE/DELETE immutability is covered by test:integration.
    const evalJobAfter = await db.query<{ status: string }>(
      'SELECT status FROM evaluation_job WHERE id = $1',
      [reportRow.evaluation_job_id],
    );
    const evalJobAfterRow = evalJobAfter.rows[0];
    assert.ok(evalJobAfterRow, 'Eval job row should exist');
    assert.equal(evalJobAfterRow.status, 'succeeded');

    // Assert: report contains valid structure
    assert.equal(typeof reportRow.report, 'object');
    assert.ok(reportRow.report !== null);
    const reportPayload = reportRow.report as Record<string, unknown>;
    assert.equal(reportPayload.schemaVersion, 'evaluation-report/v1');

    // -----------------------------------------------------------------------
    // 11. Duplicate poll yields no new report (idempotency)
    // -----------------------------------------------------------------------
    const secondPoll = await worker.pollOnce();
    assert.equal(secondPoll.scanned, 0, 'No new events to process after first poll');

    const reportsAfterSecondPoll = await db.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM evaluation_report WHERE conversation_id = $1',
      [conversationId],
    );
    const reportsCountRow = reportsAfterSecondPoll.rows[0];
    assert.ok(reportsCountRow, 'Report count row should exist');
    assert.equal(reportsCountRow.count, '1', 'Report count must remain exactly one');

    // -----------------------------------------------------------------------
    // 12. Streamer reads own evaluation report via API
    // -----------------------------------------------------------------------
    const streamerReport = await request(http)
      .get(`/me/evaluations/${conversationId}`)
      .set('x-access-token', STREAMER_A)
      .expect(200);
    assert.equal(streamerReport.body.conversationId, conversationId);
    assert.equal(streamerReport.body.organizationId, ORG_A);
    assert.equal(typeof streamerReport.body.report, 'object');
    assert.equal((streamerReport.body.report as Record<string, unknown>).schemaVersion, 'evaluation-report/v1');

    // -----------------------------------------------------------------------
    // 13. Admin reads evaluation results for the organization
    // -----------------------------------------------------------------------
    const adminReports = await request(http)
      .get('/admin/evaluations')
      .set('x-access-token', ADMIN_A)
      .expect(200);
    assert.ok(!Array.isArray(adminReports.body), 'T22 起评估列表为分页包裹结构');
    assert.ok(Array.isArray(adminReports.body.items));
    const matchingReport = adminReports.body.items.find(
      (r: { conversationId: string }) => r.conversationId === conversationId,
    ) as { conversationId: string; sourceType: string } | undefined;
    assert.ok(matchingReport, 'Admin should see the evaluation result');
    assert.ok(matchingReport?.sourceType === 'free' || matchingReport?.sourceType === 'assigned');

    // -----------------------------------------------------------------------
    // 14. Cross-organization access assertions
    // -----------------------------------------------------------------------

    // M-01: Same organization, different streamer cannot read this conversation's report
    const sameOrgOtherReport = await request(http)
      .get(`/me/evaluations/${conversationId}`)
      .set('x-access-token', STREAMER_A_OTHER)
      .expect(404);
    assert.equal(sameOrgOtherReport.body.code, 'EVALUATION_NOT_FOUND');

    // Cross-organization admin cannot see this org's evaluations in their list
    const adminBReports = await request(http)
      .get('/admin/evaluations')
      .set('x-access-token', ADMIN_B)
      .expect(200);
    const orgBSeesOrgA = adminBReports.body.items.some(
      (r: { conversationId: string }) => r.conversationId === conversationId,
    );
    assert.equal(orgBSeesOrgA, false, 'Admin B must not see Admin A organization evaluations');

    // M-01: Same organization, different streamer cannot access this conversation
    const sameOrgOtherConv = await request(http)
      .get(`/me/conversations/${conversationId}`)
      .set('x-access-token', STREAMER_A_OTHER)
      .expect(404);
    assert.equal(sameOrgOtherConv.body.code, 'CONVERSATION_NOT_FOUND');

    // Cross-organization principal cannot start this assignment
    const crossOrgStart = await request(http)
      .post(`/me/assignments/${assignmentId}/attempts`)
      .set('x-access-token', ADMIN_B)
      .set('Idempotency-Key', 'cross-org-attempt')
      .expect(403);
    assert.equal(crossOrgStart.body.code, 'ORG_SCOPE_FORBIDDEN');

    // -----------------------------------------------------------------------
    // 15. Re-publish produces a second immutable snapshot
    // -----------------------------------------------------------------------
    await request(http)
      .post(`/admin/scenarios/${draftId}/publish`)
      .set('x-access-token', ADMIN_A)
      .expect(201);

    const snapshotsAfterRepublish = await db.query<{ id: string }>(
      'SELECT id FROM release_snapshot WHERE scenario_draft_id = $1',
      [draftId],
    );
    assert.equal(snapshotsAfterRepublish.rows.length, 2, 'Two snapshots after re-publish');
    const snapshotAfterRepublishFirst = snapshotsAfterRepublish.rows[0];
    const snapshotAfterRepublishSecond = snapshotsAfterRepublish.rows[1];
    assert.ok(snapshotAfterRepublishFirst, 'First republished snapshot should exist');
    assert.ok(snapshotAfterRepublishSecond, 'Second republished snapshot should exist');
    assert.notEqual(
      snapshotAfterRepublishFirst.id,
      snapshotAfterRepublishSecond.id,
      'Snapshots must have different IDs',
    );

    // Snapshot content must not have been mutated
    const originalSnapshot = snapshots.rows[0]?.snapshot;
    assert.ok(originalSnapshot, 'Original snapshot should exist');
    const dbSnapshots = await db.query<{ snapshot: Record<string, unknown> }>(
      'SELECT snapshot FROM release_snapshot WHERE scenario_draft_id = $1 ORDER BY created_at ASC',
      [draftId],
    );
    const firstDbSnapshot = dbSnapshots.rows[0];
    assert.ok(firstDbSnapshot, 'First DB snapshot should exist');
    assert.deepEqual(firstDbSnapshot.snapshot, originalSnapshot, 'Original snapshot must remain immutable');
  },
);
