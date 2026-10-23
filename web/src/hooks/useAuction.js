import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { api, ApiError } from '../lib/api.js';

const MAX_TAPE = 80;

const initial = {
  status: 'connecting',
  lots: [],
  selectedLotId: null,
  lot: null,
  tape: [],
  projector: null,
  counters: null,
  notes: [],
  nextId: 1,
};

function pushNote(state, note) {
  return {
    notes: [{ id: state.nextId, ...note }, ...state.notes].slice(0, 40),
    nextId: state.nextId + 1,
  };
}

function tapeFromDetail(detail) {
  const bids = detail.bids.map((bid) => ({
    kind: 'bid',
    id: `bid-${bid.eventId}`,
    lotId: bid.lotId,
    bidder: bid.bidder,
    amount: bid.amount,
    at: bid.at,
  }));
  const rejections = detail.rejections.map((rejection, index) => ({
    kind: 'rejected',
    id: `rej-${rejection.at}-${index}-${rejection.bidder}`,
    lotId: detail.lot.lotId,
    bidder: rejection.bidder,
    amount: rejection.amount,
    at: rejection.at,
    reason: rejection.reason,
  }));
  return [...bids, ...rejections].sort((a, b) => b.at - a.at).slice(0, MAX_TAPE);
}

function reducer(state, action) {
  switch (action.type) {
    case 'status':
      return { ...state, status: action.status };

    case 'snapshot': {
      const { lots, stats } = action.payload;
      const selected =
        state.selectedLotId && lots.some((lot) => lot.lotId === state.selectedLotId)
          ? state.selectedLotId
          : pickDefaultLot(lots);
      const lot = lots.find((candidate) => candidate.lotId === selected) ?? null;
      return {
        ...state,
        lots,
        selectedLotId: selected,
        lot: lot ?? state.lot,
        projector: stats?.projector ?? state.projector,
        counters: stats ?? state.counters,
      };
    }

    case 'lots': {
      const lots = action.lots;
      const selected = state.selectedLotId ?? pickDefaultLot(lots);
      return { ...state, lots, selectedLotId: selected };
    }

    case 'select': {
      if (action.lotId === state.selectedLotId) return state;
      return {
        ...state,
        selectedLotId: action.lotId,
        lot: state.lots.find((candidate) => candidate.lotId === action.lotId) ?? null,
        tape: [],
      };
    }

    case 'detail': {
      if (action.lotId !== state.selectedLotId) return state;
      return {
        ...state,
        lot: action.detail.lot,
        tape: tapeFromDetail(action.detail),
      };
    }

    case 'lot.updated': {
      const lot = action.lot;
      const lots = state.lots.map((candidate) => (candidate.lotId === lot.lotId ? lot : candidate));
      const exists = lots.some((candidate) => candidate.lotId === lot.lotId);
      return {
        ...state,
        lots: exists ? lots : [lot, ...lots],
        lot: state.selectedLotId === lot.lotId ? lot : state.lot,
      };
    }

    case 'bid.placed': {
      if (action.message.lotId !== state.selectedLotId) return state;
      const message = action.message;
      return {
        ...state,
        lots: message.lot
          ? state.lots.map((candidate) => (candidate.lotId === message.lot.lotId ? message.lot : candidate))
          : state.lots,
        lot: message.lot ?? state.lot,
        tape: [
          {
            kind: 'bid',
            id: state.nextId,
            lotId: message.lotId,
            bidder: message.bidder,
            amount: message.amount,
            at: message.at,
            position: message.position,
          },
          ...state.tape,
        ].slice(0, MAX_TAPE),
        nextId: state.nextId + 1,
      };
    }

    case 'bid.rejected': {
      if (action.message.lotId !== state.selectedLotId) return state;
      const message = action.message;
      const [head] = state.tape;

      // A storm produces dozens of identical refusals. Collapse them into one
      // row so the tape keeps telling the story instead of drowning it.
      if (head && head.kind === 'rejected' && head.reason === message.reason && head.amount === message.amount) {
        return {
          ...state,
          tape: [{ ...head, count: (head.count ?? 1) + 1, at: Date.now() }, ...state.tape.slice(1)],
        };
      }

      return {
        ...state,
        tape: [
          {
            kind: 'rejected',
            id: state.nextId,
            lotId: message.lotId,
            bidder: message.bidder,
            amount: message.amount,
            at: Date.now(),
            reason: message.reason,
            count: 1,
          },
          ...state.tape,
        ].slice(0, MAX_TAPE),
        nextId: state.nextId + 1,
      };
    }

    case 'note': {
      const { notes, nextId } = pushNote(state, action.note);
      return { ...state, notes, nextId };
    }

    case 'projector':
      return { ...state, projector: { ...state.projector, ...action.payload } };

    case 'counters':
      return { ...state, counters: { ...state.counters, ...action.counters } };

    case 'reset':
      return { ...initial, status: state.status };

    default:
      return state;
  }
}

function pickDefaultLot(lots) {
  const open = lots.filter((lot) => lot.status === 'open').sort((a, b) => a.endsAt - b.endsAt);
  return (open[0] ?? lots[0])?.lotId ?? null;
}

export function useAuction() {
  const [state, dispatch] = useReducer(reducer, initial);
  const socketRef = useRef(null);

  useEffect(() => {
    let disposed = false;
    let attempt = 0;
    let timer;

    const connect = () => {
      if (disposed) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
      socketRef.current = socket;

      socket.onopen = () => {
        attempt = 0;
        dispatch({ type: 'status', status: 'live' });
      };

      socket.onmessage = (event) => {
        let message;
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }
        handleMessage(message, dispatch, refreshCounters);
      };

      socket.onclose = () => {
        if (disposed) return;
        dispatch({ type: 'status', status: 'offline' });
        const delay = Math.min(8_000, 400 * 2 ** attempt);
        attempt += 1;
        timer = setTimeout(connect, delay);
      };

      socket.onerror = () => socket.close();
    };

    connect();

    return () => {
      disposed = true;
      clearTimeout(timer);
      socketRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (!state.selectedLotId) return undefined;
    let cancelled = false;

    api
      .lot(state.selectedLotId)
      .then((detail) => {
        if (!cancelled) dispatch({ type: 'detail', lotId: state.selectedLotId, detail });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [state.selectedLotId]);

  const selectLot = useCallback((lotId) => dispatch({ type: 'select', lotId }), []);

  const placeBid = useCallback(
    async (bidder, amount) => {
      if (!state.selectedLotId) throw new ApiError('No lot selected', null, 0);
      const result = await api.bid(state.selectedLotId, {
        bidder,
        amount,
        idempotencyKey: crypto.randomUUID(),
      });
      return result;
    },
    [state.selectedLotId],
  );

  const storm = useCallback(
    async (bidder, amount, count = 25) => {
      if (!state.selectedLotId) return { accepted: 0, rejected: 0 };
      const results = await Promise.all(
        Array.from({ length: count }, (_, index) =>
          api
            .bid(state.selectedLotId, {
              bidder: `storm-${index + 1}`,
              amount,
              idempotencyKey: crypto.randomUUID(),
            })
            .catch(() => ({ accepted: false, reason: 'network' })),
        ),
      );
      const accepted = results.filter((result) => result.accepted).length;
      return { accepted, rejected: results.length - accepted };
    },
    [state.selectedLotId],
  );

  const chaos = useCallback(
    async (kind) => {
      const lotId = state.selectedLotId;
      try {
        if (kind === 'duplicate' && lotId) {
          const result = await api.chaos.redeliver(lotId);
          dispatch({
            type: 'note',
            note: {
              tone: 'good',
              text: `redelivered position ${result.position} → inbox answered "${result.result}"; no second bid`,
            },
          });
          dispatch({ type: 'counters', counters: result.counters });
          return result;
        }

        if (kind === 'reorder' && lotId) {
          const result = await api.chaos.reorder(lotId);
          dispatch({
            type: 'note',
            note: result.detected
              ? {
                  tone: 'good',
                  text: `guard refused position ${result.received} (expected ${result.expected}); projection untouched`,
                }
              : { tone: 'bad', text: 'guard did not detect the reordering' },
          });
          dispatch({ type: 'counters', counters: result.counters });
          return result;
        }

        if (kind === 'poison' && lotId) {
          const result = await api.chaos.poison(lotId);
          dispatch({
            type: 'note',
            note: {
              tone: 'good',
              text: `appended a malformed event at position ${result.position}; the consumer must park it`,
            },
          });
          dispatch({ type: 'counters', counters: result.counters });
          return result;
        }

        if (kind === 'lag') {
          const result = await api.chaos.lag(1_500);
          dispatch({ type: 'note', note: { tone: 'warn', text: 'projector slowed to 1.5s per event; watch the lag' } });
          dispatch({ type: 'projector', payload: result.projector });
          return result;
        }

        if (kind === 'unlag') {
          const result = await api.chaos.lag(0);
          dispatch({ type: 'note', note: { tone: 'good', text: 'projector back to real time' } });
          dispatch({ type: 'projector', payload: result.projector });
          return result;
        }

        if (kind === 'pause') {
          const result = await api.chaos.pause();
          dispatch({ type: 'note', note: { tone: 'warn', text: 'consumer killed. Bids keep landing in the log.' } });
          dispatch({ type: 'projector', payload: result.projector });
          return result;
        }

        if (kind === 'resume') {
          const result = await api.chaos.resume();
          dispatch({ type: 'note', note: { tone: 'good', text: 'consumer restarted; catching up from its offset' } });
          dispatch({ type: 'projector', payload: result.projector });
          return result;
        }

        if (kind === 'rebuild') {
          const result = await api.chaos.rebuild();
          dispatch({ type: 'note', note: { tone: 'good', text: 'read model dropped and rebuilt from the log' } });
          dispatch({ type: 'projector', payload: result.projector });
          dispatch({ type: 'counters', counters: { projectionResets: 1 } });
          return result;
        }

        if (kind === 'close') {
          const result = await api.chaos.closeSweep();
          dispatch({
            type: 'note',
            note: {
              tone: result.closed.length ? 'good' : 'warn',
              text: result.closed.length
                ? `closed ${result.closed.length} lot(s) at the current deadline`
                : 'nothing due: the deadline has not passed',
            },
          });
          return result;
        }

        if (kind === 'reset') {
          await api.reset();
          dispatch({ type: 'reset' });
          const { lots } = await api.lots();
          dispatch({ type: 'lots', lots });
          dispatch({ type: 'note', note: { tone: 'good', text: 'demo reset: log truncated, seed applied again' } });
          return null;
        }
      } catch (error) {
        dispatch({
          type: 'note',
          note: { tone: 'bad', text: error instanceof Error ? error.message : 'chaos request failed' },
        });
        throw error;
      }
      return null;
    },
    [state.selectedLotId],
  );

  const note = useCallback((text, tone = 'warn') => dispatch({ type: 'note', note: { text, tone } }), []);

  const value = useMemo(
    () => ({ state, selectLot, placeBid, storm, chaos, note }),
    [state, selectLot, placeBid, storm, chaos, note],
  );

  return value;
}

function refreshCounters(dispatch) {
  api.chaos
    .state()
    .then((snapshot) => {
      dispatch({ type: 'counters', counters: snapshot.counters });
      dispatch({ type: 'projector', payload: snapshot.projector });
    })
    .catch(() => {});
}

function handleMessage(message, dispatch, refresh) {
  switch (message.type) {
    case 'snapshot':
      dispatch({ type: 'snapshot', payload: message });
      break;
    case 'lot.opened':
    case 'lot.updated':
      if (message.lot) dispatch({ type: 'lot.updated', lot: message.lot });
      break;
    case 'bid.placed':
      dispatch({ type: 'bid.placed', message });
      break;
    case 'bid.rejected':
      dispatch({ type: 'bid.rejected', message });
      break;
    case 'lot.extended':
      dispatch({
        type: 'note',
        note: {
          tone: 'warn',
          text: `anti-snipe: deadline moved to ${new Date(message.endsAt).toLocaleTimeString('en-GB', { hour12: false })}`,
        },
      });
      break;
    case 'lot.closed':
      dispatch({
        type: 'note',
        note: {
          tone: 'good',
          text: `lot closed · ${message.winner ?? 'unsold'}`,
        },
      });
      break;
    case 'projector':
      dispatch({ type: 'projector', payload: message });
      break;
    case 'dead-letter':
      dispatch({
        type: 'note',
        note: {
          tone: 'warn',
          text: `poison event parked: ${message.partition}#${message.position}`,
        },
      });
      refresh(dispatch);
      break;
    case 'gap':
      dispatch({
        type: 'note',
        note: {
          tone: 'good',
          text: `gap detected on ${message.partition}: expected ${message.expected}, got ${message.received}`,
        },
      });
      refresh(dispatch);
      break;
    default:
      break;
  }
}
