/**
 * switcher.tsx — engagement selection, lifted ABOVE the per-engagement provider.
 *
 * The list of engagements is itself derived from Convex (engagements:listEngagements)
 * in live mode, or a single static entry offline. Selecting one remounts the
 * EngagementProvider (keyed by id) so every fold restarts cleanly for the new run.
 *
 * The provider component is chosen ONCE at module load by the presence of the
 * Convex client — so the hook order is fixed and rules-of-hooks hold.
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from 'convex/react';
import { makeFunctionReference } from 'convex/server';
import { DEFAULT_ENGAGEMENT_ID } from '@/lib/config';
import { convex } from '@/lib/convexClient';

export interface EngagementOption {
  engagementId: string;
  title: string;
}

interface SwitcherValue {
  engagements: EngagementOption[];
  engagementId: string;
  setEngagementId: (id: string) => void;
}

const SwitcherContext = createContext<SwitcherValue | null>(null);

export function useSwitcher(): SwitcherValue {
  const ctx = useContext(SwitcherContext);
  if (!ctx) throw new Error('useSwitcher must be used within <SwitcherProvider>');
  return ctx;
}

const FIXTURE_OPTIONS: EngagementOption[] = [
  { engagementId: DEFAULT_ENGAGEMENT_ID, title: 'vending-bench-fork' },
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
    return parts[parts.length - 1] || doc.engagementId;
  }
  return doc.engagementId;
}

function Provider({
  engagements,
  children,
}: {
  engagements: EngagementOption[];
  children: ReactNode;
}) {
  const [engagementId, setEngagementId] = useState(DEFAULT_ENGAGEMENT_ID);
  const value = useMemo(
    () => ({ engagements, engagementId, setEngagementId }),
    [engagements, engagementId],
  );
  return <SwitcherContext.Provider value={value}>{children}</SwitcherContext.Provider>;
}

/** Live: engagements list is a reactive Convex query (default entry while loading). */
function ConvexSwitcherProvider({ children }: { children: ReactNode }) {
  const rows = useQuery(listEngagementsRef) as EngagementDoc[] | undefined;
  const engagements = useMemo<EngagementOption[]>(() => {
    if (!rows || rows.length === 0) return FIXTURE_OPTIONS;
    return rows
      .map((r) => ({ engagementId: r.engagementId, title: titleFor(r) }))
      .sort((a, b) => a.engagementId.localeCompare(b.engagementId));
  }, [rows]);
  return <Provider engagements={engagements}>{children}</Provider>;
}

/** Offline: a single static entry (the fixture engagement). */
function FixtureSwitcherProvider({ children }: { children: ReactNode }) {
  return <Provider engagements={FIXTURE_OPTIONS}>{children}</Provider>;
}

/** Chosen once, at module load, by Convex client presence — fixed hook order. */
export const SwitcherProvider = convex ? ConvexSwitcherProvider : FixtureSwitcherProvider;
