import { applyEnvelopeToState } from '../app/events.js';
import type { LotState } from '../domain/auction.js';
import { config } from '../infra/config.js';
import { createPool } from '../infra/db.js';
import { PostgresEventLog } from '../infra/postgres/log.js';
import { PostgresStore } from '../infra/postgres/store.js';

/**
 * Rebuilds the write-model snapshots from the log and optionally checks that
 * the read model agrees. If this passes, the snapshots and the projection are
 * both provably derived state, not hidden sources of truth.
 */
const pool = createPool(config.databaseUrl, 4);
const log = new PostgresEventLog(pool);
const store = new PostgresStore(pool);
const verify = process.argv.includes('--verify');

try {
  if (!verify) await pool.query('truncate lots');

  const states = new Map<string, LotState | null>();
  let cursor = 0;

  for (;;) {
    const batch = await log.readAfter(cursor, 500);
    if (batch.length === 0) break;
    for (const envelope of batch) {
      states.set(envelope.partition, applyEnvelopeToState(states.get(envelope.partition) ?? null, envelope));
      cursor = envelope.seq;
    }
  }

  const rebuilt = [...states.values()].filter((state): state is LotState => state !== null);
  if (!verify) {
    for (const state of rebuilt) await store.saveLotState(state);
  }

  let mismatches = 0;
  for (const state of rebuilt) {
    const reference = verify ? await pool.query('select * from lot_view where lot_id = $1', [state.lotId]) : null;
    const view = reference?.rows[0];
    if (verify && !view) {
      mismatches += 1;
      console.log(`missing in projection: ${state.lotId}`);
      continue;
    }
    if (verify && view) {
      const viewState = {
        currentPrice: view.current_price,
        leader: view.leader,
        bidCount: view.bid_count,
        status: view.status,
        endsAt: (view.ends_at as Date).getTime(),
        version: view.version,
      };
      const expected = {
        currentPrice: state.currentPrice,
        leader: state.leader,
        bidCount: state.bidCount,
        status: state.status,
        endsAt: state.endsAt,
        version: state.version,
      };
      if (JSON.stringify(viewState) !== JSON.stringify(expected)) {
        mismatches += 1;
        console.log(`mismatch ${state.lotId}`, { expected, viewState });
      }
    }
  }

  console.log(
    verify
      ? `verified ${rebuilt.length} lots, ${mismatches} mismatch(es)`
      : `rebuilt ${rebuilt.length} snapshots from the log`,
  );
  if (verify && mismatches > 0) process.exitCode = 1;
} finally {
  await pool.end();
}
