import { useEffect, useRef, useState } from 'react';
import { amountOnly, clock, euro, timeOfDay } from '../lib/format.js';

const RADIUS = 26;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const SNIPE_WINDOW_MS = 10_000;
const RING_WINDOW_MS = 60_000;

export default function LotHero({ lot, now, index }) {
  const [flash, setFlash] = useState(null);
  const [extension, setExtension] = useState(false);
  const previousPrice = useRef(lot?.currentPrice ?? null);
  const previousExtensions = useRef(lot?.extensionCount ?? 0);

  useEffect(() => {
    if (!lot) return undefined;
    if (previousPrice.current !== null && lot.currentPrice !== previousPrice.current) {
      setFlash('up');
      const timer = setTimeout(() => setFlash(null), 620);
      previousPrice.current = lot.currentPrice;
      return () => clearTimeout(timer);
    }
    previousPrice.current = lot.currentPrice;
    return undefined;
  }, [lot?.currentPrice, lot?.lotId]);

  useEffect(() => {
    if (!lot) return undefined;
    if (lot.extensionCount > previousExtensions.current) {
      setExtension(true);
      const timer = setTimeout(() => setExtension(false), 3_200);
      previousExtensions.current = lot.extensionCount;
      return () => clearTimeout(timer);
    }
    previousExtensions.current = lot.extensionCount;
    return undefined;
  }, [lot?.extensionCount, lot?.lotId]);

  if (!lot) {
    return (
      <section className="panel hero">
        <div className="hero__eyebrow">waiting for the log</div>
        <h1 className="hero__title">No lot on the block</h1>
      </section>
    );
  }

  const remaining = Math.max(0, lot.endsAt - now);
  const state = lot.status === 'closed' ? 'closed' : remaining <= SNIPE_WINDOW_MS ? 'snipe' : remaining <= RING_WINDOW_MS ? 'closing' : 'open';
  const fraction = lot.status === 'closed' ? 0 : Math.min(1, remaining / RING_WINDOW_MS);
  const delta = lot.currentPrice - lot.startPrice;

  return (
    <section className={`panel hero ${flash ? 'is-flashing' : ''}`} aria-label="Current lot">
      {extension && <div className="extension-badge">+ anti-snipe extension</div>}

      <div className="hero__eyebrow">
        <span>Lot {String(index + 1).padStart(2, '0')}</span>
        <span>{lot.lotId}</span>
        <span>{lot.status}</span>
      </div>

      <h1 className="hero__title">
        {lot.title.split(' ').slice(0, -1).join(' ')} <em>{lot.title.split(' ').at(-1)}</em>
      </h1>

      <div className="hero__price-row">
        <div>
          <div className="price__label">current bid</div>
          <div className="price" data-flash={flash ?? undefined} aria-live="polite">
            {amountOnly(lot.currentPrice)}
            <span className="price__currency">EUR</span>
          </div>
          <div className={`delta ${delta > 0 ? '' : 'delta--flat'}`}>
            {lot.bidCount === 0
              ? 'opening price, no bids yet'
              : delta > 0
                ? `▲ ${euro(delta)} over the opening price`
                : 'holding the opening price'}
          </div>
        </div>

        <div className="clock" data-state={state} title="The ring drains over the final minute before the hammer.">
          <svg className="clock__ring" viewBox="0 0 62 62" aria-hidden="true">
            <circle className="clock__track" cx="31" cy="31" r={RADIUS} />
            <circle
              className="clock__progress"
              cx="31"
              cy="31"
              r={RADIUS}
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
            />
          </svg>
          <div>
            <div className="clock__value">{clock(remaining)}</div>
            <div className="clock__caption">
              {lot.status === 'closed' ? 'settled' : state === 'snipe' ? 'anti-snipe window' : 'until hammer'}
            </div>
          </div>
        </div>
      </div>

      <div className="meta">
        <div className="meta__cell">
          <div className="meta__key">min next bid</div>
          <div className="meta__value">{euro(lot.minimumNextBid)}</div>
        </div>
        <div className="meta__cell">
          <div className="meta__key">bids</div>
          <div className="meta__value">{lot.bidCount}</div>
        </div>
        <div className="meta__cell">
          <div className="meta__key">leader</div>
          <div className="meta__value">{lot.leader ?? '—'}</div>
        </div>
        <div className="meta__cell">
          <div className="meta__key">extensions</div>
          <div className="meta__value">
            {lot.extensionCount} · {timeOfDay(lot.endsAt)}
          </div>
        </div>
      </div>
    </section>
  );
}
