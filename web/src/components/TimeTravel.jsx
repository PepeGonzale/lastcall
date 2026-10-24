import { useMemo } from 'react';
import { useI18n } from '../i18n/index.jsx';
import { euro, timeOfDay } from '../lib/format.js';

const EVENT_LABEL = {
  'lot.opened': 'event.lot.opened',
  'bid.placed': 'event.bid.placed',
  'lot.extended': 'event.lot.extended',
  'lot.closed': 'event.lot.closed',
};

const WIDTH = 100;
const HEIGHT = 40;
const PAD = 3;

function sparkline(points) {
  if (points.length === 0) return { line: '', dots: [] };
  const prices = points.map((point) => point.state.currentPrice);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;

  const x = (index) => (points.length === 1 ? WIDTH / 2 : (index / (points.length - 1)) * (WIDTH - PAD * 2) + PAD);
  const y = (price) => HEIGHT - PAD - ((price - min) / span) * (HEIGHT - PAD * 2);

  return {
    line: points
      .map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(2)},${y(point.state.currentPrice).toFixed(2)}`)
      .join(' '),
    dots: points.map((point, index) => ({ x: x(index), y: y(point.state.currentPrice) })),
  };
}

export default function TimeTravel({ timeline }) {
  const { t } = useI18n();
  const { points, index, setIndex, reload, loading } = timeline;
  const shape = useMemo(() => sparkline(points), [points]);

  const point = points[index] ?? null;
  const live = points.at(-1)?.state ?? null;
  const atHead = index >= points.length - 1;
  const isPast = points.length > 0 && !atHead;
  const delta = point && live ? live.currentPrice - point.state.currentPrice : 0;

  return (
    <section className="panel" aria-label={t('tt.panel')}>
      <div className="panel__head">
        <span className="panel__title">{t('tt.panel')}</span>
        <span className="panel__title">{t('tt.sub')}</span>
      </div>

      <div className="panel__body">
        <div className="timeline">
          <div className="spark">
            <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" role="img" aria-label={t('tt.aria')}>
              {shape.dots.length > 1 && (
                <path
                  className="spark__area"
                  d={`${shape.line} L${shape.dots.at(-1).x},${HEIGHT} L${shape.dots[0].x},${HEIGHT} Z`}
                />
              )}
              <path className="spark__line" d={shape.line} vectorEffect="non-scaling-stroke" />
              {point && shape.dots[index] && (
                <>
                  <line
                    x1={shape.dots[index].x}
                    x2={shape.dots[index].x}
                    y1={0}
                    y2={HEIGHT}
                    className="spark__cursor"
                  />
                  <circle className="spark__marker" cx={shape.dots[index].x} cy={shape.dots[index].y} r="1.8" />
                </>
              )}
            </svg>
          </div>

          <input
            className="scrub"
            type="range"
            min={0}
            max={Math.max(0, points.length - 1)}
            value={index}
            disabled={points.length === 0}
            aria-label={t('tt.panel')}
            style={{ '--scrub': `${points.length > 1 ? (index / (points.length - 1)) * 100 : 100}%` }}
            onChange={(event) => setIndex(Number(event.target.value))}
          />

          <div className="then">
            <div className="then__cell">
              <div className="then__key">{t('tt.priceThen')}</div>
              <div className="then__value">{point ? euro(point.state.currentPrice) : '—'}</div>
            </div>
            <div className="then__cell">
              <div className="then__key">{t('tt.leader')}</div>
              <div className="then__value">{point?.state.leader ?? '—'}</div>
            </div>
            <div className="then__cell">
              <div className="then__key">{t('tt.bids')}</div>
              <div className="then__value">{point?.state.bidCount ?? 0}</div>
            </div>
            <div className="then__cell">
              <div className="then__key">{t('tt.deadline')}</div>
              <div className="then__value">{point ? timeOfDay(point.state.endsAt) : '—'}</div>
            </div>
          </div>

          <div className="timeline__foot">
            <span>
              {points.length === 0
                ? t('tt.noEvents')
                : `#${point?.position ?? 0} · ${t(EVENT_LABEL[point?.type] ?? point?.type ?? '')}`}
            </span>
            <span>
              {isPast ? (
                <span className="chip chip--warn">
                  {t('tt.past', { delta: `${delta >= 0 ? '+' : '−'}${euro(Math.abs(delta))}` })}
                </span>
              ) : (
                <span className="chip chip--live">
                  <span className="chip__led" aria-hidden="true" />
                  {t('tt.head')}
                </span>
              )}
            </span>
            <button type="button" className="btn btn--ghost btn--tiny" onClick={() => void reload()} disabled={loading}>
              {loading ? t('tt.folding') : t('tt.refold')}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
