import { euro } from '../lib/format.js';

export default function LotRail({ lots, selectedLotId, onSelect }) {
  if (lots.length === 0) return null;

  return (
    <nav className="rail" aria-label="Lots">
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
            {euro(lot.currentPrice)} · {lot.status === 'closed' ? 'closed' : `${lot.bidCount} bids`}
          </span>
        </button>
      ))}
    </nav>
  );
}
