import { useI18n } from '../i18n/index.jsx';
import { euro } from '../lib/format.js';

export default function LotRail({ lots, selectedLotId, onSelect }) {
  const { t } = useI18n();
  if (lots.length === 0) return null;

  return (
    <nav className="rail" aria-label={t('rail.aria')}>
      {lots.map((lot) => (
        <button
          key={lot.lotId}
          type="button"
          className="rail__item"
          aria-current={lot.lotId === selectedLotId}
          onClick={() => onSelect(lot.lotId)}
        >
          <span className="rail__name">{lot.title}</span>
          <span className="rail__price">
            {euro(lot.currentPrice)} · {lot.status === 'closed' ? t('hero.settled') : `${lot.bidCount} ${t('hero.bids')}`}
          </span>
        </button>
      ))}
    </nav>
  );
}
