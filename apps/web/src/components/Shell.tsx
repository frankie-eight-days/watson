/**
 * Shell — the app frame: a slim horizontal TopBar (wordmark + workflow nav +
 * engagement switcher + cost), a global observability AlertBanner, the routed
 * view canvas, and the globally available ConsoleDrawer + ReplayBar (the demo
 * toggle + timeline) at the bottom. Console and replay bar persist across views.
 *
 * When no engagement is resolvable (demo off + nothing live), the canvas shows a
 * single clean empty state instead of rendering view shells against no data.
 */
import { useState } from 'react';
import { Link, Outlet } from 'react-router-dom';
import { useSelection } from '@/state/hooks';
import { useAppMode } from '@/state/switcher';
import { DEMO_LOCKED, AUTO_TOUR } from '@/lib/config';
import { TopBar } from './TopBar';
import { AlertBanner } from './AlertBanner';
import { ConsoleDrawer } from './ConsoleDrawer';
import { ReplayBar } from './ReplayBar';
import { WelcomeModal } from './WelcomeModal';
import { Tour } from './Tour';

function NoEngagement({ onShowDemo }: { onShowDemo: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-dashed border-[color:var(--hairline-strong)] text-ink-3">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 7l8-4 8 4v10l-8 4-8-4V7zM12 3v18M4 7l8 4 8-4" />
        </svg>
      </div>
      <h2 className="mt-4 text-base font-semibold tracking-tight text-ink">No live engagement yet</h2>
      <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-ink-3">
        Open the Bench and press{' '}
        <span className="font-medium text-ink-2">COMMENCE RESEARCH</span> to start one — it will appear
        here the moment Hermes begins.
      </p>
      <div className="mt-5 flex items-center gap-2.5">
        <Link
          to="/bench"
          className="focus-ring rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
        >
          Go to the Bench
        </Link>
        <button
          onClick={onShowDemo}
          className="focus-ring rounded-lg border border-hairline px-4 py-2 text-sm font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
        >
          Show demo replay
        </button>
      </div>
    </div>
  );
}

export function Shell() {
  // Start collapsed so the canvas is clean on arrival; the user (or clicking an
  // agent via focusAgent) expands it.
  const [consoleOpen, setConsoleOpen] = useState(false);
  // Demo mirror: ALWAYS greet on load — `?tour=1` jumps straight into the tour,
  // otherwise the welcome/tour offer opens on arrival (no localStorage gate; every
  // judge is a fresh session). The header "?" re-opens it.
  const [welcomeOpen, setWelcomeOpen] = useState(() => DEMO_LOCKED && !AUTO_TOUR);
  const [tourOpen, setTourOpen] = useState(() => AUTO_TOUR);
  const { selectAgent } = useSelection();
  const { hasEngagement, setShowDemo } = useAppMode();

  const focusAgent = (agentId: string) => {
    selectAgent(agentId);
    setConsoleOpen(true);
  };

  const closeWelcome = () => setWelcomeOpen(false);
  const startTour = () => {
    setWelcomeOpen(false);
    setTourOpen(true);
  };

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-bg">
      <TopBar onHelp={DEMO_LOCKED ? () => setWelcomeOpen(true) : undefined} />
      {hasEngagement && <AlertBanner onFocusAgent={focusAgent} />}
      <main className="relative min-h-0 flex-1 overflow-hidden">
        {hasEngagement ? <Outlet /> : <NoEngagement onShowDemo={() => setShowDemo(true)} />}
        {DEMO_LOCKED && (
          <WelcomeModal open={welcomeOpen} onClose={closeWelcome} onTakeTour={startTour} />
        )}
      </main>
      <ConsoleDrawer open={consoleOpen} onToggle={() => setConsoleOpen((o) => !o)} />
      <ReplayBar />
      {DEMO_LOCKED && (
        <Tour open={tourOpen} onClose={() => setTourOpen(false)} focusAgent={focusAgent} />
      )}
    </div>
  );
}
