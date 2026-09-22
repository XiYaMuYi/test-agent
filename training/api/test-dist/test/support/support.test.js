import assert from 'node:assert/strict';
import test from 'node:test';
import { FixedClock } from './fixed-clock.js';
import { createPostgresTestSupport, TestcontainersUnavailableError } from './postgres.js';
import { runInTransaction } from './transaction.js';
import { DeterministicUuidFactory } from './uuid-factory.js';
test('fixed clock returns a stable instant until it is advanced', () => {
    const clock = new FixedClock('2026-07-24T00:00:00.000Z');
    assert.equal(clock.now().toISOString(), '2026-07-24T00:00:00.000Z');
    clock.advanceBy(90_000);
    assert.equal(clock.now().toISOString(), '2026-07-24T00:01:30.000Z');
});
test('deterministic UUID factory yields distinct valid UUID-shaped values', () => {
    const uuids = new DeterministicUuidFactory('b06');
    const first = uuids.next();
    const second = uuids.next();
    assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.notEqual(first, second);
    assert.equal(new DeterministicUuidFactory('b06').next(), first);
});
test('transaction helper commits successful work and rolls back failed work', async () => {
    const events = [];
    const client = {
        begin: async () => { events.push('begin'); },
        commit: async () => { events.push('commit'); },
        rollback: async () => { events.push('rollback'); },
    };
    assert.equal(await runInTransaction(client, async () => 'saved'), 'saved');
    await assert.rejects(() => runInTransaction(client, async () => { throw new Error('boom'); }), /boom/);
    assert.deepEqual(events, ['begin', 'commit', 'begin', 'rollback']);
});
test('postgres support gives a clear error when the Testcontainers runtime is unavailable', async () => {
    const support = createPostgresTestSupport({
        loadContainerFactory: async () => { throw new Error('Cannot find package testcontainers'); },
    });
    await assert.rejects(() => support.start(), (error) => {
        assert.ok(error instanceof TestcontainersUnavailableError);
        assert.match(error.message, /Testcontainers PostgreSQL is unavailable/);
        assert.match(error.message, /pnpm add -D testcontainers/);
        return true;
    });
});
test('postgres support stops a started container exactly once', async () => {
    const events = [];
    const support = createPostgresTestSupport({
        loadContainerFactory: async () => ({
            start: async () => ({
                getConnectionUri: () => 'postgresql://test:test@localhost:5432/test',
                stop: async () => { events.push('stop'); },
            }),
        }),
    });
    const started = await support.start();
    assert.equal(started.connectionUri, 'postgresql://test:test@localhost:5432/test');
    await started.stop();
    await started.stop();
    assert.deepEqual(events, ['stop']);
});
