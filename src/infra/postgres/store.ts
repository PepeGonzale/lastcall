import type { LotState } from '../../domain/auction.js';
import type {
  BidRow,
  Envelope,
  ProjectionChange,
  ProjectionStore,
  ReadModelReader,
  WriteModel,
} from '../../app/ports.js';
import { withTransaction, type Pool } from '../db.js';

export interface LotRow {
  lot_id: string;
  title: string;
  start_price: number;
  min_increment: number;
  current_price: number;
  leader: string | null;
  bid_count: number;
  ends_at: Date;
  status: string;
  extension_count: number;
  version: number;
}

export function rowToState(row: LotRow): LotState {
  return {
    lotId: row.lot_id,
    title: row.title,
    startPrice: row.start_price,
    minIncrement: row.min_increment,
    currentPrice: row.current_price,
    leader: row.leader,
    bidCount: row.bid_count,
    endsAt: row.ends_at.getTime(),
    status: row.status === 'closed' ? 'closed' : 'open',
    extensionCount: row.extension_count,
    version: row.version,
  };
}

const UPSERT = `
  insert into {table} (
    lot_id, title, start_price, min_increment, current_price, leader,
    bid_count, ends_at, status, extension_count, version, updated_at
  ) values (
    $1, $2, $3, $4, $5, $6, $7,
    to_timestamp($8::double precision / 1000), $9, $10, $11, now()
  )
  on conflict (lot_id) do update set
    title = excluded.title,
    start_price = excluded.start_price,
    min_increment = excluded.min_increment,
    current_price = excluded.current_price,
    leader = excluded.leader,
    bid_count = excluded.bid_count,
    ends_at = excluded.ends_at,
    status = excluded.status,
    extension_count = excluded.extension_count,
    version = excluded.version,
    updated_at = now()
`;

function upsertParams(state: LotState, position: number): unknown[] {
  return [
    state.lotId,
    state.title,
    state.startPrice,
    state.minIncrement,
    state.currentPrice,
    state.leader,
    state.bidCount,
    state.endsAt,
    state.status,
    state.extensionCount,
    position,
  ];
}

export class PostgresStore implements WriteModel, ProjectionStore {
  constructor(private readonly pool: Pool) {}

  // --- write model --------------------------------------------------------

  async getLotState(lotId: string): Promise<LotState | null> {
    const { rows } = await this.pool.query<LotRow>('select * from lots where lot_id = $1', [lotId]);
    const row = rows[0];
    return row ? rowToState(row) : null;
  }

  async saveLotState(state: LotState): Promise<void> {
    await this.pool.query(UPSERT.replace('{table}', 'lots'), upsertParams(state, state.version));
  }

  async dueLots(now: number, limit: number): Promise<string[]> {
    return dueLotsWithin(this.pool, now, limit);
  }

  // --- read model ---------------------------------------------------------

  async loadCursor(consumer: string): Promise<number> {
    const { rows } = await this.pool.query<{ seq: number }>(
      'select seq from consumer_cursor where consumer = $1',
      [consumer],
    );
    return rows[0]?.seq ?? 0;
  }

  async lastPosition(consumer: string, partition: string): Promise<number> {
    const { rows } = await this.pool.query<{ position: number }>(
      'select position from consumer_offsets where consumer = $1 and partition = $2',
      [consumer, partition],
    );
    return rows[0]?.position ?? -1;
  }

  /**
   * The inbox insert and the projection write share one transaction. That is
   * the whole idempotent-consumer trick: at-least-once delivery becomes
   * exactly-once *effects*, because the effect cannot commit without the
   * dedupe record and vice versa.
   */
  async applyEvent(
    consumer: string,
    envelope: Envelope,
    project: (current: LotState | null) => ProjectionChange,
  ): Promise<'applied' | 'duplicate'> {
    return withTransaction(this.pool, async (client) => {
      const inbox = await client.query(
        `insert into inbox (consumer, event_id, partition, position)
         values ($1, $2, $3, $4) on conflict (consumer, event_id) do nothing
         returning event_id`,
        [consumer, envelope.eventId, envelope.partition, envelope.position],
      );

      if (inbox.rowCount === 0) {
        await client.query(
          `insert into metrics (name, value) values ('inbox.duplicates', 1)
           on conflict (name) do update set value = metrics.value + 1`,
        );
        return 'duplicate' as const;
      }

      const current = await client.query<LotRow>('select * from lot_view where lot_id = $1', [envelope.partition]);
      const change = project(current.rows[0] ? rowToState(current.rows[0]) : null);

      await client.query(UPSERT.replace('{table}', 'lot_view'), upsertParams(change.state, envelope.position));

      if (change.bid) {
        await client.query(
          `insert into bid_history (event_id, lot_id, bidder, amount, position, at)
           values ($1, $2, $3, $4, $5, to_timestamp($6::double precision / 1000))
           on conflict (event_id) do nothing`,
          [
            change.bid.eventId,
            change.bid.lotId,
            change.bid.bidder,
            change.bid.amount,
            envelope.position,
            change.bid.at,
          ],
        );
      }

      await client.query(
        `insert into consumer_cursor (consumer, seq, updated_at)
         values ($1, $2, now())
         on conflict (consumer) do update
           set seq = greatest(consumer_cursor.seq, excluded.seq),
               updated_at = now()`,
        [consumer, envelope.seq],
      );

      await client.query(
        `insert into consumer_offsets (consumer, partition, position, updated_at)
         values ($1, $2, $3, now())
         on conflict (consumer, partition) do update
           set position = greatest(consumer_offsets.position, excluded.position),
               updated_at = now()`,
        [consumer, envelope.partition, envelope.position],
      );

      return 'applied' as const;
    });
  }

  async recordGap(consumer: string, partition: string, expected: number, received: number): Promise<void> {
    await this.pool.query(
      'insert into projector_gaps (consumer, partition, expected, received) values ($1, $2, $3, $4)',
      [consumer, partition, expected, received],
    );
    await this.pool.query(
      `insert into metrics (name, value) values ('projector.gaps', 1)
       on conflict (name) do update set value = metrics.value + 1`,
    );
  }

  async deadLetter(consumer: string, envelope: Envelope, error: string): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      await client.query(
        `insert into dead_letters (consumer, event_id, partition, position, error, payload)
         values ($1, $2, $3, $4, $5, $6::jsonb)`,
        [consumer, envelope.eventId, envelope.partition, envelope.position, error, JSON.stringify(envelope.payload)],
      );
      await client.query(
        `insert into consumer_cursor (consumer, seq, updated_at) values ($1, $2, now())
         on conflict (consumer) do update
           set seq = greatest(consumer_cursor.seq, excluded.seq), updated_at = now()`,
        [consumer, envelope.seq],
      );
      await client.query(
        `insert into consumer_offsets (consumer, partition, position, updated_at)
         values ($1, $2, $3, now())
         on conflict (consumer, partition) do update
           set position = greatest(consumer_offsets.position, excluded.position), updated_at = now()`,
        [consumer, envelope.partition, envelope.position],
      );
      await client.query(
        `insert into metrics (name, value) values ('projector.deadLetters', 1)
         on conflict (name) do update set value = metrics.value + 1`,
      );
    });
  }

  async offsets(consumer: string): Promise<{ partition: string; position: number; head: number }[]> {
    const { rows } = await this.pool.query<{ partition: string; position: number; head: number }>(
      `select e.partition,
              coalesce(o.position, -1) as position,
              max(e.position) as head
         from events e
         left join consumer_offsets o
                on o.consumer = $1 and o.partition = e.partition
        group by e.partition, o.position
        order by e.partition`,
      [consumer],
    );
    return rows;
  }

  async resetProjection(): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      await client.query('truncate lot_view, bid_history, inbox, consumer_offsets, consumer_cursor');
      await client.query(`delete from metrics where name in ('inbox.duplicates', 'projector.gaps')`);
      await client.query(
        `insert into metrics (name, value) values ('projection.resets', 1)
         on conflict (name) do update set value = metrics.value + 1`,
      );
    });
  }

  /** Demo reset: wipes the log too. Nothing survives, including the metrics. */
  async resetAll(): Promise<void> {
    await this.pool.query(`
      truncate events, idempotency, inbox, consumer_offsets, consumer_cursor, lots,
               lot_view, bid_history, rejections, projector_gaps, dead_letters, metrics
      restart identity
    `);
  }

  async getMetric(name: string): Promise<number> {
    const { rows } = await this.pool.query<{ value: number }>('select value from metrics where name = $1', [name]);
    return rows[0]?.value ?? 0;
  }
}

/** Writes a snapshot using a client owned by an outer transaction. */
export async function saveLotStateWithin(
  client: import('../db.js').Client,
  table: 'lots' | 'lot_view',
  state: LotState,
  position: number,
): Promise<void> {
  await client.query(UPSERT.replace('{table}', table), upsertParams(state, position));
}

export class PostgresReadModel implements ReadModelReader {
  constructor(private readonly pool: Pool) {}

  async listLots(): Promise<LotState[]> {
    const { rows } = await this.pool.query<LotRow>(
      'select * from lot_view order by updated_at desc, lot_id asc',
    );
    return rows.map(rowToState);
  }

  async getLot(lotId: string): Promise<LotState | null> {
    const { rows } = await this.pool.query<LotRow>('select * from lot_view where lot_id = $1', [lotId]);
    const row = rows[0];
    return row ? rowToState(row) : null;
  }

  async listBids(lotId: string, limit: number): Promise<BidRow[]> {
    const { rows } = await this.pool.query<{
      event_id: string;
      lot_id: string;
      bidder: string;
      amount: number;
      position: number;
      at: Date;
    }>(
      `select event_id, lot_id, bidder, amount, position, at
         from bid_history where lot_id = $1
        order by position desc limit $2`,
      [lotId, limit],
    );
    return rows.map((row) => ({
      eventId: row.event_id,
      lotId: row.lot_id,
      bidder: row.bidder,
      amount: row.amount,
      position: row.position,
      at: row.at.getTime(),
    }));
  }

  async listRejections(lotId: string, limit: number) {
    const { rows } = await this.pool.query<{
      bidder: string;
      amount: number;
      reason: string;
      at: Date;
    }>(
      `select bidder, amount, reason, at from rejections
        where lot_id = $1 order by id desc limit $2`,
      [lotId, limit],
    );
    return rows.map((row) => ({ ...row, at: row.at.getTime() }));
  }

  async counters() {
    const { rows } = await this.pool.query<{
      events: number;
      bids: number;
      rejections: number;
      lots: number;
    }>(`
      select
        (select count(*)::bigint from events)      as events,
        (select count(*)::bigint from bid_history) as bids,
        (select count(*)::bigint from rejections)  as rejections,
        (select count(*)::bigint from lot_view)    as lots
    `);
    const row = rows[0];
    const metrics = await this.pool.query<{ name: string; value: number }>(
      `select name, value from metrics where name in
        ('inbox.duplicates', 'projector.gaps', 'projection.resets', 'projector.deadLetters')`,
    );
    const byName = new Map(metrics.rows.map((metric) => [metric.name, metric.value]));
    return {
      events: row?.events ?? 0,
      bids: row?.bids ?? 0,
      rejections: row?.rejections ?? 0,
      lots: row?.lots ?? 0,
      duplicateDeliveries: byName.get('inbox.duplicates') ?? 0,
      gaps: byName.get('projector.gaps') ?? 0,
      projectionResets: byName.get('projection.resets') ?? 0,
      deadLetters: byName.get('projector.deadLetters') ?? 0,
    };
  }
}

/** Due lots are read from the snapshot: a lagging projection could miss a close. */
export async function dueLotsWithin(pool: Pool, now: number, limit: number): Promise<string[]> {
  const { rows } = await pool.query<{ lot_id: string }>(
    `select lot_id from lots
      where status = 'open' and ends_at <= to_timestamp($1::double precision / 1000)
      order by ends_at asc limit $2`,
    [now, limit],
  );
  return rows.map((row) => row.lot_id);
}
