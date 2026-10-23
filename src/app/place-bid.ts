import { decideBid, type AuctionRules, type LotExtended, type LotState } from '../domain/auction.js';
import { newEvent } from './events.js';
import type { BidOutcome, Clock, Envelope, LotUnitOfWork } from './ports.js';

export interface PlaceBidInput {
  lotId: string;
  bidder: string;
  amount: number;
  /**
   * Client-supplied. A retried HTTP request must not place a second bid, and
   * the retry must return the first answer instead of a different one.
   */
  idempotencyKey: string;
}

export interface PlaceBidResult {
  outcome: BidOutcome;
  duplicate: boolean;
  envelopes: Envelope[];
}

export class PlaceBid {
  constructor(
    private readonly uow: LotUnitOfWork,
    private readonly rules: AuctionRules,
    private readonly clock: Clock,
  ) {}

  async execute(input: PlaceBidInput): Promise<PlaceBidResult> {
    const now = this.clock.now();

    return this.uow.run(input.lotId, async (tx) => {
      const previous = await tx.findOutcome(input.idempotencyKey);
      if (previous) {
        return { outcome: previous, duplicate: true, envelopes: [] };
      }

      const state = await tx.loadState();
      const decision = decideBid(
        state,
        {
          lotId: input.lotId,
          bidId: input.idempotencyKey,
          bidder: input.bidder,
          amount: input.amount,
          now,
        },
        this.rules,
      );

      if (!decision.ok) {
        const outcome: BidOutcome =
          decision.minimum !== undefined
            ? { ok: false, reason: decision.reason, minimum: decision.minimum }
            : { ok: false, reason: decision.reason };
        await tx.recordRejection(input.bidder, input.amount, decision.reason);
        await tx.saveOutcome(input.idempotencyKey, null, outcome);
        return { outcome, duplicate: false, envelopes: [] };
      }

      const envelopes = await tx.append(decision.events.map((event) => newEvent(event.type, event)));
      const extension = decision.events.find((event): event is LotExtended => event.type === 'lot.extended');
      const accepted = state as LotState;
      const first = envelopes[0];

      if (!first) throw new Error('an accepted bid must produce at least one event');

      const outcome: BidOutcome = {
        ok: true,
        eventId: first.eventId,
        amount: input.amount,
        extended: decision.extended,
        endsAt: extension ? extension.endsAt : accepted.endsAt,
      };
      await tx.saveOutcome(input.idempotencyKey, first.eventId, outcome);

      return { outcome, duplicate: false, envelopes };
    });
  }
}
