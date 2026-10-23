import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  applyEvent,
  fromLotOpened,
  type AuctionEvent,
  type LotState,
} from '../domain/auction.js';
import type { Envelope, NewEvent, ProjectionChange } from './ports.js';

/**
 * The delivery boundary validates. Everything downstream can then trust the
 * shape of an event, which is why the reducer has no `if (!payload)` branches.
 */
const LotOpenedSchema = z.object({
  lotId: z.string().min(1),
  title: z.string().min(1),
  startPrice: z.number().int().positive(),
  minIncrement: z.number().int().positive(),
  endsAt: z.number().int().positive(),
  at: z.number().int().nonnegative(),
});

const BidPlacedSchema = z.object({
  lotId: z.string().min(1),
  bidId: z.string().min(1),
  bidder: z.string().min(1),
  amount: z.number().int().positive(),
  at: z.number().int().nonnegative(),
});

const LotExtendedSchema = z.object({
  lotId: z.string().min(1),
  endsAt: z.number().int().positive(),
  reason: z.literal('anti-snipe'),
  at: z.number().int().nonnegative(),
});

const LotClosedSchema = z.object({
  lotId: z.string().min(1),
  winner: z.string().nullable(),
  finalPrice: z.number().int().nonnegative(),
  at: z.number().int().nonnegative(),
});

export const EVENT_SCHEMAS = {
  'lot.opened': LotOpenedSchema,
  'bid.placed': BidPlacedSchema,
  'lot.extended': LotExtendedSchema,
  'lot.closed': LotClosedSchema,
} as const;

export type EventType = keyof typeof EVENT_SCHEMAS;

export function isKnownEventType(type: string): type is EventType {
  return type in EVENT_SCHEMAS;
}

export function parseEnvelope(envelope: Envelope): AuctionEvent {
  if (!isKnownEventType(envelope.type)) {
    throw new Error(`unknown event type "${envelope.type}"`);
  }
  // The column is authoritative for the type; the payload is validated and
  // stripped, so a stored payload cannot smuggle a different event type in.
  const schema = EVENT_SCHEMAS[envelope.type];
  const payload = schema.parse(envelope.payload);
  return { type: envelope.type, ...payload } as AuctionEvent;
}

export function newEvent(type: EventType, payload: AuctionEvent): NewEvent {
  return {
    eventId: randomId(),
    type,
    payload,
    occurredAt: payload.at,
  };
}

let counter = 0;

/**
 * Deterministic ids in tests, real UUIDs in production. The log requires the
 * `uuid` type, so tests get a stable pseudo-UUID built from a counter.
 */
export function randomId(): string {
  if (process.env.NODE_ENV === 'test' && process.env.DETERMINISTIC_IDS === '1') {
    counter += 1;
    return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
  }
  return randomUUID();
}

/**
 * A poison event is one the domain cannot accept: wrong shape, unknown type, or
 * an ordering that contradicts the lot's own history. It gets parked, never
 * retried forever.
 */
export function isPoisonEventError(error: unknown): boolean {
  if (error instanceof z.ZodError) return true;
  const message = error instanceof Error ? error.message : '';
  return (
    message.startsWith('unknown event type') ||
    message.includes('before lot.opened') ||
    message.includes('opened twice') ||
    message.includes('arrived on partition')
  );
}

export function applyEnvelopeToState(current: LotState | null, envelope: Envelope): LotState {
  const event = parseEnvelope(envelope);
  if (event.type === 'lot.opened') {
    if (current) throw new Error(`lot ${event.lotId} opened twice`);
    return fromLotOpened(event);
  }
  if (!current) throw new Error(`event ${event.type} for unknown lot ${event.lotId}`);
  if (event.lotId !== current.lotId) {
    throw new Error(`event for ${event.lotId} arrived on partition ${current.lotId}`);
  }
  return applyEvent(current, event);
}

export function projectionFor(current: LotState | null, envelope: Envelope): ProjectionChange {
  const state = applyEnvelopeToState(current, envelope);
  const event = parseEnvelope(envelope);
  if (event.type === 'bid.placed') {
    return {
      state,
      bid: {
        eventId: envelope.eventId,
        lotId: event.lotId,
        bidder: event.bidder,
        amount: event.amount,
        at: event.at,
      },
    };
  }
  return { state };
}
