/**
 * switcher.tsx — engagement selection + the "Demo replay" toggle, lifted ABOVE
 * the per-engagement provider.
 *
 * The engagement list is derived from Convex (engagements:listEngagements) in
 * live mode, or a single static entry offline. The demo engagement(s)
 * (config.DEMO_ENGAGEMENT_IDS) are shown only when `showDemo` is on and are
 * always flagged so fixture data never reads as a live run. Selecting an
 * engagement remounts the EngagementProvider (keyed by id) so folds restart.
 *
 * The provider component is chosen ONCE at module load by Convex client presence
 * — so hook order is fixed and rules-of-hooks hold.
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from 'convex/react';
import { makeFunctionReference } from 'convex/server';
import { DEFAULT_ENGAGEMENT_ID, isDemoEngagement } from '@/lib/config';
import { convex } from '@/lib/convexClient';

export interface EngagementOption {
  engagementId: string;
  title: string;
  demo: boolean;
}

interface AppModeValue {
  /** All rows known (live + demo), regardless of the toggle. */
  all: EngagementOption[];
  /** The rows offered in the switcher given the current toggle. */
  options: EngagementOption[];
  liveCount: number;
  showDemo: boolean;
  setShowDemo: (b: boolean) => void;
  /** '' when nothing valid is selectable (demo off + no live) → clean empty state. */
  engagementId: string;
  setEngagementId: (id: string) => void;
  isDemo: boolean;
  /** False when there is no resolvable engagement to render. */
  hasEngagement: boolean;
}

const AppModeContext = createContext<AppModeValue | null>(null);

export function useAppMode(): AppModeValue {
  const ctx = useContext(AppModeContext);
  if (!ctx) throw new Error('useAppMode must be used within <AppModeProvider>');
  return ctx;
}

const FIXTURE_ROWS: EngagementOption[] = [
  { engagementId: DEFAULT_ENGAGEMENT_ID, title: 'vending-bench-fork', demo: true },
];

const listEngagementsRef = makeFunctionReference<'query'>('engagements:listEngagements');

interface EngagementDoc {
  engagementId: string;
  title?: string;
  repoUrl?: string;
}

function titleFor(doc: EngagementDoc): string {
  if (doc.title) return doc.title;
  if (doc.repoUrl) {
    const parts = doc.repoUrl.replace(/\/$/, '').split('/');
    if (parts[parts.length - 1]) return parts[parts.length - 1];
  }
  return doc.engagementId;
}

function Provider({ all, children }: { all: EngagementOption[]; children: ReactNode }) {
  const [showDemo, setShowDemo] = useState(true);
  const [selected, setSelected] = useState(DEFAULT_ENGAGEMENT_ID);

  const value = useMemo<AppModeValue>(() => {
    const demos = all.filter((o) => o.demo);
    const live = all.filter((o) => !o.demo);
    const options = showDemo ? [...demos, ...live] : live;
    // Resolve to the selected id ONLY if it still exists in the current options;
    // otherwise fall to the first option, or '' (no engagement) when none exist.
    // Never silently fall back to the demo id when demo is off — that's the bug.
    const engagementId = options.some((o) => o.engagementId === selected)
      ? selected
      : options[0]?.engagementId ?? '';
    return {
      all,
      options,
      liveCount: live.length,
      showDemo,
      setShowDemo,
      engagementId,
      setEngagementId: setSelected,
      isDemo: engagementId !== '' && isDemoEngagement(engagementId),
      hasEngagement: engagementId !== '',
    };
  }, [all, showDemo, selected]);

  return <AppModeContext.Provider value={value}>{children}</AppModeContext.Provider>;
}

/** Live: the engagement list is a reactive Convex query. */
function ConvexAppModeProvider({ children }: { children: ReactNode }) {
  const rows = useQuery(listEngagementsRef) as EngagementDoc[] | undefined;
  const all = useMemo<EngagementOption[]>(() => {
    if (!rows) return FIXTURE_ROWS;
    const mapped = rows.map((r) => ({
      engagementId: r.engagementId,
      title: titleFor(r),
      demo: isDemoEngagement(r.engagementId),
    }));
    // Ensure the demo entry exists even before the list resolves fully.
    if (!mapped.some((o) => o.demo)) mapped.push(...FIXTURE_ROWS);
    return mapped.sort((a, b) => {
      if (a.demo !== b.demo) return a.demo ? -1 : 1; // demo first
      return b.engagementId.localeCompare(a.engagementId); // newest-ish live first
    });
  }, [rows]);
  return <Provider all={all}>{children}</Provider>;
}

/** Offline: a single static entry (the demo/fixture engagement). */
function FixtureAppModeProvider({ children }: { children: ReactNode }) {
  return <Provider all={FIXTURE_ROWS}>{children}</Provider>;
}

/** Chosen once, at module load, by Convex client presence — fixed hook order. */
export const AppModeProvider = convex ? ConvexAppModeProvider : FixtureAppModeProvider;
