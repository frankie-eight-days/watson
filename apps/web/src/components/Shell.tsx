/**
 * Shell — the app frame: a slim horizontal TopBar (wordmark + workflow nav +
 * engagement switcher + cost), the routed view canvas, and the globally
 * available ConsoleDrawer + ReplayBar (the demo toggle + timeline) at the bottom.
 * The console and replay bar persist across every view; views fill the canvas.
 */
import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { TopBar } from './TopBar';
import { ConsoleDrawer } from './ConsoleDrawer';
import { ReplayBar } from './ReplayBar';

export function Shell() {
  const [consoleOpen, setConsoleOpen] = useState(true);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-bg">
      <TopBar />
      <main className="min-h-0 flex-1 overflow-hidden">
        <Outlet />
      </main>
      <ConsoleDrawer open={consoleOpen} onToggle={() => setConsoleOpen((o) => !o)} />
      <ReplayBar />
    </div>
  );
}
