import { useEffect, useState } from 'react';
import { amountOnly, centsFromInput, euro } from '../lib/format.js';

const REASONS = {
  lot_closed: 'the hammer already fell',
  too_late: 'the deadline moved, this bid arrived too late',
  below_minimum: 'below the minimum',
  invalid_amount: 'the amount is not a valid price',
  unknown_lot: 'unknown lot',
};

export default function BidForm({ lot, onBid, onStorm, disabled }) {
  const [bidder, setBidder] = useState(() => localStorage.getItem('lastcall.bidder') ?? 'you');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    if (!lot) return;
    setAmount(amountOnly(lot.minimumNextBid));
  }, [lot?.lotId]);

  useEffect(() => {
    localStorage.setItem('lastcall.bidder', bidder || 'you');
  }, [bidder]);

  const minimum = lot?.minimumNextBid ?? 0;
  const isClosed = lot?.status === 'closed' || disabled;
  const parsed = centsFromInput(amount);
  const belowMinimum = parsed !== null && parsed < minimum;

  async function send(amountCents, label) {
    if (!lot || amountCents === null) {
      setFeedback({ tone: 'error', text: 'type an amount first' });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const result = await onBid(bidder.trim() || 'you', amountCents);
      if (result.accepted) {
        setFeedback({
          tone: 'ok',
          text: `${label} accepted · ${euro(amountCents)}${result.extended ? ' · deadline extended' : ''}`,
        });
      } else {
        const reason = REASONS[result.reason] ?? result.reason;
        setFeedback({
          tone: 'error',
          text: `refused: ${reason}${result.minimum ? ` (${euro(result.minimum)})` : ''}`,
        });
        if (result.minimum) setAmount(amountOnly(result.minimum));
      }
    } catch (error) {
      setFeedback({ tone: 'error', text: error.message });
    } finally {
      setBusy(false);
    }
  }

  async function storm() {
    if (!lot) return;
    setBusy(true);
    setFeedback(null);
    try {
      const result = await onStorm(bidder.trim() || 'you', minimum, 25);
      setFeedback({
        tone: result.accepted === 1 ? 'ok' : 'error',
        text: result.accepted === 1
          ? `25 simultaneous bids · 1 accepted, ${result.rejected} refused by the lock`
          : `25 simultaneous bids · ${result.accepted} accepted (expected exactly 1)`,
      });
    } catch (error) {
      setFeedback({ tone: 'error', text: error.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" aria-label="Place a bid">
      <div className="panel__head">
        <span className="panel__title">place a bid</span>
        <span className="panel__title">min {lot ? euro(minimum) : '—'}</span>
      </div>
      <div className="panel__body">
        <form
          className="bidform"
          onSubmit={(event) => {
            event.preventDefault();
            void send(parsed, 'bid');
          }}
        >
          <label className="field">
            <span className="field__label">bidder</span>
            <input
              className="input"
              value={bidder}
              onChange={(event) => setBidder(event.target.value)}
              maxLength={40}
              autoComplete="off"
              disabled={isClosed}
            />
          </label>

          <label className="field">
            <span className="field__label">amount (EUR)</span>
            <input
              className="input"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="decimal"
              autoComplete="off"
              disabled={isClosed}
              aria-invalid={belowMinimum}
            />
          </label>

          <button className="btn btn--primary" type="submit" disabled={busy || isClosed || belowMinimum}>
            {isClosed ? 'closed' : busy ? 'sending' : 'bid'}
          </button>
        </form>

        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={busy || isClosed}
            onClick={() => void send(minimum, 'snipe bid')}
            title="Bid the exact minimum. Inside the last 10 seconds this triggers an anti-snipe extension."
          >
            snipe at minimum
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={busy || isClosed}
            onClick={() => void storm()}
            title="25 concurrent bids at the same price. Exactly one can win."
          >
            bid storm ×25
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={busy || !lot || isClosed}
            onClick={() => setAmount(amountOnly(minimum))}
          >
            reset to min
          </button>
        </div>

        {feedback ? (
          <p className={`hint ${feedback.tone === 'error' ? 'hint--error' : 'hint--ok'}`} role="status">
            {feedback.text}
          </p>
        ) : (
          <p className="hint">
            Idempotency key is generated per click, so a retry can never place a second bid.
          </p>
        )}
      </div>
    </section>
  );
}
