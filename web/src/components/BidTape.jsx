import { euro, secondsAgo, timeOfDay } from '../lib/format.js';

export default function BidTape({ tape, lot, now }) {
  return (
    <section className="panel tape-panel" aria-label="Bid history">
      <div className="panel__head">
        <span className="panel__title">bid tape</span>
        <span className="panel__title">{tape.length} events</span>
      </div>

      {tape.length === 0 ? (
        <p className="tape__empty">no bids yet. the log is empty.</p>
      ) : (
        <div className="tape" role="log" aria-live="polite">
          {tape.map((entry) => {
            const isLead = entry.kind === 'bid' && lot && entry.amount === lot.currentPrice;
            return (
              <div
                key={entry.id}
                className={`tape__row ${isLead ? 'tape__row--lead' : ''} ${
                  entry.kind === 'rejected' ? 'tape__row--rejected' : ''
                }`}
              >
                <span className="tape__time" title={timeOfDay(entry.at)}>
                  {secondsAgo(entry.at, now)}
                </span>
                <span className="tape__who">
                  {entry.kind === 'rejected' && entry.count > 1 ? `${entry.count} bids` : entry.bidder}
                  {entry.kind === 'bid' && entry.position !== undefined && (
                    <span className="tape__tag">#{entry.position}</span>
                  )}
                  {entry.kind === 'bid' && isLead && <span className="tape__tag">leading</span>}
                  {entry.kind === 'rejected' && (
                    <span className="tape__reason">{entry.reason.replace('_', ' ')}</span>
                  )}
                </span>
                <span className="tape__amount">{euro(entry.amount)}</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
