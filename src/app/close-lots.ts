import { decideClose } from '../domain/auction.js';
import { newEvent } from './events.js';
import type { BidOutcome, Clock, LotUnitOfWork, WriteModel } from './ports.js';

export interface ClosedLot {
  lotId: string;
  winner: string | null;
  finalPrice: number;
}

/**
 * Closing is a command like any other: it is idempotent (`close:<lotId>`), it
 * runs under the same per-lot lock, and it re-reads the deadline from the
 * snapshot. The deadline can have moved since the sweep started because of an
 * anti-snipe extension, and closing early would be unrecoverable.
 */
export class CloseDueLots {
  constructor(
    private readonly uow: LotUnitOfWork,
    private readonly writeModel: WriteModel,
    private readonly clock: Clock,
  ) {}

  async execute(limit = 20): Promise<ClosedLot[]> {
    const now = this.clock.now();
    const due = await this.writeModel.dueLots(now, limit);
    const closed: ClosedLot[] = [];

    for (const lotId of due) {
      const result = await this.uow.run(lotId, async (tx) => {
        const key = `close:${lotId}`;
        if (await tx.findOutcome(key)) return null;

        const state = await tx.loadState();
        const event = decideClose(state, now);
        if (!event) return null;

        const envelopes = await tx.append([newEvent('lot.closed', event)]);
        const first = envelopes[0];
        if (!first) return null;

        const outcome: BidOutcome = {
          ok: true,
          eventId: first.eventId,
          amount: event.finalPrice,
          extended: false,
          endsAt: now,
        };
        await tx.saveOutcome(key, first.eventId, outcome);

        return { lotId, winner: event.winner, finalPrice: event.finalPrice };
      });

      if (result) closed.push(result);
    }

    return closed;
  }
}
