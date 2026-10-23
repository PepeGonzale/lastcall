import type { Cents } from './money.js';

/**
 * The domain is pure: no database, no clock, no network. Every decision is a
 * function of (state, command, now), which is what makes the auction rules
 * testable without spinning anything up.
 */

export type LotStatus = 'open' | 'closed';

export interface LotState {
  lotId: string;
  title: string;
  startPrice: Cents;
  minIncrement: Cents;
  currentPrice: Cents;
  leader: string | null;
  bidCount: number;
  endsAt: number;
  status: LotStatus;
  extensionCount: number;
  version: number;
}

export interface AuctionRules {
  snipeWindowMs: number;
  extensionMs: number;
}

export const DEFAULT_RULES: AuctionRules = {
  snipeWindowMs: 10_000,
  extensionMs: 15_000,
};

export type LotOpened = {
  type: 'lot.opened';
  lotId: string;
  title: string;
  startPrice: Cents;
  minIncrement: Cents;
  endsAt: number;
  at: number;
};

export type BidPlaced = {
  type: 'bid.placed';
  lotId: string;
  bidId: string;
  bidder: string;
  amount: Cents;
  at: number;
};

export type LotExtended = {
  type: 'lot.extended';
  lotId: string;
  endsAt: number;
  reason: 'anti-snipe';
  at: number;
};

export type LotClosed = {
  type: 'lot.closed';
  lotId: string;
  winner: string | null;
  finalPrice: Cents;
  at: number;
};

export type AuctionEvent = LotOpened | BidPlaced | LotExtended | LotClosed;

export type RejectionReason =
  | 'lot_closed'
  | 'too_late'
  | 'invalid_amount'
  | 'below_minimum'
  | 'unknown_lot';

export type BidDecision =
  | { ok: true; events: AuctionEvent[]; extended: boolean }
  | { ok: false; reason: RejectionReason; minimum?: Cents };

export interface BidCommand {
  lotId: string;
  bidId: string;
  bidder: string;
  amount: Cents;
  now: number;
}

export function fromLotOpened(event: LotOpened): LotState {
  return {
    lotId: event.lotId,
    title: event.title,
    startPrice: event.startPrice,
    minIncrement: event.minIncrement,
    currentPrice: event.startPrice,
    leader: null,
    bidCount: 0,
    endsAt: event.endsAt,
    status: 'open',
    extensionCount: 0,
    version: 0,
  };
}

/** The single reducer. Read model and write model fold the same events. */
export function applyEvent(state: LotState, event: AuctionEvent): LotState {
  switch (event.type) {
    case 'bid.placed':
      return {
        ...state,
        currentPrice: event.amount,
        leader: event.bidder,
        bidCount: state.bidCount + 1,
        version: state.version + 1,
      };
    case 'lot.extended':
      return {
        ...state,
        endsAt: event.endsAt,
        extensionCount: state.extensionCount + 1,
        version: state.version + 1,
      };
    case 'lot.closed':
      return {
        ...state,
        status: 'closed',
        leader: event.winner,
        currentPrice: event.finalPrice,
        version: state.version + 1,
      };
    case 'lot.opened':
      return { ...fromLotOpened(event), version: state.version + 1 };
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

export function fold(events: AuctionEvent[]): LotState | null {
  let state: LotState | null = null;
  for (const event of events) {
    if (event.type === 'lot.opened') {
      state = fromLotOpened(event);
      continue;
    }
    if (!state) {
      throw new Error(`event ${event.type} arrived before lot.opened`);
    }
    state = applyEvent(state, event);
  }
  return state;
}

export function minimumNextBid(state: LotState): Cents {
  return state.bidCount === 0
    ? state.startPrice
    : state.currentPrice + state.minIncrement;
}

/**
 * Anti-snipe: a bid inside the window *moves the deadline*, it does not just
 * land before it. The deadline is derived state, never a `setTimeout`.
 */
export function decideBid(
  state: LotState | null,
  command: BidCommand,
  rules: AuctionRules = DEFAULT_RULES,
): BidDecision {
  if (!state) return { ok: false, reason: 'unknown_lot' };
  if (state.status === 'closed') return { ok: false, reason: 'lot_closed' };
  if (!Number.isSafeInteger(command.amount) || command.amount <= 0) {
    return { ok: false, reason: 'invalid_amount' };
  }
  // A bid that arrives after the deadline loses, always. The extension only
  // protects bids that were already inside the window when they arrived.
  if (command.now >= state.endsAt) return { ok: false, reason: 'too_late' };

  const minimum = minimumNextBid(state);
  if (command.amount < minimum) {
    return { ok: false, reason: 'below_minimum', minimum };
  }

  const bid: BidPlaced = {
    type: 'bid.placed',
    lotId: state.lotId,
    bidId: command.bidId,
    bidder: command.bidder,
    amount: command.amount,
    at: command.now,
  };

  const insideSnipeWindow = command.now >= state.endsAt - rules.snipeWindowMs;
  if (!insideSnipeWindow) {
    return { ok: true, events: [bid], extended: false };
  }

  const extension: LotExtended = {
    type: 'lot.extended',
    lotId: state.lotId,
    endsAt: command.now + rules.extensionMs,
    reason: 'anti-snipe',
    at: command.now,
  };
  return { ok: true, events: [bid, extension], extended: true };
}

export function decideClose(
  state: LotState | null,
  now: number,
): LotClosed | null {
  if (!state) return null;
  if (state.status === 'closed') return null;
  if (now < state.endsAt) return null;
  return {
    type: 'lot.closed',
    lotId: state.lotId,
    winner: state.leader,
    finalPrice: state.currentPrice,
    at: now,
  };
}
