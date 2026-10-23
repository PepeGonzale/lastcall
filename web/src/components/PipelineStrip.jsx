const NODES = [
  { key: 'cmd', title: 'POST /bids', note: 'command' },
  { key: 'tx', title: 'one transaction', note: 'idempotency + append' },
  { key: 'log', title: 'events', note: 'source of truth', accent: true },
  { key: 'proj', title: 'projector', note: 'inbox dedupe + guard' },
  { key: 'view', title: 'lot_view', note: 'read model' },
  { key: 'ws', title: 'websocket', note: 'fan-out' },
];

export default function PipelineStrip() {
  return (
    <section className="pipeline" id="pipeline" aria-label="Write path">
      <div className="pipeline__label">write path</div>
      <div className="pipeline__track">
        {NODES.map((node, index) => (
          <div key={node.key} className="pipeline__step">
            <div className={`pipeline__node ${node.accent ? 'pipeline__node--accent' : ''}`}>
              <span className="pipeline__title">{node.title}</span>
              <span className="pipeline__note">{node.note}</span>
            </div>
            {index < NODES.length - 1 && (
              <span className="pipeline__arrow" aria-hidden="true">
                →
              </span>
            )}
          </div>
        ))}
      </div>
      <p className="pipeline__foot">
        A bid only exists once in the log. The lock serialises one lot, the inbox makes delivery
        idempotent, and the read model is derived — so it can be thrown away and rebuilt.
      </p>
    </section>
  );
}
