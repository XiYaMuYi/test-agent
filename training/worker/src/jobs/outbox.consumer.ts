export interface PendingOutboxRecord {
  readonly id: string;
}

export interface OutboxPoller {
  pollPending(): Promise<readonly PendingOutboxRecord[]>;
}

export interface OutboxPollResult {
  readonly scanned: number;
  readonly dispatched: number;
}

/**
 * G1 skeleton for a future transactional-outbox consumer.  It observes the
 * queue but never executes domain work; job dispatch is intentionally deferred
 * until the persistence and job contracts are introduced.
 */
export class OutboxConsumer {
  public constructor(private readonly poller: OutboxPoller) {}

  public async pollOnce(): Promise<OutboxPollResult> {
    const pending = await this.poller.pollPending();

    return { scanned: pending.length, dispatched: 0 };
  }
}
