/**
 * App — routing + the EngagementProvider that owns the shared replay cursor.
 * The five views are wired here; AgentTree/ConsoleDrawer/ReplayBar live in Shell.
 */
import { Navigate, Route, Routes } from 'react-router-dom';
import { EngagementProvider } from '@/state/EngagementProvider';
import { AppModeProvider, useAppMode } from '@/state/switcher';
import { Shell } from '@/components/Shell';
import { BenchView } from '@/views/BenchView';
import { WatercoolerView } from '@/views/WatercoolerView';
import { LibraryView } from '@/views/LibraryView';
import { LabView } from '@/views/LabView';
import { ConferenceView } from '@/views/ConferenceView';

/** The selected engagement drives (and re-keys) the per-engagement provider. */
function Routed() {
  const { engagementId } = useAppMode();
  return (
    <EngagementProvider key={engagementId} engagementId={engagementId}>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Navigate to="/lab" replace />} />
          <Route path="/bench" element={<BenchView />} />
          <Route path="/watercooler" element={<WatercoolerView />} />
          <Route path="/library" element={<LibraryView />} />
          <Route path="/lab" element={<LabView />} />
          <Route path="/conference" element={<ConferenceView />} />
          <Route path="*" element={<Navigate to="/lab" replace />} />
        </Route>
      </Routes>
    </EngagementProvider>
  );
}

export function App() {
  return (
    <AppModeProvider>
      <Routed />
    </AppModeProvider>
  );
}
