import type {
  BidOutcome,
  Envelope,
  LotTransaction,
  LotUnitOfWork,
  NewEvent,
} from '../../app/ports.js';
import type { LotState } from '../../domain/auction.js';
import type { Client, Pool } from '../db.js';
import { withTransaction } from '../db.js';
import { applyEnvelopeToState } from '../../app/events.js';
import { appendWithin } from './log.js';
import { saveLotStateWithin, rowToState, type LotRow } from './store.js';

/**
 * One lot, one lock, one transaction.
 *
 * `pg_advisory_xact_lock` is the serialisation point for a lot's command
 * stream. Without it, two bids could both validate against price 100 and both
 * commit, leaving a price of 105 that nobody actually offered.
 */
export class PostgresLotUnitOfWork implements LotUnitOfWork {
  constructor(private readonly pool: Pool) {}

  async run<T>(lotId: string, work: (tx: LotTransaction) => Promise<T>): Promise<T> {
    return withTransaction(this.pool, async (client) => {
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [lotId]);
      return work(new PostgresLotTransaction(client, lotId));
    });
  }
}

class PostgresLotTransaction implements LotTransaction {
  private cachedState: LotState | null | undefined;

  constructor(
    private readonly client: Client,
    private readonly lotId: string,
  ) {}

  /**
   * Reads the snapshot, not the projection. The projection is allowed to lag;
   * a command decision is not.
   */
  async loadState(): Promise<LotState | null> {
    if (this.cachedState !== undefined) return this.cachedState;
    const { rows } = await this.client.query<LotRow>('select * from lots where lot_id = $1', [this.lotId]);
    this.cachedState = rows[0] ? rowToState(rows[0]) : null;
    return this.cachedState;
  }

  /**
   * Appending the events and moving the snapshot forward are the same write.
   * A committed event without its snapshot (or vice versa) is not a state this
   * system can be observed in.
   */
  async append(events: NewEvent[]): Promise<Envelope[]> {
    const envelopes = await appendWithin(this.client, this.lotId, events);
    let state = await this.loadState();
    for (const envelope of envelopes) {
      state = applyEnvelopeToState(state, envelope);
    }
    const last = envelopes.at(-1);
    if (state && last) {
      await saveLotStateWithin(this.client, 'lots', state, last.position);
      this.cachedState = state;
    }
    return envelopes;
  }

  async findOutcome(key: string): Promise<BidOutcome | null> {
    const { rows } = await this.client.query<{ outcome: BidOutcome }>(
      'select outcome from idempotency where key = $1',
      [key],
    );
    return rows[0]?.outcome ?? null;
  }

  async saveOutcome(key: string, eventId: string | null, outcome: BidOutcome): Promise<void> {
    await this.client.query(
      `insert into idempotency (key, event_id, outcome) values ($1, $2, $3::jsonb)
       on conflict (key) do nothing`,
      [key, eventId, JSON.stringify(outcome)],
    );
  }

  async recordRejection(bidder: string, amount: number, reason: string): Promise<void> {
    await this.client.query(
      'insert into rejections (lot_id, bidder, amount, reason) values ($1, $2, $3, $4)',
      [this.lotId, bidder, amount, reason],
    );
  }
}
