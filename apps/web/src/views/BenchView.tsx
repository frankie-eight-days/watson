/**
 * Bench — a live terminal to Hermes. ONE surface: the connection state, the
 * COMMENCE kickoff, a monospace scrollback that streams Hermes's live working
 * (spawn / thought / tool_call / handoff / status / artifact / error events,
 * cursor-bound so it also "types out" during replay), the direct WS chat, and a
 * prompt line. Terminal aesthetic living inside the light lab theme.
 *
 * The scrollback body is pure event-stream render (replay-safe); the WS overlays
 * the interactive chat + kickoff. COMMENCE sends over the same socket and greys
 * out to a running state once the engagement is under way.
 */
import { useMemo, useRef, useState, useEffect } from 'react';
import { isEventType } from '@watson/shared';
import { useEngagement, useSelection } from '@/state/hooks';
import { useAppMode } from '@/state/switcher';
import { useBenchSocket, type BenchStatus } from '@/lib/useBenchSocket';
import { inferPhase } from '@/lib/fold';
import { formatClock } from '@/lib/format';

type LineKind =
  | 'spawn'
  | 'thought'
  | 'tool'
  | 'handoff'
  | 'status'
  | 'artifact'
  | 'error'
  | 'user'
  | 'hermes'
  | 'system';

interface TermLine {
  id: string;
  ts: number;
  kind: LineKind;
  who?: string;
  text: string;
  agentId?: string;
}

const GLYPH: Record<LineKind, { mark: string; color: string }> = {
  spawn: { mark: '+', color: 'var(--good)' },
  thought: { mark: '›', color: 'var(--accent-ink)' },
  tool: { mark: '⚙', color: 'var(--ink-3)' },
  handoff: { mark: '⇄', color: 'var(--warning)' },
  status: { mark: '●', color: 'var(--ink-3)' },
  artifact: { mark: '◆', color: 'var(--accent)' },
  error: { mark: '✗', color: 'var(--critical)' },
  user: { mark: '$', color: 'var(--ink)' },
  hermes: { mark: '›', color: 'var(--accent-ink)' },
  system: { mark: '—', color: 'var(--ink-3)' },
};

const CONN: Record<BenchStatus, { dot: string; label: string; color: string }> = {
  connecting: { dot: '◐', label: 'HERMES CONNECTING', color: 'var(--warning)' },
  open: { dot: '●', label: 'HERMES ONLINE', color: 'var(--good)' },
  closed: { dot: '○', label: 'HERMES OFFLINE', color: 'var(--ink-3)' },
  error: { dot: '○', label: 'HERMES UNREACHABLE', color: 'var(--critical)' },
};

const DEFAULT_REPO = 'https://github.com/frankie-eight-days/watson-vending-bench';
const looksLikeGithubUrl = (u: string) =>
  /^(https?:\/\/)?(www\.)?github\.com\/[\w.-]+\/[\w.-]+/i.test(u.trim());

export function BenchView() {
  const { events, engagementId, agents } = useEngagement();
  const { isDemo } = useAppMode();
  const { selectAgent } = useSelection();
  const { status, messages, agentState, sendUser, commence } = useBenchSocket(engagementId);
  const [draft, setDraft] = useState('');
  const [repoUrl, setRepoUrl] = useState(DEFAULT_REPO);
  const [repoEdited, setRepoEdited] = useState(false);
  const [commenceSent, setCommenceSent] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Conversationally-scoped repo/ready flowing from the brain over the socket.
  const stateRepoUrl = typeof agentState?.repoUrl === 'string' ? agentState.repoUrl.trim() : '';
  const stateReady = agentState?.ready === true;

  // Reflect the scoped repo into the field until the operator takes over.
  useEffect(() => {
    if (!repoEdited && stateRepoUrl) setRepoUrl(stateRepoUrl);
  }, [stateRepoUrl, repoEdited]);

  // Event-stream working feed (replay-safe, cursor-bound).
  const eventLines = useMemo<TermLine[]>(() => {
    const out: TermLine[] = [];
    for (const e of events) {
      const base = { id: `ev_${e.seq}`, ts: e.ts, who: e.agentId, agentId: e.agentId };
      if (isEventType(e, 'spawn'))
        out.push({ ...base, kind: 'spawn', text: `spawned ${e.payload.role} · ${e.payload.tier} · ${e.payload.model}` });
      else if (isEventType(e, 'thought'))
        out.push({ ...base, kind: 'thought', text: e.payload.title ? `${e.payload.title} — ${e.payload.text}` : e.payload.text });
      else if (isEventType(e, 'tool_call'))
        out.push({ ...base, kind: 'tool', text: `${e.payload.tool}(${Object.keys(e.payload.args ?? {}).join(', ')})` });
      else if (isEventType(e, 'handoff'))
        out.push({ ...base, kind: 'handoff', text: `→ ${e.payload.toAgentId}: ${e.payload.reason}` });
      else if (isEventType(e, 'status'))
        out.push({ ...base, kind: 'status', text: `${e.payload.status}${e.payload.detail ? ` · ${e.payload.detail}` : ''}` });
      else if (isEventType(e, 'artifact'))
        out.push({ ...base, kind: 'artifact', text: `${e.payload.kind}: ${e.payload.title}` });
      else if (isEventType(e, 'error'))
        out.push({
          ...base,
          kind: 'error',
          text: `${e.payload.message}${e.payload.fatal ? ' (fatal)' : e.payload.recoverable ? ' (recovered)' : ''}`,
        });
    }
    return out;
  }, [events]);

  // Merge with the WS chat overlay, time-ordered.
  const lines = useMemo<TermLine[]>(() => {
    const wsLines: TermLine[] = messages.map((m) => ({ id: m.id, ts: m.ts, kind: m.role, text: m.text }));
    return [...eventLines, ...wsLines].sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));
  }, [eventLines, messages]);

  const phase = inferPhase(events);
  const running = commenceSent || agents.length > 1 || phase !== 'Bench';
  const conn = CONN[status];

  // Prefer the field; fall back to the conversationally-scoped repo when empty.
  const effectiveRepo = (repoUrl.trim() || stateRepoUrl).trim();
  const repoValid = looksLikeGithubUrl(effectiveRepo);
  const canCommence = !running && (repoValid || stateReady);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [lines.length]);

  const doCommence = () => {
    if (!canCommence) return;
    setCommenceSent(true);
    commence(effectiveRepo);
  };

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      {/* kickoff card */}
      <div className="rounded-xl border border-hairline bg-surface p-4 shadow-card">
        {/* connection + engagement */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5" style={{ color: conn.color }}>
            <span className="relative flex items-center">
              {status === 'open' && (
                <span className="absolute h-2 w-2 animate-ping rounded-full opacity-60" style={{ background: conn.color }} />
              )}
              <span className="text-[0.75rem] leading-none">{conn.dot}</span>
            </span>
            <span className="font-mono text-[0.75rem] font-semibold tracking-wide">{conn.label}</span>
          </span>
          <span className="font-mono text-[0.6875rem] text-ink-3">· {engagementId}</span>
          {isDemo && (
            <span className="rounded-pill bg-[color:var(--warning-soft)] px-1.5 py-0.5 text-[0.5625rem] font-bold uppercase tracking-wider text-[color:var(--warning)]">
              Demo
            </span>
          )}
          {stateReady && (
            <span className="ml-auto flex items-center gap-1 rounded-pill bg-[color:var(--good-soft)] px-2 py-0.5 text-[0.625rem] font-semibold text-[color:var(--good)]">
              ✓ Scoped &amp; ready
            </span>
          )}
        </div>

        {/* target repository */}
        <label htmlFor="repo-url" className="eyebrow mb-1.5 block">
          Target repository
        </label>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
          <input
            id="repo-url"
            value={repoUrl}
            onChange={(e) => {
              setRepoEdited(true);
              setRepoUrl(e.target.value);
            }}
            disabled={running}
            spellCheck={false}
            autoComplete="off"
            placeholder="https://github.com/owner/repo"
            className="focus-ring min-w-0 flex-1 rounded-lg border border-hairline bg-surface-2 px-3.5 py-2.5 font-mono text-[0.875rem] tabular-nums tracking-tight text-ink placeholder:text-ink-3 disabled:opacity-50"
          />
          <button
            onClick={doCommence}
            disabled={!canCommence}
            className={`focus-ring flex shrink-0 items-center justify-center gap-1.5 rounded-lg px-5 py-2.5 text-sm font-semibold tracking-wide transition-opacity ${
              running
                ? 'cursor-not-allowed bg-surface-2 text-ink-3'
                : 'bg-accent text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40'
            }`}
          >
            {running ? (
              <>
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[color:var(--good)]" />
                RESEARCH RUNNING
              </>
            ) : (
              'COMMENCE RESEARCH'
            )}
          </button>
        </div>

        {/* hint */}
        <p className="mt-2 text-[0.6875rem] text-ink-3">
          {running
            ? 'Engagement under way — Hermes has taken the brief.'
            : stateRepoUrl && !repoEdited
              ? `Scoped from the conversation · ${stateRepoUrl}`
              : !repoValid && stateReady
                ? 'Hermes scoped the repo in conversation — ready to commence.'
                : 'Paste a GitHub repo, or let Hermes scope it in the chat below.'}
          {!running && (status === 'open' ? ' Sends over the live socket.' : ' Socket down — falls back to the HTTP kickoff.')}
        </p>
      </div>

      {/* terminal */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-hairline bg-surface shadow-card">
        {/* title bar */}
        <div className="flex items-center gap-2 border-b border-hairline bg-surface-2 px-3.5 py-2">
          <span className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: 'var(--hairline-strong)' }} />
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: 'var(--hairline-strong)' }} />
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: 'var(--hairline-strong)' }} />
          </span>
          <span className="font-mono text-[0.6875rem] text-ink-3">hermes@watson — bench</span>
        </div>

        {/* scrollback */}
        <div ref={scrollRef} className="scroll-slim min-h-0 flex-1 overflow-y-auto px-4 py-3 font-mono text-[0.75rem] leading-relaxed">
          {lines.length === 0 ? (
            <div className="text-ink-3">
              <span style={{ color: 'var(--good)' }}>hermes@watson</span>:~$ awaiting the client…{' '}
              <span className="animate-pulse">▮</span>
            </div>
          ) : (
            lines.map((l) => {
              const g = GLYPH[l.kind];
              const isChat = l.kind === 'user' || l.kind === 'hermes' || l.kind === 'system';
              const clickable = !!l.agentId;
              return (
                <div
                  key={l.id}
                  onClick={clickable ? () => selectAgent(l.agentId!) : undefined}
                  className={`animate-fade-slide-in flex gap-2 py-[1px] ${
                    clickable ? 'cursor-pointer rounded hover:bg-surface-2' : ''
                  }`}
                >
                  <span className="shrink-0 tabular-nums text-ink-3 opacity-60">{formatClock(l.ts)}</span>
                  <span className="shrink-0 font-semibold" style={{ color: g.color }}>
                    {g.mark}
                  </span>
                  {l.who && !isChat && <span className="shrink-0 text-ink-2">{l.who}</span>}
                  {l.kind === 'user' && <span className="shrink-0 font-semibold text-ink">you</span>}
                  {l.kind === 'hermes' && <span className="shrink-0 font-semibold" style={{ color: 'var(--accent-ink)' }}>hermes</span>}
                  <span className={l.kind === 'error' ? 'text-[color:var(--critical)]' : isChat ? 'text-ink' : 'text-ink-2'}>
                    {l.text}
                  </span>
                </div>
              );
            })
          )}
        </div>

        {/* prompt */}
        <form
          className="flex items-center gap-2 border-t border-hairline bg-surface px-4 py-2.5 font-mono text-[0.75rem]"
          onSubmit={(e) => {
            e.preventDefault();
            sendUser(draft);
            setDraft('');
          }}
        >
          <span className="shrink-0 font-semibold" style={{ color: conn.color }}>
            you@bench
          </span>
          <span className="shrink-0 text-ink-3">$</span>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={status === 'open' ? 'message Hermes…' : 'connecting to Hermes…'}
            className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-3"
          />
          <button
            type="submit"
            disabled={!draft.trim()}
            className="focus-ring shrink-0 rounded-md bg-surface-2 px-2.5 py-1 text-[0.6875rem] font-medium text-ink-2 hover:text-ink disabled:opacity-40"
          >
            send ↵
          </button>
        </form>
      </div>
    </div>
  );
}
