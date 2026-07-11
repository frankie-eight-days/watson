/**
 * App — routing + the EngagementProvider that owns the shared replay cursor.
 * The five views are wired here; AgentTree/ConsoleDrawer/ReplayBar live in Shell.
 */
import { Navigate, Route, Routes } from 'react-router-dom';
import { EngagementProvider } from '@/state/EngagementProvider';
import { DEFAULT_ENGAGEMENT_ID } from '@/lib/config';
import { Shell } from '@/components/Shell';
import { BenchView } from '@/views/BenchView';
import { WatercoolerView } from '@/views/WatercoolerView';
import { LibraryView } from '@/views/LibraryView';
import { LabView } from '@/views/LabView';
import { ConferenceView } from '@/views/ConferenceView';

export function App() {
  return (
    <EngagementProvider engagementId={DEFAULT_ENGAGEMENT_ID}>
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
