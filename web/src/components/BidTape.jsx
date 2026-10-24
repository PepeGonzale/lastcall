import { useI18n } from '../i18n/index.jsx';
import { euro, secondsAgo, timeOfDay } from '../lib/format.js';

export default function BidTape({ tape, lot, now }) {
  const { t } = useI18n();

  return (
    <section className="panel tape-panel" aria-label={t('tape.panel')}>
      <div className="panel__head">
        <span className="panel__title">{t('tape.panel')}</span>
        <span className="panel__title">{t('tape.events', { count: tape.length })}</span>
      </div>

      {tape.length === 0 ? (
        <p className="tape__empty">{t('tape.empty')}</p>
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
                  {entry.kind === 'rejected' && entry.count > 1
                    ? t('tape.manyBids', { count: entry.count })
                    : entry.bidder}
                  {entry.kind === 'bid' && entry.position !== undefined && (
                    <span className="tape__tag">#{entry.position}</span>
                  )}
                  {entry.kind === 'bid' && isLead && <span className="tape__tag">{t('tape.leading')}</span>}
                  {entry.kind === 'rejected' && (
                    <span className="tape__reason">{t(`reason.${entry.reason}`)}</span>
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
