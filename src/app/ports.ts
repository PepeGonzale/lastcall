import type { LotState } from '../domain/auction.js';

export interface Envelope<TPayload = unknown> {
  eventId: string;
  partition: string;
  position: number;
  type: string;
  payload: TPayload;
  occurredAt: number;
  seq: number;
}

export interface NewEvent<TPayload = unknown> {
  eventId: string;
  type: string;
  payload: TPayload;
  occurredAt: number;
}

export interface Clock {
  now(): number;
}

export interface EventLog {
  append(partition: string, events: NewEvent[]): Promise<Envelope[]>;
  readPartition(partition: string, fromPosition?: number): Promise<Envelope[]>;
  readAfter(seq: number, limit: number): Promise<Envelope[]>;
  lastSeq(): Promise<number>;
  count(): Promise<number>;
}

export type BidOutcome =
  | { ok: true; eventId: string; amount: number; extended: boolean; endsAt: number }
  | { ok: false; reason: string; minimum?: number };

/** Everything a command needs, inside one transaction, under one lock. */
export interface LotTransaction {
  findOutcome(key: string): Promise<BidOutcome | null>;
  loadState(): Promise<LotState | null>;
  append(events: NewEvent[]): Promise<Envelope[]>;
  saveOutcome(key: string, eventId: string | null, outcome: BidOutcome): Promise<void>;
  recordRejection(bidder: string, amount: number, reason: string): Promise<void>;
}

export interface LotUnitOfWork {
  /**
   * Serialises all commands for one lot and commits them atomically with the
   * snapshot. Validation never runs against a stale read model.
   */
  run<T>(lotId: string, work: (tx: LotTransaction) => Promise<T>): Promise<T>;
}

export interface WriteModel {
  getLotState(lotId: string): Promise<LotState | null>;
  saveLotState(state: LotState): Promise<void>;
  /** Lots whose deadline has passed and that may still need a `lot.closed`. */
  dueLots(now: number, limit: number): Promise<string[]>;
}

export interface BidRow {
  eventId: string;
  lotId: string;
  bidder: string;
  amount: number;
  position: number;
  at: number;
}

export interface ReadModelReader {
  listLots(): Promise<LotState[]>;
  getLot(lotId: string): Promise<LotState | null>;
  listBids(lotId: string, limit: number): Promise<BidRow[]>;
  listRejections(lotId: string, limit: number): Promise<{bidder: string; amount: number; reason: string; at: number}[]>;
  counters(): Promise<{
    events: number;
    bids: number;
    rejections: number;
    lots: number;
    duplicateDeliveries: number;
    gaps: number;
    projectionResets: number;
    deadLetters: number;
  }>;
}

export interface ProjectionChange {
  state: LotState;
  bid?: { eventId: string; lotId: string; bidder: string; amount: number; at: number };
}

export interface ProjectionStore {
  lastPosition(consumer: string, partition: string): Promise<number>;
  /** Durable global resume point, committed with each applied event. */
  loadCursor(consumer: string): Promise<number>;
  /**
   * Applies a projection change and its dedupe record in the same transaction.
   * Returns 'duplicate' when the delivery had already been processed.
   */
  applyEvent(
    consumer: string,
    envelope: Envelope,
    project: (current: LotState | null) => ProjectionChange,
  ): Promise<'applied' | 'duplicate'>;
  recordGap(consumer: string, partition: string, expected: number, received: number): Promise<void>;
  /**
   * Parks a poison event and acknowledges it: the partition advances, so one
   * malformed row cannot stall every bid behind it.
   */
  deadLetter(consumer: string, envelope: Envelope, error: string): Promise<void>;
  offsets(consumer: string): Promise<{ partition: string; position: number; head: number }[]>;
  resetProjection(consumer: string): Promise<void>;
  getMetric(name: string): Promise<number>;
}

export interface Notifier {
  (message: Record<string, unknown>): void;
}
