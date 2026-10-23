const LEVERS = [
  {
    kind: 'duplicate',
    name: 'Duplicate delivery',
    note: 're-publish the last event',
    hint: 'A broker redelivery. The inbox must absorb it and the projection must not move.',
  },
  {
    kind: 'reorder',
    name: 'Out of order',
    note: 'deliver position +3 first',
    hint: 'A partition violation. The contiguity guard must refuse it instead of applying it.',
  },
  {
    kind: 'poison',
    name: 'Poison event',
    note: 'append a malformed row',
    hint: 'The log accepts it, the domain cannot. It must be parked in dead_letters instead of stalling the partition.',
  },
  {
    kind: 'lag',
    name: 'Lag 1.5s / event',
    note: 'slow the projector',
    hint: 'Bids keep committing to the log while the read model falls behind. Watch log vs cursor.',
  },
  {
    kind: 'pause',
    name: 'Kill consumer',
    note: 'stop the projector',
    hint: 'Nothing is lost: the cursor is durable and the restart replays from it.',
  },
  {
    kind: 'resume',
    name: 'Restart consumer',
    note: 'catch up from offset',
    hint: 'It replays what it missed, in order, exactly once per event.',
  },
  {
    kind: 'rebuild',
    name: 'Rebuild projection',
    note: 'drop the read model',
    hint: 'The read model is deleted and rebuilt from the log. If it was wrong, it stops being wrong.',
  },
];

export default function ChaosPanel({ projector, counters, notes, onChaos }) {
  const lagging = (projector?.lagMs ?? 0) > 0;
  const paused = projector?.paused === true;

  return (
    <section className="panel" aria-label="Chaos panel">
      <div className="panel__head">
        <span className="panel__title">chaos panel</span>
        <span className="panel__title">inject failure, not optimism</span>
      </div>

      <div className="panel__body">
        <div className="chaos-grid">
          {LEVERS.map((lever) => {
            const active =
              (lever.kind === 'lag' && lagging) || (lever.kind === 'pause' && paused);
            return (
              <button
                key={lever.kind}
                type="button"
                className="lever"
                data-active={active}
                title={lever.hint}
                onClick={() => onChaos(lever.kind === 'lag' && lagging ? 'unlag' : lever.kind)}
              >
                <span className="lever__name">{lever.kind === 'lag' && lagging ? 'Real time' : lever.name}</span>
                <span className="lever__note">{lever.kind === 'lag' && lagging ? 'remove the lag' : lever.note}</span>
              </button>
            );
          })}
        </div>

        <div className="counter-row">
          <span className="chip">
            duplicates absorbed <b>{counters?.duplicateDeliveries ?? 0}</b>
          </span>
          <span className="chip">
            gaps caught <b>{counters?.gaps ?? 0}</b>
          </span>
          <span className="chip" title="Malformed events parked without stalling the partition">
            parked <b>{counters?.deadLetters ?? projector?.deadLetters ?? 0}</b>
          </span>
          <span className="chip">
            projection <b>{paused ? 'stopped' : 'live'}</b>
          </span>
          <button type="button" className="chip" onClick={() => onChaos('reset')}>
            reset demo
          </button>
        </div>

        <div className="chaos-log" role="log" aria-live="polite">
          {notes.length === 0 ? (
            <div className="chaos-log__line">no chaos injected yet.</div>
          ) : (
            notes.map((note) => (
              <div key={note.id} className="chaos-log__line" data-tone={note.tone}>
                › <b>{note.text}</b>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
