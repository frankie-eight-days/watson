/**
 * Bench — the scoping transcript. Renders Hermes' thought + artifact scoping
 * events as a consulting-president conversation, with a (disabled) repo-URL
 * field and a styled COMMENCE RESEARCH button. All from the event stream.
 */
import { useMemo } from 'react';
import { isEventType } from '@watson/shared';
import { useEngagementEvents } from '@/state/hooks';
import { Canvas, SectionHeader } from './_layout';
import { Eyebrow, EmptyState } from '@/components/primitives';
import { formatClock } from '@/lib/format';

export function BenchView() {
  const events = useEngagementEvents();

  const transcript = useMemo(
    () =>
      events.filter(
        (e) =>
          e.agentId === 'hermes' &&
          (isEventType(e, 'thought') || (isEventType(e, 'artifact') && e.payload.kind === 'card')),
      ),
    [events],
  );

  return (
    <Canvas>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* transcript */}
        <div>
          <SectionHeader eyebrow="Scoping conversation" title="Hermes at the Bench" />
          <div className="hairline-card overflow-hidden">
            {transcript.length === 0 ? (
              <EmptyState title="The client has just arrived" hint="Hermes is preparing to scope the engagement." />
            ) : (
              <div className="divide-y divide-[color:var(--hairline)]">
                {transcript.map((e) => (
                  <div key={e.seq} className="animate-fade-slide-in flex gap-3 px-5 py-4">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[0.625rem] font-semibold text-accent-ink">
                      H
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center gap-2">
                        <span className="text-xs font-semibold text-ink">Hermes</span>
                        <span className="tnum text-[0.625rem] text-ink-3">{formatClock(e.ts)}</span>
                      </div>
                      {isEventType(e, 'thought') && (
                        <>
                          {e.payload.title && (
                            <div className="text-sm font-semibold text-ink">{e.payload.title}</div>
                          )}
                          <p className="text-sm leading-relaxed text-ink-2">{e.payload.text}</p>
                        </>
                      )}
                      {isEventType(e, 'artifact') && (
                        <div className="rounded-lg bg-surface-2 px-3 py-2">
                          <Eyebrow>Scope note</Eyebrow>
                          <div className="text-sm font-medium text-ink">{e.payload.title}</div>
                          {e.payload.body && <p className="mt-1 text-[0.8125rem] text-ink-2">{e.payload.body}</p>}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* commence panel */}
        <aside>
          <SectionHeader eyebrow="Engagement" title="Commence" />
          <div className="hairline-card p-5">
            <Eyebrow>Target repository</Eyebrow>
            <input
              disabled
              value="github.com/watson-labs/vending-bench-fork"
              className="mt-1.5 w-full cursor-not-allowed rounded-lg border border-hairline bg-surface-2 px-3 py-2 text-[0.8125rem] text-ink-2"
            />
            <p className="mt-2 text-xs text-ink-3">
              Wired to the Bench TUI over WebSocket in the live build (Tab B). Disabled during replay.
            </p>
            <button
              disabled
              className="mt-4 w-full cursor-not-allowed rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold tracking-wide text-white opacity-60"
            >
              COMMENCE RESEARCH
            </button>
          </div>
        </aside>
      </div>
    </Canvas>
  );
}
