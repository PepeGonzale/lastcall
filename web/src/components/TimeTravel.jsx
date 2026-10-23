import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { euro, timeOfDay } from '../lib/format.js';

const WIDTH = 100;
const HEIGHT = 40;
const PAD = 3;

function sparkline(points) {
  if (points.length === 0) return { line: '', dots: [], min: 0, max: 0, scale: () => 0 };
  const prices = points.map((point) => point.state.currentPrice);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;

  const x = (index) => (points.length === 1 ? WIDTH / 2 : (index / (points.length - 1)) * (WIDTH - PAD * 2) + PAD);
  const y = (price) => HEIGHT - PAD - ((price - min) / span) * (HEIGHT - PAD * 2);

  const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(2)},${y(point.state.currentPrice).toFixed(2)}`).join(' ');
  const dots = points.map((point, index) => ({ x: x(index), y: y(point.state.currentPrice) }));

  return { line, dots, min, max, scale: y };
}

export default function TimeTravel({ lot, onNote }) {
  const [timeline, setTimeline] = useState(null);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!lot) return;
    setLoading(true);
    try {
      const data = await api.timeline(lot.lotId);
      setTimeline(data);
      setIndex(Math.max(0, data.points.length - 1));
    } catch (error) {
      onNote?.(error.message, 'bad');
    } finally {
      setLoading(false);
    }
  }, [lot?.lotId, onNote]);

  useEffect(() => {
    void load();
  }, [load]);

  const points = timeline?.points ?? [];
  const shape = useMemo(() => sparkline(points), [points]);
  const point = points[index] ?? null;
  const live = points.at(-1)?.state ?? null;
  const atHead = index >= points.length - 1;
  const isPast = points.length > 0 && !atHead;
  const delta = point && live ? live.currentPrice - point.state.currentPrice : 0;

  const indexRef = useRef(index);
  indexRef.current = index;

  useEffect(() => {
    if (!lot) return undefined;
    const timer = setTimeout(() => {
      // Only follow the log when the reader is parked at the head. Scrubbing
      // through history must not be yanked forward by an incoming bid.
      if (indexRef.current >= points.length - 1) void load();
    }, 1400);
    return () => clearTimeout(timer);
  }, [lot?.version, points.length, load]);

  return (
    <section className="panel" aria-label="Time travel">
      <div className="panel__head">
        <span className="panel__title">time travel</span>
        <span className="panel__title">fold the log from position 0</span>
      </div>

      <div className="panel__body">
        <div className="timeline">
          <div className="spark">
            <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" role="img" aria-label="Price over time">
              <defs>
                <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgba(226,178,90,0.34)" />
                  <stop offset="100%" stopColor="rgba(226,178,90,0)" />
                </linearGradient>
              </defs>
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
                    stroke="rgba(226,178,90,0.35)"
                    strokeWidth="0.4"
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
            aria-label="Event position"
            style={{ '--scrub': `${points.length > 1 ? (index / (points.length - 1)) * 100 : 100}%` }}
            onChange={(event) => setIndex(Number(event.target.value))}
          />

          <div className="then">
            <div className="then__cell">
              <div className="then__key">price then</div>
              <div className="then__value">{point ? euro(point.state.currentPrice) : '—'}</div>
            </div>
            <div className="then__cell">
              <div className="then__key">leader</div>
              <div className="then__value">{point?.state.leader ?? '—'}</div>
            </div>
            <div className="then__cell">
              <div className="then__key">bids</div>
              <div className="then__value">{point?.state.bidCount ?? 0}</div>
            </div>
            <div className="then__cell">
              <div className="then__key">deadline</div>
              <div className="then__value">{point ? timeOfDay(point.state.endsAt) : '—'}</div>
            </div>
          </div>

          <div className="timeline__foot">
            <span>
              {points.length === 0
                ? 'no events'
                : `position ${point?.position ?? 0} · ${point?.type ?? ''}`}
            </span>
            <span>
              {isPast ? (
                <span className="chip chip--warn">
                  viewing the past · {delta >= 0 ? '+' : '−'}
                  {euro(Math.abs(delta))} vs now
                </span>
              ) : (
                <span className="chip chip--live">
                  <span className="chip__led" aria-hidden="true" />
                  at the head
                </span>
              )}
            </span>
            <button type="button" className="btn btn--ghost" onClick={() => void load()} disabled={loading}>
              {loading ? 'folding' : 're-fold log'}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
