/**
 * ConsoleDrawer — the bottom drawer. Shows the selected agent's live event feed,
 * rendered per type (thought / tool_call+tool_result correlated by callId /
 * handoff / error / status / artifact / metric / steering), plus a REAL steering
 * input box.
 *
 * Steering writes to Convex `steering:appendSteering` (which the brain consumes
 * and which also re-emits a `steering` event into the stream). We echo the line
 * optimistically and dedupe it against that real event by the mutation's returned
 * seq, so it never double-renders. The box is read-only unless an agent is
 * selected, the engagement is live (Convex, not the demo), and the cursor is at
 * the live tail (scrubbing back = replay = read-only).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { type WatsonEvent, isEventType } from '@watson/shared';
import { agentEvents, correlateToolCalls } from '@/lib/fold';
import { useEngagement } from '@/state/hooks';
import { useAppMode } from '@/state/switcher';
import { appendSteering, canWriteSteering } from '@/lib/steering';
import { EVENT_SOURCE } from '@/lib/config';
import { formatClock, formatUsd } from '@/lib/format';
import { StatusDot } from './primitives';

interface PendingSteering {
  id: string;
  agentId: string;
  text: string;
  state: 'sending' | 'sent' | 'error';
  seq?: number;
}

function KV({ data }: { data: Record<string, unknown> | unknown }) {
  const text = useMemo(() => {
    try {
      return typeof data === 'string' ? data : JSON.stringify(data, null, 0);
    } catch {
      return String(data);
    }
  }, [data]);
  return (
    <code className="scroll-slim block max-w-full overflow-x-auto whitespace-pre rounded-md bg-surface-3 px-2 py-1 font-mono text-[0.6875rem] leading-relaxed text-ink-2">
      {text}
    </code>
  );
}

function Gutter({ ev }: { ev: WatsonEvent }) {
  return (
    <div className="flex w-16 shrink-0 flex-col items-end pr-3 pt-0.5">
      <span className="tnum text-[0.625rem] text-ink-3">{formatClock(ev.ts)}</span>
      <span className="tnum text-[0.5625rem] text-ink-3/70">#{ev.seq}</span>
    </div>
  );
}

const TYPE_ACCENT: Record<string, string> = {
  thought: 'var(--ink-3)',
  tool_call: 'var(--accent)',
  tool_result: 'var(--good)',
  handoff: 'var(--warning)',
  error: 'var(--critical)',
  status: 'var(--ink-3)',
  artifact: 'var(--accent)',
  metric: 'var(--accent)',
  steering: 'var(--accent)',
  spawn: 'var(--ink-3)',
};

function Line({
  ev,
  callArgs,
}: {
  ev: WatsonEvent;
  callArgs: Map<string, Record<string, unknown>>;
}) {
  return (
    <div className="animate-fade-slide-in flex border-b border-hairline/60 py-2 last:border-0">
      <Gutter ev={ev} />
      <div
        className="mr-3 mt-1 w-0.5 shrink-0 self-stretch rounded-full"
        style={{ background: TYPE_ACCENT[ev.type] ?? 'var(--hairline-strong)' }}
      />
      <div className="min-w-0 flex-1 pr-4">
        <div className="mb-1 flex items-center gap-2">
          <span className="eyebrow">{ev.type.replace('_', ' ')}</span>
          {typeof ev.costUsd === 'number' && ev.costUsd > 0 && (
            <span className="tnum text-[0.625rem] text-ink-3">{formatUsd(ev.costUsd)}</span>
          )}
        </div>

        {isEventType(ev, 'thought') && (
          <div>
            {ev.payload.title && (
              <div className="text-[0.8125rem] font-semibold text-ink">{ev.payload.title}</div>
            )}
            <p className="text-[0.8125rem] leading-relaxed text-ink-2">{ev.payload.text}</p>
          </div>
        )}

        {isEventType(ev, 'tool_call') && (
          <div className="space-y-1">
            <div className="font-mono text-[0.75rem] text-ink">
              → {ev.payload.tool}
              <span className="text-ink-3">()</span>
            </div>
            <KV data={ev.payload.args} />
          </div>
        )}

        {isEventType(ev, 'tool_result') && (
          <div className="space-y-1">
            <div className="flex items-center gap-2 font-mono text-[0.75rem]">
              <span className={ev.payload.ok ? 'text-[color:var(--good)]' : 'text-[color:var(--critical)]'}>
                {ev.payload.ok ? '✓' : '✕'} {ev.payload.tool}
              </span>
              {ev.payload.callId && callArgs.has(ev.payload.callId) && (
                <span className="text-[0.625rem] text-ink-3">↩ correlated</span>
              )}
            </div>
            {ev.payload.ok ? (
              <KV data={ev.payload.result ?? {}} />
            ) : (
              <div className="rounded-md bg-[color:var(--critical-soft)] px-2 py-1 text-[0.75rem] text-[color:var(--critical)]">
                {ev.payload.error}
              </div>
            )}
          </div>
        )}

        {isEventType(ev, 'handoff') && (
          <div className="text-[0.8125rem]">
            <div className="text-ink">
              Handoff → <span className="font-medium">{ev.payload.toAgentId}</span>
            </div>
            <div className="text-ink-3">{ev.payload.reason}</div>
            <p className="mt-1 text-ink-2">{ev.payload.summary}</p>
          </div>
        )}

        {isEventType(ev, 'error') && (
          <div className="rounded-md bg-[color:var(--critical-soft)] px-2 py-1.5 text-[0.8125rem] text-[color:var(--critical)]">
            {ev.payload.message}
            {ev.payload.recoverable && <span className="ml-1 text-ink-3">(recovered)</span>}
          </div>
        )}

        {isEventType(ev, 'status') && (
          <div className="flex items-center gap-2 text-[0.8125rem] text-ink-2">
            <StatusDot status={ev.payload.status} />
            <span className="capitalize">{ev.payload.status}</span>
            {ev.payload.detail && <span className="text-ink-3">— {ev.payload.detail}</span>}
          </div>
        )}

        {isEventType(ev, 'artifact') && (
          <div className="text-[0.8125rem]">
            <span className="text-ink-3">[{ev.payload.kind}]</span>{' '}
            <span className="font-medium text-ink">{ev.payload.title}</span>
          </div>
        )}

        {isEventType(ev, 'metric') && (
          <div className="tnum text-[0.8125rem] text-ink">
            {ev.payload.name} ={' '}
            <span className="font-semibold text-accent-ink">
              {ev.payload.value}
              {ev.payload.unit ? ` ${ev.payload.unit}` : ''}
            </span>
            {ev.payload.seriesLabel && (
              <span className="ml-1 text-ink-3">· {ev.payload.seriesLabel}</span>
            )}
          </div>
        )}

        {isEventType(ev, 'steering') && (
          <div className="rounded-md bg-accent-soft px-2 py-1 text-[0.8125rem] text-accent-ink">
            {ev.payload.from ?? 'operator'}: {ev.payload.text}
          </div>
        )}

        {isEventType(ev, 'spawn') && (
          <div className="text-[0.8125rem] text-ink-2">
            Spawned as <span className="font-medium text-ink">{ev.payload.role}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function ConsoleDrawer({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  const { events, engagementId, selectedAgentId, agents, replay } = useEngagement();
  const { isDemo } = useAppMode();
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<PendingSteering[]>([]);
  const [confirm, setConfirm] = useState<string | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);

  const feed = useMemo(() => agentEvents(events, selectedAgentId), [events, selectedAgentId]);
  const callArgs = useMemo(() => correlateToolCalls(feed), [feed]);
  const agent = agents.find((a) => a.id === selectedAgentId) ?? null;
  const agentName = agent?.label ?? agent?.role ?? 'agent';

  // The seqs of real steering events already in this agent's feed — used to
  // retire the optimistic echo once the mutation's re-emitted event arrives.
  const realSteeringSeqs = useMemo(
    () => new Set(feed.filter((e) => e.type === 'steering').map((e) => e.seq)),
    [feed],
  );
  const visiblePending = useMemo(
    () =>
      pending.filter(
        (p) => p.agentId === selectedAgentId && !(p.seq != null && realSteeringSeqs.has(p.seq)),
      ),
    [pending, selectedAgentId, realSteeringSeqs],
  );

  // Steering is live-only: an agent must be selected, the source Convex, not the
  // demo engagement, and the cursor at the live tail (scrubbed back = read-only).
  const canSteer =
    !!selectedAgentId && !isDemo && EVENT_SOURCE === 'convex' && replay.atEnd && canWriteSteering();
  const readOnlyHint = !selectedAgentId
    ? 'Select an agent to steer'
    : isDemo || EVENT_SOURCE !== 'convex'
      ? 'Read-only — demo replay'
      : !replay.atEnd
        ? 'Read-only — return to live to steer'
        : `Steer ${agentName}…`;

  // Auto-scroll to newest as the replay streams in.
  useEffect(() => {
    if (open && feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [feed.length, visiblePending.length, open]);

  // Prune optimistic echoes once their real event has landed.
  useEffect(() => {
    setPending((p) => p.filter((x) => !(x.seq != null && realSteeringSeqs.has(x.seq))));
  }, [realSteeringSeqs]);

  // Auto-hide the "sent" confirmation.
  useEffect(() => {
    if (!confirm) return;
    const t = window.setTimeout(() => setConfirm(null), 2600);
    return () => window.clearTimeout(t);
  }, [confirm]);

  const submit = async () => {
    const text = draft.trim();
    if (!text || !canSteer || !selectedAgentId) return;
    const id = `pend_${Date.now()}`;
    const targetId = selectedAgentId;
    const targetName = agentName;
    setPending((p) => [...p, { id, agentId: targetId, text, state: 'sending' }]);
    setDraft('');
    try {
      const res = await appendSteering({ engagementId, agentId: targetId, text, from: 'operator' });
      setPending((p) => p.map((x) => (x.id === id ? { ...x, state: 'sent', seq: res.seq } : x)));
      setConfirm(`sent to ${targetName}`);
    } catch {
      setPending((p) => p.map((x) => (x.id === id ? { ...x, state: 'error' } : x)));
    }
  };

  return (
    <div
      data-tour="console"
      className="flex flex-col border-t border-hairline bg-surface"
      style={{ boxShadow: open ? 'var(--shadow-drawer)' : 'none' }}
    >
      <button
        onClick={onToggle}
        className="focus-ring flex items-center justify-between px-4 py-2.5 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="eyebrow">Console</span>
          {agent ? (
            <span className="flex items-center gap-1.5 text-xs text-ink-2">
              <StatusDot status={agent.status} />
              <span className="font-medium text-ink">{agent.label ?? agent.role}</span>
              <span className="text-ink-3">· {feed.length} events</span>
            </span>
          ) : (
            <span className="text-xs text-ink-3">Select an agent to inspect its steps</span>
          )}
        </div>
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          className={`text-ink-3 transition-transform duration-200 ${open ? '' : 'rotate-180'}`}
        >
          <path d="M2 8 L6 4 L10 8" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      </button>

      {open && (
        <>
          <div ref={feedRef} className="scroll-slim h-56 overflow-y-auto px-4">
            {!selectedAgentId ? (
              <div className="flex h-full items-center justify-center text-sm text-ink-3">
                No agent selected.
              </div>
            ) : feed.length === 0 && visiblePending.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-ink-3">
                No events for this agent yet at the current cursor.
              </div>
            ) : (
              <>
                {feed.map((ev) => (
                  <Line key={`${ev.seq}`} ev={ev} callArgs={callArgs} />
                ))}
                {visiblePending.map((p) => (
                  <div key={p.id} className="animate-fade-slide-in flex border-b border-hairline/60 py-2 last:border-0">
                    <div className="flex w-16 shrink-0 flex-col items-end pr-3 pt-0.5">
                      <span className="text-[0.625rem] text-ink-3">
                        {p.state === 'error' ? 'failed' : p.state === 'sent' ? 'sent' : 'sending…'}
                      </span>
                    </div>
                    <div
                      className="mr-3 mt-1 w-0.5 shrink-0 self-stretch rounded-full"
                      style={{ background: p.state === 'error' ? 'var(--critical)' : 'var(--accent)' }}
                    />
                    <div className="min-w-0 flex-1 pr-4">
                      <div className="mb-1 eyebrow">steering</div>
                      <div
                        className="rounded-md px-2 py-1 text-[0.8125rem]"
                        style={
                          p.state === 'error'
                            ? { background: 'var(--critical-soft)', color: 'var(--critical)' }
                            : { background: 'var(--accent-soft)', color: 'var(--accent-ink)', opacity: p.state === 'sending' ? 0.7 : 1 }
                        }
                      >
                        operator: {p.text}
                        {p.state === 'error' && <span className="ml-2 text-[0.6875rem]">— not delivered</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>

          <div className="border-t border-hairline px-4 py-2.5">
            <div className="flex items-center gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
                disabled={!canSteer}
                placeholder={readOnlyHint}
                className="focus-ring flex-1 rounded-lg border border-hairline bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-ink-3 disabled:opacity-50"
              />
              <button
                onClick={submit}
                disabled={!canSteer || !draft.trim()}
                className="focus-ring rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                Send
              </button>
            </div>
            {confirm && (
              <div className="animate-fade-in mt-1.5 flex items-center gap-1.5 text-[0.6875rem] text-ink-3">
                <span className="text-[color:var(--good)]">✓</span>
                <span>{confirm}</span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
