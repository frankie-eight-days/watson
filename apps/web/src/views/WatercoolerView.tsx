/**
 * Watercooler — repo ingestion. AgentTree (left) + a canvas of artifact cards
 * from the ingestion agents, converging to the Repo Dossier.
 */
import { useMemo } from 'react';
import { useEngagementEvents } from '@/state/hooks';
import { foldArtifacts } from '@/lib/fold';
import { Canvas, SectionHeader, TreeLayout } from './_layout';
import { EventCard } from '@/components/EventCard';
import { EmptyState } from '@/components/primitives';

export function WatercoolerView() {
  const events = useEngagementEvents();

  const { cards, dossier } = useMemo(() => {
    const arts = foldArtifacts(events);
    return {
      cards: arts.filter((a) => a.payload.kind === 'card' && a.agentId !== 'hermes'),
      dossier: arts.find((a) => a.payload.kind === 'dossier') ?? null,
    };
  }, [events]);

  return (
    <TreeLayout>
      <Canvas>
        <SectionHeader eyebrow="Repo ingestion" title="Reading the harness" />

        <div data-tour="watercooler">
        {dossier && (
          <div className="mb-6">
            <div className="hairline-card animate-fade-slide-in overflow-hidden">
              <div className="border-b border-hairline bg-accent-soft px-5 py-3">
                <div className="eyebrow text-accent-ink">Converged · Repo Dossier</div>
                <div className="mt-0.5 text-base font-semibold text-ink">{dossier.payload.title}</div>
              </div>
              {dossier.payload.body && (
                <p className="whitespace-pre-line px-5 py-4 text-[0.8125rem] leading-relaxed text-ink-2">
                  {dossier.payload.body}
                </p>
              )}
            </div>
          </div>
        )}

        {cards.length === 0 && !dossier ? (
          <EmptyState title="Agents are cloning the repo" hint="Findings appear here as the crew reads the harness." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {cards.map((a) => (
              <EventCard key={a.seq} artifact={a} dense />
            ))}
          </div>
        )}
        </div>
      </Canvas>
    </TreeLayout>
  );
}
