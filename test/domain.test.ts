import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_RULES,
  applyEvent,
  decideBid,
  decideClose,
  fold,
  fromLotOpened,
  minimumNextBid,
  type AuctionEvent,
  type LotOpened,
  type LotState,
} from '../src/domain/auction.js';
import { formatCents } from '../src/domain/money.js';

const OPEN_AT = Date.parse('2026-01-01T12:00:00.000Z');
const ENDS_AT = OPEN_AT + 60_000;

function opened(overrides: Partial<LotOpened> = {}): LotOpened {
  return {
    type: 'lot.opened',
    lotId: 'lot-1',
    title: 'Omega Speedmaster 145.022',
    startPrice: 100_000,
    minIncrement: 5_000,
    endsAt: ENDS_AT,
    at: OPEN_AT,
    ...overrides,
  };
}

function stateAfter(events: AuctionEvent[]): LotState {
  const state = fold(events);
  assert.ok(state, 'expected a folded state');
  return state;
}

function accepted(state: LotState | null, bidder: string, amount: number, now: number) {
  const decision = decideBid(
    state,
    { lotId: 'lot-1', bidId: `bid-${bidder}-${amount}`, bidder, amount, now },
    DEFAULT_RULES,
  );
  assert.equal(decision.ok, true, `expected ${amount} from ${bidder} to be accepted`);
  if (!decision.ok) throw new Error('unreachable');
  return decision;
}

describe('bid rules', () => {
  it('accepts the first bid at exactly the starting price', () => {
    const state = fromLotOpened(opened());
    assert.equal(minimumNextBid(state), 100_000);
    const decision = accepted(state, 'ana', 100_000, OPEN_AT + 1_000);
    assert.equal(decision.events.length, 1);
    assert.equal(decision.extended, false);
  });

  it('rejects a first bid one cent below the starting price', () => {
    const state = fromLotOpened(opened());
    const decision = decideBid(
      state,
      { lotId: 'lot-1', bidId: 'b1', bidder: 'ana', amount: 99_999, now: OPEN_AT + 1 },
      DEFAULT_RULES,
    );
    assert.deepEqual(decision, { ok: false, reason: 'below_minimum', minimum: 100_000 });
  });

  it('requires the full increment after the first bid', () => {
    const state = stateAfter([
      opened(),
      { type: 'bid.placed', lotId: 'lot-1', bidId: 'b1', bidder: 'ana', amount: 100_000, at: OPEN_AT + 1 },
    ]);
    assert.equal(minimumNextBid(state), 105_000);
    const low = decideBid(
      state,
      { lotId: 'lot-1', bidId: 'b2', bidder: 'bruno', amount: 104_999, now: OPEN_AT + 2 },
      DEFAULT_RULES,
    );
    assert.equal(low.ok, false);
    assert.equal(low.ok === false && low.reason, 'below_minimum');
    accepted(state, 'bruno', 105_000, OPEN_AT + 3);
  });

  it('rejects non-integer and non-positive amounts', () => {
    const state = fromLotOpened(opened());
    for (const amount of [0, -1, 100_000.5, Number.NaN]) {
      const decision = decideBid(
        state,
        { lotId: 'lot-1', bidId: 'b', bidder: 'ana', amount, now: OPEN_AT + 1 },
        DEFAULT_RULES,
      );
      assert.equal(decision.ok, false);
      assert.equal(decision.ok === false && decision.reason, 'invalid_amount');
    }
  });

  it('rejects bids on a closed lot', () => {
    const state = stateAfter([opened(), { type: 'lot.closed', lotId: 'lot-1', winner: null, finalPrice: 100_000, at: ENDS_AT }]);
    const decision = decideBid(
      state,
      { lotId: 'lot-1', bidId: 'late', bidder: 'ana', amount: 200_000, now: ENDS_AT + 1 },
      DEFAULT_RULES,
    );
    assert.equal(decision.ok === false && decision.reason, 'lot_closed');
  });

  it('rejects a bid that arrives after the deadline, even a high one', () => {
    const state = fromLotOpened(opened());
    const decision = decideBid(
      state,
      { lotId: 'lot-1', bidId: 'late', bidder: 'ana', amount: 900_000, now: ENDS_AT },
      DEFAULT_RULES,
    );
    assert.equal(decision.ok === false && decision.reason, 'too_late');
  });

  it('rejects bids for an unknown lot', () => {
    const decision = decideBid(
      null,
      { lotId: 'nope', bidId: 'b', bidder: 'ana', amount: 1, now: OPEN_AT },
      DEFAULT_RULES,
    );
    assert.equal(decision.ok === false && decision.reason, 'unknown_lot');
  });
});

describe('anti-snipe extensions', () => {
  it('does not extend a bid outside the snipe window', () => {
    const state = fromLotOpened(opened());
    const decision = accepted(state, 'ana', 100_000, ENDS_AT - 30_000);
    assert.equal(decision.extended, false);
    assert.equal(decision.events.length, 1);
  });

  it('extends the deadline to bid time + extension when inside the window', () => {
    const state = fromLotOpened(opened());
    const bidAt = ENDS_AT - 2_000;
    const decision = accepted(state, 'ana', 100_000, bidAt);
    assert.equal(decision.extended, true);
    assert.equal(decision.events.length, 2);
    const extension = decision.events[1];
    assert.equal(extension?.type, 'lot.extended');
    assert.equal(extension?.type === 'lot.extended' && extension.endsAt, bidAt + DEFAULT_RULES.extensionMs);
  });

  it('stacks extensions: each snipe bid buys another window', () => {
    const state = fromLotOpened(opened());
    const first = accepted(state, 'ana', 100_000, ENDS_AT - 2_000);
    const afterFirst = stateAfter([opened(), ...first.events]);
    const secondAt = afterFirst.endsAt - 1_000;
    const second = accepted(afterFirst, 'bruno', 110_000, secondAt);
    const afterSecond = stateAfter([opened(), ...first.events, ...second.events]);

    assert.equal(afterSecond.extensionCount, 2);
    assert.equal(afterSecond.endsAt, secondAt + DEFAULT_RULES.extensionMs);
    assert.ok(afterSecond.endsAt > afterFirst.endsAt);
    assert.equal(afterSecond.leader, 'bruno');
    assert.equal(afterSecond.currentPrice, 110_000);
  });

  it('the bid that triggers the extension is still counted exactly once', () => {
    const state = fromLotOpened(opened());
    const decision = accepted(state, 'ana', 100_000, ENDS_AT - 1_000);
    const after = stateAfter([opened(), ...decision.events]);
    assert.equal(after.bidCount, 1);
    assert.equal(after.extensionCount, 1);
    assert.equal(after.currentPrice, 100_000);
  });
});

describe('closing', () => {
  it('does not close before the deadline', () => {
    const state = fromLotOpened(opened());
    assert.equal(decideClose(state, ENDS_AT - 1), null);
  });

  it('closes at the deadline with the leader as winner', () => {
    const state = stateAfter([
      opened(),
      { type: 'bid.placed', lotId: 'lot-1', bidId: 'b1', bidder: 'ana', amount: 120_000, at: OPEN_AT + 1 },
    ]);
    const closed = decideClose(state, ENDS_AT);
    assert.equal(closed?.type, 'lot.closed');
    assert.equal(closed?.type === 'lot.closed' && closed.winner, 'ana');
    assert.equal(closed?.type === 'lot.closed' && closed.finalPrice, 120_000);
  });

  it('closes an auction with no bids as unsold', () => {
    const state = fromLotOpened(opened());
    const closed = decideClose(state, ENDS_AT + 5);
    assert.equal(closed?.type === 'lot.closed' && closed.winner, null);
  });

  it('closing twice is a no-op: the log cannot contain two closes', () => {
    const state = stateAfter([opened(), { type: 'lot.closed', lotId: 'lot-1', winner: null, finalPrice: 100_000, at: ENDS_AT }]);
    assert.equal(decideClose(state, ENDS_AT + 10_000), null);
  });
});

describe('fold determinism', () => {
  it('replaying the same log twice yields the same state and version', () => {
    const log: AuctionEvent[] = [
      opened(),
      { type: 'bid.placed', lotId: 'lot-1', bidId: 'b1', bidder: 'ana', amount: 100_000, at: OPEN_AT + 1 },
      { type: 'bid.placed', lotId: 'lot-1', bidId: 'b2', bidder: 'bruno', amount: 105_000, at: OPEN_AT + 2 },
      { type: 'lot.extended', lotId: 'lot-1', endsAt: ENDS_AT + 15_000, reason: 'anti-snipe', at: ENDS_AT - 1_000 },
      { type: 'lot.closed', lotId: 'lot-1', winner: 'bruno', finalPrice: 105_000, at: ENDS_AT + 15_000 },
    ];
    const a = stateAfter(log);
    const b = stateAfter(structuredClone(log));
    assert.deepEqual(a, b);
    assert.equal(a.version, 4);
    assert.equal(a.status, 'closed');
  });

  it('an event before lot.opened is a programming error, not a silent zero', () => {
    assert.throws(
      () => fold([{ type: 'bid.placed', lotId: 'lot-1', bidId: 'b', bidder: 'ana', amount: 1, at: 1 }]),
      /before lot\.opened/,
    );
  });

  it('reducer is idempotent per event only through the log, never by re-applying twice', () => {
    const state = fromLotOpened(opened());
    const bid: AuctionEvent = { type: 'bid.placed', lotId: 'lot-1', bidId: 'b1', bidder: 'ana', amount: 100_000, at: OPEN_AT + 1 };
    const once = applyEvent(state, bid);
    const twice = applyEvent(once, bid);
    assert.equal(once.bidCount, 1);
    assert.equal(twice.bidCount, 2, 'the reducer is not a dedupe layer; the inbox is');
  });
});

describe('money formatting', () => {
  it('formats integer cents without float drift', () => {
    assert.equal(formatCents(100_000), '1,000.00 €');
    assert.equal(formatCents(123_457), '1,234.57 €');
    assert.equal(formatCents(5), '0.05 €');
  });
});
