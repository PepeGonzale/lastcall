import type { Envelope, EventLog, NewEvent } from '../../app/ports.js';
import { withTransaction, type Client, type Pool } from '../db.js';

interface EventRow {
  seq: number;
  event_id: string;
  partition: string;
  position: number;
  type: string;
  payload: unknown;
  occurred_at: Date;
}

function toEnvelope(row: EventRow): Envelope {
  return {
    seq: row.seq,
    eventId: row.event_id,
    partition: row.partition,
    position: row.position,
    type: row.type,
    payload: row.payload,
    occurredAt: row.occurred_at.getTime(),
  };
}

const COLUMNS = 'seq, event_id, partition, position, type, payload, occurred_at';

/**
 * Appends a batch inside an existing transaction. Positions stay dense because
 * the caller holds the per-partition advisory lock. Shared by the standalone
 * log and the command unit of work so both obey identical semantics.
 */
export async function appendWithin(
  client: Client,
  partition: string,
  events: NewEvent[],
): Promise<Envelope[]> {
  const head = await client.query<{ max: number }>(
    'select coalesce(max(position), -1)::bigint as max from events where partition = $1',
    [partition],
  );

  let position = head.rows[0]?.max ?? -1;
  const appended: Envelope[] = [];

  for (const event of events) {
    position += 1;
    const inserted = await client.query<{ seq: number }>(
      `insert into events (event_id, partition, position, type, payload, occurred_at)
       values ($1, $2, $3, $4, $5::jsonb, to_timestamp($6::double precision / 1000))
       returning seq`,
      [event.eventId, partition, position, event.type, JSON.stringify(event.payload), event.occurredAt],
    );
    appended.push({ ...event, partition, position, seq: inserted.rows[0]?.seq ?? -1 });
  }

  return appended;
}

export class PostgresEventLog implements EventLog {
  constructor(private readonly pool: Pool) {}

  async append(partition: string, events: NewEvent[]): Promise<Envelope[]> {
    if (events.length === 0) return [];

    return withTransaction(this.pool, async (client) => {
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [partition]);
      return appendWithin(client, partition, events);
    });
  }

  async readPartition(partition: string, fromPosition = 0): Promise<Envelope[]> {
    const { rows } = await this.pool.query<EventRow>(
      `select ${COLUMNS} from events where partition = $1 and position >= $2 order by position asc`,
      [partition, fromPosition],
    );
    return rows.map(toEnvelope);
  }

  async readAfter(seq: number, limit: number): Promise<Envelope[]> {
    const { rows } = await this.pool.query<EventRow>(
      `select ${COLUMNS} from events where seq > $1 order by seq asc limit $2`,
      [seq, limit],
    );
    return rows.map(toEnvelope);
  }

  async lastSeq(): Promise<number> {
    const { rows } = await this.pool.query<{ seq: number }>(
      'select coalesce(max(seq), 0)::bigint as seq from events',
    );
    return rows[0]?.seq ?? 0;
  }

  async count(): Promise<number> {
    const { rows } = await this.pool.query<{ count: number }>('select count(*)::bigint as count from events');
    return rows[0]?.count ?? 0;
  }
}
