/**
 * hooks.ts — the read API for view components.
 *
 * Views never touch the source or the cursor directly; they call these hooks,
 * which always return event-derived state at the current cursor position.
 */
import { useContext } from 'react';
import { EngagementContext, type EngagementContextValue } from './EngagementProvider';

export function useEngagement(): EngagementContextValue {
  const ctx = useContext(EngagementContext);
  if (!ctx) throw new Error('useEngagement must be used within <EngagementProvider>');
  return ctx;
}

/** WatsonEvent[] visible up to the current replay cursor (seq-sorted). */
export function useEngagementEvents() {
  return useEngagement().events;
}

/** AgentRecord[] folded from spawn+status events, up to the cursor. */
export function useAgents() {
  const { agents, agentTree, totals } = useEngagement();
  return { agents, agentTree, totals };
}

/** The shared replay cursor controls. */
export function useReplay() {
  return useEngagement().replay;
}

/** Selected-agent UI state (selection is UI-only, not derived from events). */
export function useSelection() {
  const { selectedAgentId, selectAgent, agents } = useEngagement();
  const selectedAgent = agents.find((a) => a.id === selectedAgentId) ?? null;
  return { selectedAgentId, selectedAgent, selectAgent };
}
