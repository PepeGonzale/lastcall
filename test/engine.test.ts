import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, beforeEach, describe, it } from 'node:test';
import { CloseDueLots } from '../src/app/close-lots.js';
import { CreateLot } from '../src/app/create-lot.js';
import { fold, type LotState } from '../src/domain/auction.js';
import { PlaceBid } from '../src/app/place-bid.js';
import { Projector, GapError } from '../src/app/projector.js';
import { ReplayLog } from '../src/app/replay.js';
import { ManualClock } from '../src/infra/clock.js';
import { createPool, migrate, type Pool } from '../src/infra/db.js';
import { PostgresEventLog } from '../src/infra/postgres/log.js';
import { PostgresReadModel, PostgresStore } from '../src/infra/postgres/store.js';
import { PostgresLotUnitOfWork } from '../src/infra/postgres/uow.js';

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/lastcall_test';
const RULES = { snipeWindowMs: 10_000, extensionMs: 15_000 };
const T0 = Date.parse('2026-03-01T10:00:00.000Z');

const TRUNCATE = `
  truncate events, idempotency, inbox, consumer_offsets, consumer_cursor, lots,
           lot_view, bid_history, rejections, projector_gaps, dead_letters, metrics
  restart identity
`;

interface Harness {
  pool: Pool;
  clock: ManualClock;
  log: PostgresEventLog;
  store: PostgresStore;
  readModel: PostgresReadModel;
  uow: PostgresLotUnitOfWork;
  projector: Projector;
  closeDueLots: CloseDueLots;
  createLot: CreateLot;
  placeBid: PlaceBid;
  replay: ReplayLog;
  broadcasts: Record<string, unknown>[];
}

let harness: Harness;
let pool: Pool;

async function setup(): Promise<Harness> {
  if (!pool) {
    pool = createPool(DATABASE_URL, 20);
    await migrate(pool);
  }
  await pool.query(TRUNCATE);

  const clock = new ManualClock(T0);
  const log = new PostgresEventLog(pool);
  const store = new PostgresStore(pool);
  const readModel = new PostgresReadModel(pool);
  const uow = new PostgresLotUnitOfWork(pool);
  const broadcasts: Record<string, unknown>[] = [];

  const projector = new Projector(log, store, (message) => broadcasts.push(message), {
    consumer: 'lot-projection',
    pollMs: 5,
    batchSize: 500,
  });

  harness = {
    pool,
    clock,
    log,
    store,
    readModel,
    uow,
    projector,
    closeDueLots: new CloseDueLots(uow, store, clock),
    createLot: new CreateLot(uow, clock),
    placeBid: new PlaceBid(uow, RULES, clock),
    replay: new ReplayLog(log),
    broadcasts,
  };
  return harness;
}

async function openLot(overrides: Partial<{ lotId: string; startPrice: number; minIncrement: number; endsAt: number }> = {}) {
  const lot = {
    lotId: 'lot-1',
    title: 'Omega Speedmaster 145.022',
    startPrice: 100_000,
    minIncrement: 5_000,
    endsAt: T0 + 60_000,
    ...overrides,
  };
  await harness.createLot.execute(lot);
  return lot;
}

function bid(bidder: string, amount: number, key = `${bidder}-${amount}`) {
  return harness.placeBid.execute({ lotId: 'lot-1', bidder, amount, idempotencyKey: key });
}

async function foldFromLog(lotId = 'lot-1'): Promise<LotState> {
  const events = await harness.log.readPartition(lotId);
  const state = fold(events.map((event) => event.payload as never));
  assert.ok(state, 'log must fold to a state');
  return state;
}

/** The write model is a cache of the log. If it ever disagrees, commands lie. */
async function assertSnapshotMatchesLog(lotId = 'lot-1'): Promise<void> {
  const fromLog = await foldFromLog(lotId);
  const snapshot = await harness.store.getLotState(lotId);
  assert.ok(snapshot);
  assert.deepEqual(
    { price: snapshot.currentPrice, leader: snapshot.leader, bids: snapshot.bidCount, endsAt: snapshot.endsAt, status: snapshot.status },
    { price: fromLog.currentPrice, leader: fromLog.leader, bids: fromLog.bidCount, endsAt: fromLog.endsAt, status: fromLog.status },
  );
}

async function drain(): Promise<number> {
  let total = 0;
  for (let i = 0; i < 20; i += 1) {
    const applied = await harness.projector.tick();
    total += applied;
    if (applied === 0) break;
  }
  return total;
}

beforeEach(async () => {
  await setup();
});

describe('idempotent commands', () => {
  it('a retried bid places one bid and returns the original answer', async () => {
    await openLot();

    const first = await harness.placeBid.execute({
      lotId: 'lot-1',
      bidder: 'ana',
      amount: 100_000,
      idempotencyKey: 'retry-me',
    });
    const second = await harness.placeBid.execute({
      lotId: 'lot-1',
      bidder: 'ana',
      amount: 100_000,
      idempotencyKey: 'retry-me',
    });

    assert.equal(first.outcome.ok, true);
    assert.equal(first.duplicate, false);
    assert.equal(second.duplicate, true);
    assert.deepEqual(second.outcome, first.outcome);

    const events = await harness.log.readPartition('lot-1');
    const bids = events.filter((event) => event.type === 'bid.placed');
    assert.equal(bids.length, 1, 'a retried request must not place a second bid');

    const state = await foldFromLog();
    assert.equal(state.currentPrice, 100_000);
    assert.equal(state.bidCount, 1);
  });

  it('a retried rejected bid does not create duplicate rejection rows', async () => {
    await openLot();
    const first = await bid('ana', 50_000, 'too-low');
    const second = await bid('ana', 50_000, 'too-low');

    assert.equal(first.outcome.ok, false);
    assert.equal(second.duplicate, true);
    const rejections = await harness.readModel.listRejections('lot-1', 10);
    assert.equal(rejections.length, 1);
  });
});

describe('concurrency and ordering', () => {
  it('25 simultaneous bids at the same price: exactly one wins', async () => {
    await openLot();

    const results = await Promise.all(
      Array.from({ length: 25 }, (_, index) => bid(`bidder-${index}`, 100_000, `race-${index}`)),
    );

    const accepted = results.filter((result) => result.outcome.ok);
    const refused = results.filter((result) => !result.outcome.ok);

    assert.equal(accepted.length, 1, 'the advisory lock must serialise the command stream');
    assert.equal(refused.length, 24);
    for (const result of refused) {
      assert.equal(result.outcome.ok === false && result.outcome.reason, 'below_minimum');
    }

    const state = await foldFromLog();
    assert.equal(state.bidCount, 1);
    assert.equal(state.currentPrice, 100_000, 'the price must be a bid somebody actually made');
    await assertSnapshotMatchesLog();
  });

  it('keeps positions dense and ordered under sequential load', async () => {
    await openLot();
    for (let index = 0; index < 10; index += 1) {
      const result = await bid(`bidder-${index}`, 100_000 + index * 5_000, `seq-${index}`);
      assert.equal(result.outcome.ok, true);
    }

    const events = await harness.log.readPartition('lot-1');
    assert.deepEqual(
      events.map((event) => event.position),
      Array.from({ length: 11 }, (_, index) => index),
      'no holes, no duplicates: positions are 0..10',
    );
    assert.equal(events.filter((event) => event.type === 'bid.placed').length, 10);
    await assertSnapshotMatchesLog();
  });
});

describe('anti-snipe', () => {
  it('extends the deadline and commits bid + extension atomically', async () => {
    await openLot();
    harness.clock.set(T0 + 55_000);

    const result = await bid('ana', 100_000, 'snipe');

    assert.equal(result.outcome.ok, true);
    assert.equal(result.outcome.ok && result.outcome.extended, true);
    assert.equal(result.envelopes.length, 2, 'bid and extension land in one append');
    assert.deepEqual(
      result.envelopes.map((envelope) => envelope.type),
      ['bid.placed', 'lot.extended'],
    );

    const state = await foldFromLog();
    assert.equal(state.endsAt, T0 + 55_000 + 15_000);
    assert.equal(state.extensionCount, 1);

    const closedEarly = await harness.closeDueLots.execute();
    assert.equal(closedEarly.length, 0, 'the auction must not close on the old deadline');
  });

  it('a bid after the extended deadline is refused, not silently applied', async () => {
    await openLot();
    harness.clock.set(T0 + 55_000);
    await bid('ana', 100_000, 'snipe');

    // The extension moved the deadline to T0 + 70_000; the old deadline no
    // longer has any meaning.
    harness.clock.set(T0 + 70_000);
    const late = await bid('bruno', 200_000, 'late');

    assert.equal(late.outcome.ok, false);
    assert.equal(late.outcome.ok === false && late.outcome.reason, 'too_late');
  });
});

describe('projection', () => {
  it('counts a redelivered event once and records the duplicate', async () => {
    await openLot();
    await bid('ana', 100_000, 'dup-1');
    await drain();

    const events = await harness.log.readPartition('lot-1');
    const bidEvent = events.find((event) => event.type === 'bid.placed');
    assert.ok(bidEvent);

    const result = await harness.projector.applyOne(bidEvent);
    assert.equal(result, 'duplicate');

    const bids = await harness.readModel.listBids('lot-1', 10);
    assert.equal(bids.length, 1, 'the read model must not see the same bid twice');
    assert.equal(await harness.store.getMetric('inbox.duplicates'), 1);
  });

  it('refuses an out-of-order delivery and records the gap', async () => {
    await openLot();
    await bid('ana', 100_000, 'gap-1');
    await bid('bruno', 105_000, 'gap-2');
    await drain();

    const result = await harness.projector.deliverOutOfOrder('lot-1');
    assert.equal(result.detected, true);
    assert.ok(result.received > result.expected);
    assert.equal(await harness.store.getMetric('projector.gaps'), 1);

    const lot = await harness.readModel.getLot('lot-1');
    assert.equal(lot?.currentPrice, 105_000, 'a refused delivery must not corrupt the projection');
  });

  it('parks a poison event and keeps the partition moving', async () => {
    await openLot();
    await bid('ana', 100_000, 'poison-ok-1');

    const head = await harness.pool.query<{ next: number }>(
      `select coalesce(max(position), -1) + 1 as next from events where partition = 'lot-1'`,
    );
    const next = head.rows[0]?.next ?? 0;

    // A bid event with no amount: the log accepts it, the domain cannot.
    await harness.pool.query(
      `insert into events (event_id, partition, position, type, payload, occurred_at)
       values ($1, 'lot-1', $2, 'bid.placed', '{"lotId":"lot-1","bidder":"ghost"}'::jsonb, now())`,
      [randomUUID(), next],
    );

    await bid('bruno', 105_000, 'poison-ok-2');
    await drain();

    const parked = await harness.pool.query<{ count: number }>('select count(*)::int as count from dead_letters');
    assert.equal(parked.rows[0]?.count, 1, 'the malformed event must be parked');

    const bids = await harness.readModel.listBids('lot-1', 10);
    assert.equal(bids.length, 2, 'both valid bids must land despite the poison event');

    const lot = await harness.readModel.getLot('lot-1');
    assert.equal(lot?.currentPrice, 105_000);
    assert.equal(await harness.projector.tick(), 0, 'the partition advanced past the parked event');
    assert.equal(await harness.store.getMetric('projector.deadLetters'), 1);
  });

  it('catches up after a stopped consumer without losing events', async () => {
    await openLot();
    harness.projector.pause();

    for (let index = 0; index < 5; index += 1) {
      await bid(`bidder-${index}`, 100_000 + index * 5_000, `catchup-${index}`);
    }

    const before = await harness.readModel.getLot('lot-1');
    assert.equal(before, null, 'paused consumer must not see anything');

    harness.projector.resume();
    const applied = await drain();
    assert.equal(applied, 6, 'five bids plus the lot.opened');

    const bids = await harness.readModel.listBids('lot-1', 10);
    assert.equal(bids.length, 5);
    assert.equal(await harness.projector.tick(), 0, 'a drained projector applies nothing twice');
  });

  it('rebuilds a corrupted read model from the log alone', async () => {
    await openLot();
    for (let index = 0; index < 4; index += 1) {
      await bid(`bidder-${index}`, 100_000 + index * 5_000, `rebuild-${index}`);
    }
    await drain();
    await bid('zed', 130_000, 'after-drain');
    await drain();

    await harness.pool.query(`update lot_view set current_price = 1, leader = 'fraud', bid_count = 99`);

    await harness.projector.rebuild();
    await drain();

    const fromLog = await foldFromLog();
    const projected = await harness.readModel.getLot('lot-1');
    assert.ok(projected);
    assert.equal(projected.currentPrice, fromLog.currentPrice);
    assert.equal(projected.leader, fromLog.leader);
    assert.equal(projected.bidCount, fromLog.bidCount);
    assert.equal(projected.currentPrice, 130_000);
  });
});

describe('replay', () => {
  it('rebuilds the exact state at any point in time', async () => {
    await openLot();
    harness.clock.set(T0 + 1_000);
    await bid('ana', 100_000, 'r1');
    harness.clock.set(T0 + 2_000);
    await bid('bruno', 105_000, 'r2');
    harness.clock.set(T0 + 3_000);
    await bid('chloe', 110_000, 'r3');

    const atTwo = await harness.replay.timeline('lot-1', T0 + 2_000);
    assert.ok(atTwo.state);
    assert.equal(atTwo.state.currentPrice, 105_000);
    assert.equal(atTwo.state.leader, 'bruno');
    assert.equal(atTwo.state.bidCount, 2);

    const full = await harness.replay.timeline('lot-1');
    assert.equal(full.points.length, 4);
    assert.equal(full.state?.currentPrice, 110_000);
    assert.deepEqual(
      full.points.map((point) => point.state.currentPrice),
      [100_000, 100_000, 105_000, 110_000],
    );
  });
});

describe('closing', () => {
  it('closes exactly once, with the last leader and the last price', async () => {
    await openLot();
    await bid('ana', 100_000, 'c1');
    await bid('bruno', 110_000, 'c2');

    harness.clock.set(T0 + 60_001);
    const first = await harness.closeDueLots.execute();
    const second = await harness.closeDueLots.execute();

    assert.equal(first.length, 1);
    assert.deepEqual(first[0], { lotId: 'lot-1', winner: 'bruno', finalPrice: 110_000 });
    assert.equal(second.length, 0, 'the sweep must not close the same lot twice');

    const events = await harness.log.readPartition('lot-1');
    assert.equal(events.filter((event) => event.type === 'lot.closed').length, 1);

    const late = await bid('chloe', 500_000, 'too-late');
    assert.equal(late.outcome.ok === false && late.outcome.reason, 'lot_closed');
  });

  it('rejects an out-of-order delivery without a valid predecessor', async () => {
    await openLot();
    const events = await harness.log.readPartition('lot-1');
    const opened = events[0];
    assert.ok(opened);

    await assert.rejects(
      () => harness.projector.applyOne({ ...opened, position: 7, seq: 99 }),
      (error: unknown) => error instanceof GapError,
    );
  });
});

describe('snapshot integrity', () => {
  it('the snapshot and the log never diverge across mixed operations', async () => {
    await openLot();
    await bid('ana', 100_000, 'm1');
    harness.clock.set(T0 + 58_000);
    await bid('bruno', 105_000, 'm2');
    harness.clock.set(T0 + 70_000);
    await bid('chloe', 110_000, 'm3');
    await harness.closeDueLots.execute();

    await assertSnapshotMatchesLog();
  });
});

after(async () => {
  await pool.query(TRUNCATE);
  await pool.end();
});
