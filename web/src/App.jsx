import { useEffect, useState } from 'react';
import BidForm from './components/BidForm.jsx';
import BidTape from './components/BidTape.jsx';
import ChaosPanel from './components/ChaosPanel.jsx';
import LotHero from './components/LotHero.jsx';
import LotRail from './components/LotRail.jsx';
import PipelineStrip from './components/PipelineStrip.jsx';
import TimeTravel from './components/TimeTravel.jsx';
import TopBar from './components/TopBar.jsx';
import { useAuction } from './hooks/useAuction.js';

export function useNow(intervalMs = 250) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export default function App() {
  const { state, selectLot, placeBid, storm, chaos, note } = useAuction();
  const now = useNow(200);
  const index = Math.max(0, state.lots.findIndex((lot) => lot.lotId === state.selectedLotId));

  return (
    <div className="shell">
      <TopBar status={state.status} projector={state.projector} counters={state.counters} />

      <LotRail lots={state.lots} selectedLotId={state.selectedLotId} onSelect={selectLot} />

      <main className="layout">
        <div className="column">
          <LotHero lot={state.lot} now={now} index={index} />
          <BidForm lot={state.lot} onBid={placeBid} onStorm={storm} disabled={!state.lot} />
          <ChaosPanel
            projector={state.projector}
            counters={state.counters}
            notes={state.notes}
            onChaos={chaos}
          />
        </div>

        <div className="column">
          <BidTape tape={state.tape} lot={state.lot} now={now} />
          <TimeTravel lot={state.lot} onNote={note} />
        </div>
      </main>

      <PipelineStrip />

      <footer className="footnote">
        <span>event-sourced · postgres log + outbox · idempotent inbox · per-lot advisory lock</span>
        <span>
          <a href="https://github.com/PepeGonzale/lastcall" target="_blank" rel="noreferrer">
            source
          </a>{' '}
          ·{' '}
          <a href="/api/health" target="_blank" rel="noreferrer">
            api health
          </a>{' '}
          · <a href="#pipeline">how it works</a>
        </span>
      </footer>
    </div>
  );
}
