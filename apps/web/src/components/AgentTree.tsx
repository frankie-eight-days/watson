/**
 * AgentTree — the org chart, folded from spawn events (parentAgentId → children;
 * null parent = Hermes root). Collapsible orchestrator→worker rows, a status dot
 * per agent, per-agent (and rolled-up subtree) token + cost totals in tabular
 * figures, and click-to-select. Pure event-derived; nothing here reads state
 * that isn't in the stream except the collapse/selection UI toggles.
 */
import { useMemo, useState } from 'react';
import { subtreeTotals, type AgentNode, type AgentTotals } from '@/lib/fold';
import { useAgents, useSelection } from '@/state/hooks';
import { formatTokens, formatUsd } from '@/lib/format';
import { StatusDot, TierBadge, Eyebrow, EmptyState } from './primitives';

function Row({
  node,
  totals,
  collapsed,
  toggle,
  selectedId,
  onSelect,
}: {
  node: AgentNode;
  totals: Map<string, AgentTotals>;
  collapsed: Set<string>;
  toggle: (id: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isCollapsed = collapsed.has(node.id);
  const roll = subtreeTotals(node, totals);
  const selected = selectedId === node.id;
  const name = node.label ?? node.role;

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSelect(node.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect(node.id);
          }
        }}
        className={`focus-ring group flex cursor-pointer items-center gap-2 rounded-lg py-1.5 pr-2 transition-colors ${
          selected ? 'bg-accent-soft' : 'hover:bg-surface-2'
        }`}
        style={{ paddingLeft: 8 + node.depth * 16 }}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) toggle(node.id);
          }}
          className={`flex h-4 w-4 shrink-0 items-center justify-center text-ink-3 ${
            hasChildren ? 'hover:text-ink' : 'invisible'
          }`}
          aria-label={isCollapsed ? 'Expand' : 'Collapse'}
          tabIndex={-1}
        >
          <svg
            width="9"
            height="9"
            viewBox="0 0 9 9"
            className={`transition-transform duration-200 ${isCollapsed ? '' : 'rotate-90'}`}
          >
            <path d="M2 1 L7 4.5 L2 8 Z" fill="currentColor" />
          </svg>
        </button>

        <StatusDot status={node.status} />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              className={`truncate text-[0.8125rem] ${selected ? 'font-semibold text-ink' : 'font-medium text-ink'}`}
            >
              {name}
            </span>
          </div>
          <div className="truncate text-[0.6875rem] text-ink-3">{node.model}</div>
        </div>

        <div className="flex shrink-0 flex-col items-end">
          <span className="tnum text-[0.75rem] font-medium text-ink">{formatUsd(roll.costUsd)}</span>
          <span className="tnum text-[0.625rem] text-ink-3">
            {formatTokens(roll.tokensIn + roll.tokensOut)} tok
          </span>
        </div>
      </div>

      {hasChildren && !isCollapsed && (
        <div className="animate-fade-in">
          {node.children.map((c) => (
            <Row
              key={c.id}
              node={c}
              totals={totals}
              collapsed={collapsed}
              toggle={toggle}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function AgentTree() {
  const { agentTree, totals, agents } = useAgents();
  const { selectedAgentId, selectAgent } = useSelection();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setCollapsed((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const activeCount = useMemo(
    () => agents.filter((a) => a.status === 'running' || a.status === 'waiting').length,
    [agents],
  );

  return (
    <div className="flex h-full flex-col border-r border-hairline bg-surface">
      <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
        <Eyebrow>Org chart</Eyebrow>
        <span className="tnum text-[0.6875rem] text-ink-3">
          {agents.length} agents · {activeCount} active
        </span>
      </div>
      <div className="scroll-slim min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {agentTree.length === 0 ? (
          <EmptyState title="No agents yet" hint="Hermes spawns the org as the engagement begins." />
        ) : (
          agentTree.map((n) => (
            <Row
              key={n.id}
              node={n}
              totals={totals}
              collapsed={collapsed}
              toggle={toggle}
              selectedId={selectedAgentId}
              onSelect={selectAgent}
            />
          ))
        )}
      </div>
      {selectedAgentId && (
        <div className="border-t border-hairline px-4 py-2">
          {(() => {
            const a = agents.find((x) => x.id === selectedAgentId);
            if (!a) return null;
            return (
              <div className="flex items-center gap-2">
                <TierBadge tier={a.tier} />
                <span className="truncate text-xs text-ink-2">{a.role}</span>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
