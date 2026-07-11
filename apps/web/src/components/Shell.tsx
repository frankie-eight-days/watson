/**
 * Shell — the app frame: NavRail (left) + Header + routed view + the globally
 * available ConsoleDrawer and the ReplayBar instrument (bottom). The console and
 * replay bar persist across every view; views fill only the canvas above them.
 */
import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { NavRail } from './NavRail';
import { Header } from './Header';
import { ConsoleDrawer } from './ConsoleDrawer';
import { ReplayBar } from './ReplayBar';

const TITLES: Record<string, { title: string; subtitle: string }> = {
  '/bench': { title: 'The Bench', subtitle: 'Hermes scopes the engagement with the client' },
  '/watercooler': { title: 'The Watercooler', subtitle: 'Agents read the repository and converge on a dossier' },
  '/library': { title: 'The Library', subtitle: 'Papers move discovered → screened → distilled → cited → pitched' },
  '/lab': { title: 'The Lab', subtitle: 'Experiments run in the sandbox; the time-horizon climbs' },
  '/conference': { title: 'The Conference', subtitle: 'Pull requests, the report, and the before/after numbers' },
};

export function Shell() {
  const [consoleOpen, setConsoleOpen] = useState(true);
  const { pathname } = useLocation();
  const meta = TITLES[pathname] ?? TITLES['/bench'];

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-bg">
      <NavRail />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header title={meta.title} subtitle={meta.subtitle} />
        <main className="min-h-0 flex-1 overflow-hidden">
          <Outlet />
        </main>
        <ConsoleDrawer open={consoleOpen} onToggle={() => setConsoleOpen((o) => !o)} />
        <ReplayBar />
      </div>
    </div>
  );
}
