import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/index.jsx';
import { amountOnly, centsFromInput, euro } from '../lib/format.js';

export default function BidForm({ lot, onBid, onStorm, disabled }) {
  const { t } = useI18n();
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

  async function send(amountCents) {
    if (!lot || amountCents === null) {
      setFeedback({ tone: 'error', text: t('bid.typeAmount') });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const result = await onBid(bidder.trim() || 'you', amountCents);
      if (result.accepted) {
        setFeedback({
          tone: 'ok',
          text: t(result.extended ? 'bid.acceptedExtended' : 'bid.accepted', { amount: euro(amountCents) }),
        });
      } else {
        const reason = t(`reason.${result.reason}`);
        setFeedback({
          tone: 'error',
          text: result.minimum
            ? t('bid.refusedMin', { reason, amount: euro(result.minimum) })
            : t('bid.refused', { reason }),
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
        text:
          result.accepted === 1
            ? t('bid.stormOk', { rejected: result.rejected })
            : t('bid.stormBad', { accepted: result.accepted }),
      });
    } catch (error) {
      setFeedback({ tone: 'error', text: error.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" aria-label={t('bid.panel')}>
      <div className="panel__head">
        <span className="panel__title">{t('bid.panel')}</span>
        <span className="panel__title">{lot ? t('bid.min', { amount: euro(minimum) }) : '—'}</span>
      </div>
      <div className="panel__body">
        <form
          className="bidform"
          onSubmit={(event) => {
            event.preventDefault();
            void send(parsed);
          }}
        >
          <label className="field">
            <span className="field__label">{t('bid.bidder')}</span>
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
            <span className="field__label">{t('bid.amount')}</span>
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
            {isClosed ? t('bid.closed') : busy ? t('bid.sending') : t('bid.submit')}
          </button>
        </form>

        <div className="btn-row">
          <button
            type="button"
            className="btn btn--ghost"
            disabled={busy || isClosed}
            onClick={() => void send(minimum)}
            title={t('bid.snipeHint')}
          >
            {t('bid.snipe')}
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={busy || isClosed}
            onClick={() => void storm()}
            title={t('bid.stormHint')}
          >
            {t('bid.storm')}
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={busy || !lot || isClosed}
            onClick={() => setAmount(amountOnly(minimum))}
          >
            {t('bid.resetMin')}
          </button>
        </div>

        {feedback ? (
          <p className={`hint ${feedback.tone === 'error' ? 'hint--error' : 'hint--ok'}`} role="status">
            {feedback.text}
          </p>
        ) : (
          <p className="hint">{t('bid.hint')}</p>
        )}
      </div>
    </section>
  );
}
