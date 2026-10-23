export default function TopBar({ status, projector, counters }) {
  const connected = status === 'live';
  const cursor = projector?.cursor ?? 0;
  const head = Math.max(counters?.head ?? counters?.events ?? 0, cursor);
  const behind = Math.max(0, head - cursor);
  const paused = projector?.paused === true;

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand__mark">LASTCALL</span>
        <span className="brand__dot" aria-hidden="true" />
        <span className="brand__sub">event-sourced auction engine</span>
      </div>

      <div className="status-cluster">
        <span className={`chip ${connected ? 'chip--live' : 'chip--warn'}`}>
          <span className="chip__led" aria-hidden="true" />
          {connected ? 'live' : status}
        </span>

        <span className="chip" title="projector cursor / log head">
          log <b>{cursor}</b>/<b>{head}</b>
        </span>

        <span className={`chip ${behind > 0 ? 'chip--warn' : ''}`} title="events behind the log head">
          lag <b>{behind}</b>
        </span>

        <span className="chip" title="duplicate deliveries neutralised by the inbox">
          dupes <b>{counters?.duplicateDeliveries ?? 0}</b>
        </span>

        <span className="chip" title="ordering violations caught by the contiguity guard">
          gaps <b>{counters?.gaps ?? 0}</b>
        </span>

        <span className={`chip ${paused ? 'chip--warn' : ''}`}>
          consumer <b>{paused ? 'stopped' : 'running'}</b>
        </span>
      </div>
    </header>
  );
}
