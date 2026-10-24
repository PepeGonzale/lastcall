import { useEffect, useRef, useState } from 'react';
import BidForm from './components/BidForm.jsx';
import BidTape from './components/BidTape.jsx';
import ChaosPanel from './components/ChaosPanel.jsx';
import Intro from './components/Intro.jsx';
import LotHero from './components/LotHero.jsx';
import LotRail from './components/LotRail.jsx';
import PipelineStrip from './components/PipelineStrip.jsx';
import TimeTravel from './components/TimeTravel.jsx';
import TopBar from './components/TopBar.jsx';
import Tour from './components/Tour.jsx';
import { useAuction } from './hooks/useAuction.js';
import { useTimeline } from './hooks/useTimeline.js';
import { useI18n } from './i18n/index.jsx';

const INTRO_KEY = 'lastcall.intro';

export function useNow(intervalMs = 250) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export default function App() {
  const { t } = useI18n();
  const { state, selectLot, placeBid, storm, chaos } = useAuction();
  const timeline = useTimeline(state.selectedLotId, state.lot?.version ?? 0);
  const now = useNow(200);
  const tourRef = useRef(null);

  const [showIntro, setShowIntro] = useState(() => localStorage.getItem(INTRO_KEY) !== 'hidden');
  const index = Math.max(0, state.lots.findIndex((lot) => lot.lotId === state.selectedLotId));

  const hideIntro = () => {
    setShowIntro(false);
    localStorage.setItem(INTRO_KEY, 'hidden');
  };

  const startTour = () => {
    hideIntro();
    tourRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <div className="shell">
      <TopBar
        status={state.status}
        projector={state.projector}
        counters={state.counters}
        onHelp={() => setShowIntro(true)}
      />

      {showIntro && <Intro onStart={startTour} onDismiss={hideIntro} canStart={Boolean(state.lot)} />}

      <LotRail lots={state.lots} selectedLotId={state.selectedLotId} onSelect={selectLot} />

      <main className="layout">
        <div className="column">
          <LotHero lot={state.lot} now={now} index={index} />
          <BidForm lot={state.lot} onBid={placeBid} onStorm={storm} disabled={!state.lot} />
          <div ref={tourRef}>
            <Tour
              lot={state.lot}
              onBid={placeBid}
              onStorm={storm}
              onChaos={chaos}
              onRewind={() => timeline.seekFraction(0.5)}
            />
          </div>
        </div>

        <div className="column">
          <BidTape tape={state.tape} lot={state.lot} now={now} />
          <TimeTravel timeline={timeline} />
          <ChaosPanel
            projector={state.projector}
            counters={state.counters}
            notes={state.notes}
            onChaos={chaos}
          />
        </div>
      </main>

      <PipelineStrip />

      <footer className="footnote">
        <span>{t('foot.tagline')}</span>
        <span>
          <a href="https://github.com/PepeGonzale/lastcall" target="_blank" rel="noreferrer">
            {t('foot.source')}
          </a>{' '}
          ·{' '}
          <a href="/api/health" target="_blank" rel="noreferrer">
            {t('foot.health')}
          </a>{' '}
          · <a href="#pipeline">{t('foot.how')}</a>
        </span>
      </footer>
    </div>
  );
}
