import type { LotState } from '../domain/auction.js';
import { applyEnvelopeToState } from './events.js';
import type { EventLog } from './ports.js';
import { serializeLot, type LotView } from './views.js';

export interface TimelinePoint {
  position: number;
  at: number;
  type: string;
  state: LotView;
}

export interface Timeline {
  lotId: string;
  until: number | null;
  state: LotView | null;
  points: TimelinePoint[];
}

/**
 * Folds the log from position 0 up to a point in time. It never reads the
 * projection, which is the point: if the read model were wrong, this would
 * still be right, and `rebuild` could restore it.
 */
export class ReplayLog {
  constructor(private readonly log: EventLog) {}

  async timeline(lotId: string, until?: number): Promise<Timeline> {
    const events = await this.log.readPartition(lotId);
    const visible =
      until === undefined ? events : events.filter((event) => event.occurredAt <= until);

    let state: LotState | null = null;
    const points: TimelinePoint[] = [];

    for (const envelope of visible) {
      state = applyEnvelopeToState(state, envelope);
      points.push({
        position: envelope.position,
        at: envelope.occurredAt,
        type: envelope.type,
        state: serializeLot(state),
      });
    }

    return {
      lotId,
      until: until ?? null,
      state: state ? serializeLot(state) : null,
      points,
    };
  }
}
