import { useI18n } from '../i18n/index.jsx';

const LEVERS = [
  { kind: 'duplicate', name: 'chaos.duplicate', note: 'chaos.duplicateNote' },
  { kind: 'reorder', name: 'chaos.reorder', note: 'chaos.reorderNote' },
  { kind: 'poison', name: 'chaos.poison', note: 'chaos.poisonNote' },
  { kind: 'lag', name: 'chaos.lag', note: 'chaos.lagNote' },
  { kind: 'pause', name: 'chaos.kill', note: 'chaos.killNote' },
  { kind: 'resume', name: 'chaos.restart', note: 'chaos.restartNote' },
  { kind: 'rebuild', name: 'chaos.rebuild', note: 'chaos.rebuildNote' },
];

export default function ChaosPanel({ projector, counters, notes, onChaos }) {
  const { t } = useI18n();
  const lagging = (projector?.lagMs ?? 0) > 0;
  const paused = projector?.paused === true;

  return (
    <section className="panel" aria-label={t('chaos.panel')}>
      <div className="panel__head">
        <span className="panel__title">{t('chaos.panel')}</span>
        <span className="panel__title">{t('chaos.sub')}</span>
      </div>

      <div className="panel__body">
        <div className="counter-row">
          <span className="chip">
            {t('chaos.duplicatesAbsorbed')} <b>{counters?.duplicateDeliveries ?? 0}</b>
          </span>
          <span className="chip">
            {t('chaos.gapsCaught')} <b>{counters?.gaps ?? 0}</b>
          </span>
          <span className="chip" title={t('chaos.poisonNote')}>
            {t('chaos.parked')} <b>{counters?.deadLetters ?? projector?.deadLetters ?? 0}</b>
          </span>
          <span className={`chip ${paused ? 'chip--warn' : ''}`}>
            {t('chaos.projection')} <b>{paused ? t('chaos.stopped') : t('chaos.live')}</b>
          </span>
          <button
            type="button"
            className="btn btn--ghost btn--tiny counter-row__action"
            onClick={() => onChaos('reset')}
          >
            {t('chaos.reset')}
          </button>
        </div>

        <div className="chaos-log" role="log" aria-live="polite">
          {notes.length === 0 ? (
            <div className="chaos-log__line">{t('chaos.empty')}</div>
          ) : (
            notes.map((note) => (
              <div key={note.id} className="chaos-log__line" data-tone={note.tone}>
                › <b>{t(note.code, note.params)}</b>
              </div>
            ))
          )}
        </div>

        <details className="advanced">
          <summary>
            <span>{t('chaos.advanced')}</span>
            <span aria-hidden="true">{LEVERS.length}</span>
          </summary>

          <div className="chaos-grid">
            {LEVERS.map((lever) => {
              const active = (lever.kind === 'lag' && lagging) || (lever.kind === 'pause' && paused);
              return (
                <button
                  key={lever.kind}
                  type="button"
                  className="lever"
                  data-active={active}
                  onClick={() => onChaos(lever.kind === 'lag' && lagging ? 'unlag' : lever.kind)}
                >
                  <span className="lever__name">
                    {lever.kind === 'lag' && lagging ? t('chaos.realtime') : t(lever.name)}
                  </span>
                  <span className="lever__note">
                    {lever.kind === 'lag' && lagging ? t('chaos.realtimeNote') : t(lever.note)}
                  </span>
                </button>
              );
            })}
          </div>
        </details>
      </div>
    </section>
  );
}
