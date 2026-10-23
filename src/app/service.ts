import type { AuctionRules } from '../domain/auction.js';
import { CloseDueLots } from './close-lots.js';
import type { Clock, EventLog, LotUnitOfWork, ReadModelReader, WriteModel } from './ports.js';
import { PlaceBid, type PlaceBidInput } from './place-bid.js';
import type { Projector } from './projector.js';
import { ReplayLog, type Timeline } from './replay.js';

export interface AuctionDeps {
  rules: AuctionRules;
  clock: Clock;
  log: EventLog;
  uow: LotUnitOfWork;
  writeModel: WriteModel;
  readModel: ReadModelReader;
  projector: Projector;
  closeDueLots: CloseDueLots;
  replay: ReplayLog;
}

/**
 * Thin application facade. Routes get behaviour, not SQL, and tests can drive
 * the same surface the HTTP layer does.
 */
export class AuctionService {
  readonly placeBid: PlaceBid;
  readonly closeDueLots: CloseDueLots;
  readonly replay: ReplayLog;

  constructor(readonly deps: AuctionDeps) {
    this.placeBid = new PlaceBid(deps.uow, deps.rules, deps.clock);
    this.closeDueLots = deps.closeDueLots;
    this.replay = deps.replay;
  }

  bid(input: PlaceBidInput) {
    return this.placeBid.execute(input);
  }

  timeline(lotId: string, until?: number): Promise<Timeline> {
    return this.replay.timeline(lotId, until);
  }

  /**
   * Chaos only: appends an event the domain cannot accept. The producer
   * contract is bypassed on purpose to prove the consumer survives a bad row.
   */
  injectPoison(lotId: string): Promise<number> {
    return this.deps.log
      .append(lotId, [
        {
          eventId: crypto.randomUUID(),
          type: 'bid.placed',
          payload: { lotId, bidder: 'ghost' },
          occurredAt: Date.now(),
        },
      ])
      .then((envelopes) => envelopes[0]?.position ?? -1);
  }

  async stats() {
    const counters = await this.deps.readModel.counters();
    const projector = await this.deps.projector.status();
    return {
      ...counters,
      head: await this.deps.log.lastSeq(),
      projector,
      offsets: await this.deps.projector.offsets(),
      rules: this.deps.rules,
    };
  }
}
