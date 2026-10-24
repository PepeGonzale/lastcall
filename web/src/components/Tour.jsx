import { useState } from 'react';
import { useI18n } from '../i18n/index.jsx';

const STEPS = [
  { key: 'one', title: 'tour.step1', note: 'tour.step1Note', ok: 'tour.step1Ok' },
  { key: 'two', title: 'tour.step2', note: 'tour.step2Note', ok: 'tour.step2Ok' },
  { key: 'three', title: 'tour.step3', note: 'tour.step3Note', ok: 'tour.step3Ok' },
  { key: 'four', title: 'tour.step4', note: 'tour.step4Note', ok: 'tour.step4Ok' },
  { key: 'five', title: 'tour.step5', note: 'tour.step5Note', ok: 'tour.step5Ok' },
];

export default function Tour({ lot, onBid, onStorm, onChaos, onRewind }) {
  const { t } = useI18n();
  const [states, setStates] = useState({});
  const [results, setResults] = useState({});
  const [busy, setBusy] = useState(null);

  const completed = STEPS.filter((step) => states[step.key] === 'done').length;
  const disabled = !lot || busy !== null;

  async function run(step) {
    if (!lot || busy !== null) return;
    setBusy(step.key);
    setStates((current) => ({ ...current, [step.key]: 'running' }));

    try {
      if (step.key === 'one') {
        const result = await onBid('you', lot.minimumNextBid);
        if (!result.accepted) {
          throw new Error(t('bid.refused', { reason: t(`reason.${result.reason}`) }));
        }
      }

      if (step.key === 'two') {
        const result = await onStorm('you', lot.minimumNextBid, 25);
        if (result.accepted !== 1) {
          throw new Error(t('bid.stormBad', { accepted: result.accepted }));
        }
      }

      if (step.key === 'three') {
        await onChaos('duplicate');
      }

      if (step.key === 'four') {
        const result = await onChaos('reorder');
        if (result && result.detected === false) throw new Error(t('note.reorderMissed'));
      }

      if (step.key === 'five') {
        onRewind();
      }

      setStates((current) => ({ ...current, [step.key]: 'done' }));
      // Store the key, not the sentence: switching language must re-translate
      // results that are already on screen.
      setResults((current) => ({ ...current, [step.key]: { code: step.ok } }));
    } catch (error) {
      setStates((current) => ({ ...current, [step.key]: 'error' }));
      setResults((current) => ({
        ...current,
        [step.key]: { text: error instanceof Error ? error.message : t('note.error', { message: 'unknown' }) },
      }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="panel tour" aria-label={t('tour.panel')}>
      <div className="panel__head">
        <span className="panel__title">{t('tour.panel')}</span>
        <span className="panel__title">
          {completed}/{STEPS.length}
        </span>
      </div>

      <div className="panel__body">
        <ol className="tour__steps">
          {STEPS.map((step, index) => {
            const state = states[step.key] ?? 'idle';
            return (
              <li key={step.key} className="step" data-state={state}>
                <span className="step__num">{String(index + 1).padStart(2, '0')}</span>

                <div className="step__copy">
                  <span className="step__title">{t(step.title)}</span>
                  <span className="step__note">{t(step.note)}</span>
                </div>

                <button
                  type="button"
                  className="btn btn--ghost btn--tiny"
                  onClick={() => void run(step)}
                  disabled={disabled}
                >
                  {state === 'running' ? t('tour.running') : state === 'done' ? '✓' : t('tour.run')}
                </button>

                {results[step.key] && (
                  <p className="step__result" data-tone={state}>
                    {results[step.key].text ?? t(results[step.key].code, results[step.key].params)}
                  </p>
                )}
              </li>
            );
          })}
        </ol>

        <div className="tour__foot">
          <p className="hint">{completed === STEPS.length ? t('tour.done') : t('tour.sub')}</p>
          <button
            type="button"
            className="btn btn--ghost btn--tiny"
            onClick={() => {
              setStates({});
              setResults({});
            }}
            disabled={completed === 0 && Object.keys(results).length === 0}
          >
            {t('tour.reset')}
          </button>
        </div>
      </div>
    </section>
  );
}
