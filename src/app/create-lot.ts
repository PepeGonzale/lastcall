import type { AuctionEvent } from '../domain/auction.js';
import { newEvent } from './events.js';
import type { Clock, LotUnitOfWork } from './ports.js';
import { serializeLot, type LotView } from './views.js';

export interface CreateLotInput {
  lotId: string;
  title: string;
  startPrice: number;
  minIncrement: number;
  endsAt: number;
}

export class CreateLot {
  constructor(
    private readonly uow: LotUnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(input: CreateLotInput): Promise<LotView | null> {
    return this.uow.run(input.lotId, async (tx) => {
      const existing = await tx.loadState();
      if (existing) return serializeLot(existing);

      const event: AuctionEvent = {
        type: 'lot.opened',
        lotId: input.lotId,
        title: input.title,
        startPrice: input.startPrice,
        minIncrement: input.minIncrement,
        endsAt: input.endsAt,
        at: this.clock.now(),
      };

      const envelopes = await tx.append([newEvent('lot.opened', event)]);
      if (!envelopes.length) return null;

      const state = await tx.loadState();
      return state ? serializeLot(state) : null;
    });
  }
}
