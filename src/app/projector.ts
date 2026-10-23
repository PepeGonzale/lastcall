import type { EventLog, Envelope, Notifier, ProjectionChange, ProjectionStore } from './ports.js';
import { isPoisonEventError, projectionFor } from './events.js';
import { serializeLot } from './views.js';

export class GapError extends Error {
  constructor(
    readonly partition: string,
    readonly expected: number,
    readonly received: number,
  ) {
    super(`gap on ${partition}: expected position ${expected}, received ${received}`);
    this.name = 'GapError';
  }
}

export interface ProjectorOptions {
  consumer: string;
  pollMs: number;
  batchSize: number;
}

/**
 * At-least-once projector with two guards that most event-driven demos skip:
 *
 * 1. **Contiguity.** Positions inside a partition must arrive in order. A gap
 *    is louder than a wrong auction price, so it is recorded and refused.
 * 2. **Idempotency.** A redelivery of an already-applied position is not a
 *    gap: positions at or below the watermark are allowed through and the
 *    inbox decides (and drops) the duplicate.
 */
export class Projector {
  cursor = 0;
  applied = 0;
  duplicates = 0;
  gaps = 0;
  deadLetters = 0;
  lastError: string | null = null;

  private running = false;
  private paused = false;
  private lagMs = 0;
  private busy = false;
  private loopPromise: Promise<void> | null = null;

  constructor(
    private readonly log: EventLog,
    private readonly store: ProjectionStore,
    private readonly notify: Notifier,
    readonly options: ProjectorOptions,
  ) {}

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    // Resume from the cursor committed with the last applied event. Replaying
    // from zero is also safe (the inbox dedupes), but a restart should not look
    // like a flood of duplicates in the counters.
    this.cursor = await this.store.loadCursor(this.options.consumer);
    this.loopPromise = this.loop();
    this.notify({ type: 'projector', ...(await this.status()) });
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.loopPromise;
    this.loopPromise = null;
    this.notify({ type: 'projector', ...(await this.status()) });
  }

  setLag(ms: number): void {
    this.lagMs = Math.max(0, ms);
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  offsets() {
    return this.store.offsets(this.options.consumer);
  }

  async status() {
    return {
      consumer: this.options.consumer,
      cursor: this.cursor,
      applied: this.applied,
      duplicates: this.duplicates,
      gaps: this.gaps,
      deadLetters: this.deadLetters,
      paused: this.paused,
      lagMs: this.lagMs,
      running: this.running,
      lastError: this.lastError,
    };
  }

  async tick(): Promise<number> {
    const batch = await this.log.readAfter(this.cursor, this.options.batchSize);
    if (batch.length === 0) return 0;

    this.busy = true;
    let appliedNow = 0;
    try {
      for (const envelope of batch) {
        try {
          const result = await this.applyOne(envelope);
          if (result === 'applied') appliedNow += 1;
        } catch (error) {
          if (error instanceof GapError) {
            this.lastError = error.message;
          } else if (isPoisonEventError(error)) {
            const reason = error instanceof Error ? error.message : String(error);
            await this.store.deadLetter(this.options.consumer, envelope, reason);
            this.deadLetters += 1;
            this.lastError = `parked ${envelope.partition}#${envelope.position}: ${reason}`;
            this.notify({
              type: 'dead-letter',
              partition: envelope.partition,
              position: envelope.position,
              reason,
              at: Date.now(),
            });
            // Progress: the partition is acknowledged even though nothing was
            // applied, so the rest of the batch is not blocked behind it.
            appliedNow += 1;
          } else {
            throw error;
          }
        }
        this.cursor = envelope.seq;
      }
    } finally {
      this.busy = false;
    }

    if (appliedNow > 0) {
      this.notify({
        type: 'projector',
        ...(await this.status()),
        offsets: await this.store.offsets(this.options.consumer),
      });
    }
    return appliedNow;
  }

  async applyOne(envelope: Envelope): Promise<'applied' | 'duplicate'> {
    const expected = await this.store.lastPosition(this.options.consumer, envelope.partition);

    if (envelope.position > expected + 1) {
      this.gaps += 1;
      await this.store.recordGap(
        this.options.consumer,
        envelope.partition,
        expected + 1,
        envelope.position,
      );
      this.notify({
        type: 'gap',
        partition: envelope.partition,
        expected: expected + 1,
        received: envelope.position,
        at: Date.now(),
      });
      throw new GapError(envelope.partition, expected + 1, envelope.position);
    }

    let change: ProjectionChange | undefined;
    const result = await this.store.applyEvent(this.options.consumer, envelope, (current) => {
      change = projectionFor(current, envelope);
      return change;
    });

    if (result === 'duplicate') {
      this.duplicates += 1;
      return 'duplicate';
    }

    this.applied += 1;
    if (change) this.emit(envelope, change);
    return 'applied';
  }

  /** Chaos: re-deliver the newest event of a lot, exactly as a broker might. */
  async redeliverLatest(
    partition: string,
  ): Promise<{ eventId: string; position: number; result: 'applied' | 'duplicate' } | null> {
    const events = await this.log.readPartition(partition);
    const target = events.at(-1);
    if (!target) return null;

    const result = await this.applyOne(target);
    this.notify({ type: 'chaos', action: 'redeliver', partition, result, position: target.position });
    return { eventId: target.eventId, position: target.position, result };
  }

  /** Chaos: deliver a future position first. The guard must refuse it. */
  async deliverOutOfOrder(partition: string): Promise<{ detected: boolean; expected: number; received: number }> {
    const events = await this.log.readPartition(partition);
    const last = events.at(-1);
    const expected = await this.store.lastPosition(this.options.consumer, partition);
    if (!last) return { detected: false, expected: expected + 1, received: expected + 1 };

    const forged: Envelope = { ...last, position: last.position + 3 };
    try {
      await this.applyOne(forged);
      return { detected: false, expected: expected + 1, received: forged.position };
    } catch (error) {
      if (!(error instanceof GapError)) throw error;
      this.notify({ type: 'chaos', action: 'reorder', partition, expected: error.expected, received: error.received });
      return { detected: true, expected: error.expected, received: error.received };
    }
  }

  /**
   * Forgets the cursor after a full wipe. The caller is expected to hold the
   * projector paused, seed the log and catch up, so the background loop cannot
   * race the synchronous catch-up and inflate the duplicate counter.
   */
  resetState(): void {
    this.cursor = 0;
    this.applied = 0;
    this.duplicates = 0;
    this.gaps = 0;
    this.deadLetters = 0;
    this.lastError = null;
  }

  async publishStatus(): Promise<void> {
    this.notify({ type: 'projector', ...(await this.status()) });
  }

  /**
   * Drops the read model and rebuilds it from the log. The log is untouched.
   * It catches up before returning: a caller that rebuilds and then reads must
   * not see a half-empty projection.
   */
  async rebuild(): Promise<void> {
    this.paused = true;
    await this.waitIdle();
    await this.store.resetProjection(this.options.consumer);
    this.cursor = 0;
    this.applied = 0;
    this.duplicates = 0;
    this.gaps = 0;
    this.deadLetters = 0;
    this.lastError = null;
    await this.catchUpNow();
    this.paused = false;
    this.notify({ type: 'chaos', action: 'rebuild', at: Date.now(), ...(await this.status()) });
  }

  /** Applies everything currently in the log, synchronously. */
  async catchUpNow(): Promise<void> {
    for (let round = 0; round < 200; round += 1) {
      const applied = await this.tick();
      if (applied === 0) return;
    }
  }

  private async waitIdle(): Promise<void> {
    while (this.busy) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  private emit(envelope: Envelope, change: ProjectionChange): void {
    const lot = serializeLot(change.state);
    if (change.bid) {
      this.notify({
        type: 'bid.placed',
        lotId: change.bid.lotId,
        bidder: change.bid.bidder,
        amount: change.bid.amount,
        amountLabel: lot.currentPriceLabel,
        at: change.bid.at,
        position: envelope.position,
        lot,
      });
    }
    if (envelope.type === 'lot.extended') {
      this.notify({ type: 'lot.extended', lotId: lot.lotId, endsAt: lot.endsAt, lot });
    }
    if (envelope.type === 'lot.closed') {
      this.notify({ type: 'lot.closed', lotId: lot.lotId, winner: lot.leader, finalPrice: lot.currentPrice, lot });
    }
    this.notify({ type: 'lot.updated', lot });
  }

  private async loop(): Promise<void> {
    while (this.running) {
      if (this.paused) {
        await sleep(20);
        continue;
      }
      try {
        const appliedNow = await this.tick();
        if (this.lagMs > 0) await sleep(this.lagMs);
        if (appliedNow === 0) await sleep(this.options.pollMs);
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error);
        await sleep(250);
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
