/**
 * G1 skeleton for a future transactional-outbox consumer.  It observes the
 * queue but never executes domain work; job dispatch is intentionally deferred
 * until the persistence and job contracts are introduced.
 */
export class OutboxConsumer {
    poller;
    constructor(poller) {
        this.poller = poller;
    }
    async pollOnce() {
        const pending = await this.poller.pollPending();
        return { scanned: pending.length, dispatched: 0 };
    }
}
