/**
 * Shell — the app frame: a slim horizontal TopBar (wordmark + workflow nav +
 * engagement switcher + cost), a global observability AlertBanner, the routed
 * view canvas, and the globally available ConsoleDrawer + ReplayBar (the demo
 * toggle + timeline) at the bottom. Console and replay bar persist across views.
 */
import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { useSelection } from '@/state/hooks';
import { TopBar } from './TopBar';
import { AlertBanner } from './AlertBanner';
import { ConsoleDrawer } from './ConsoleDrawer';
import { ReplayBar } from './ReplayBar';

export function Shell() {
  const [consoleOpen, setConsoleOpen] = useState(true);
  const { selectAgent } = useSelection();

  const focusAgent = (agentId: string) => {
    selectAgent(agentId);
    setConsoleOpen(true);
  };

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-bg">
      <TopBar />
      <AlertBanner onFocusAgent={focusAgent} />
      <main className="min-h-0 flex-1 overflow-hidden">
        <Outlet />
      </main>
      <ConsoleDrawer open={consoleOpen} onToggle={() => setConsoleOpen((o) => !o)} />
      <ReplayBar />
    </div>
  );
}
