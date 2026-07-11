/**
 * Library — the paper pipeline as a Kanban. Each paper's stage is INFERRED FROM
 * THE EVENT STREAM (which agent/tool/metric touched it), so cards flow left→right
 * across columns as the replay cursor advances.
 *
 * Two event vocabularies are supported side by side (replay-safe, generic):
 *   • Legacy (mock fixture): agent ids w_paper_scout/w_screener/w_deep_reader,
 *     metric 'relevance_score', pitch bodies referencing paper_\d+ refIds.
 *   • Real run: paper artifacts from any agent, metric name 'relevance' whose
 *     seriesLabel is the paper refId, and pitches whose payload.url matches a
 *     paper url. Pitches themselves surface as cards in the Pitched column.
 */
import { useMemo } from 'react';
import { isEventType } from '@watson/shared';
import { useEngagementEvents } from '@/state/hooks';
import { type ArtifactEvent, artifactsOfKind, latestArtifactByRef } from '@/lib/fold';
import { Canvas, SectionHeader, TreeLayout } from './_layout';
import { KanbanBoard, type KanbanStage } from '@/components/KanbanBoard';
import { EventCard } from '@/components/EventCard';
import { formatNum } from '@/lib/format';

const STAGES: KanbanStage[] = [
  { id: 'discovered', label: 'Discovered' },
  { id: 'screened', label: 'Screened' },
  { id: 'distilled', label: 'Distilled' },
  { id: 'cited', label: 'Cited' },
  { id: 'pitched', label: 'Pitched' },
];
const RANK: Record<string, number> = { discovered: 0, screened: 1, distilled: 2, cited: 3, pitched: 4 };
const STAGE_ACCENT: Record<string, string> = {
  discovered: 'var(--ink-3)',
  screened: 'var(--accent)',
  distilled: 'var(--accent)',
  cited: 'var(--good)',
  pitched: 'var(--warning)',
};

interface PaperCard {
  refId: string;
  title: string;
  url?: string;
  stage: string;
  score?: number;
  rep: ArtifactEvent; // representative artifact event for keying
}

/** Normalize a url for equality: trim, drop trailing slash, http==https, lowercase. */
function normUrl(u?: string): string {
  if (!u) return '';
  return u
    .trim()
    .replace(/^http:\/\//i, 'https://')
    .replace(/\/+$/, '')
    .toLowerCase();
}

export function LibraryView() {
  const events = useEngagementEvents();

  const { papers, pitches, byRep, pitchSeqs } = useMemo(() => {
    const map = new Map<string, PaperCard>();
    let lastRelevance: number | undefined;

    const bump = (ref: string, stage: string, patch: Partial<PaperCard> = {}, rep?: ArtifactEvent) => {
      const cur = map.get(ref);
      const better = !cur || RANK[stage] >= RANK[cur.stage];
      map.set(ref, {
        refId: ref,
        title: patch.title ?? cur?.title ?? ref,
        url: patch.url ?? cur?.url,
        score: patch.score ?? cur?.score,
        stage: better ? stage : cur!.stage,
        rep: rep ?? cur?.rep ?? patch.rep!,
      });
    };

    for (const e of events) {
      // Relevance — legacy scalar carried into the next screener bump …
      if (isEventType(e, 'metric') && e.payload.name === 'relevance_score') {
        lastRelevance = e.payload.value;
        continue;
      }
      // … and the real-run form: seriesLabel IS the paper refId.
      if (isEventType(e, 'metric') && e.payload.name === 'relevance' && e.payload.seriesLabel) {
        bump(e.payload.seriesLabel, 'screened', { score: e.payload.value });
        continue;
      }
      // Legacy citation tool.
      if (isEventType(e, 'tool_call') && e.agentId === 'w_citation') {
        const pid = (e.payload.args as { paperId?: string }).paperId;
        if (pid) bump(pid, 'cited');
        continue;
      }
      // Paper artifact — ANY agent, ANY refId bumps to discovered (generic);
      // legacy agent ids then layer screened / distilled on top.
      if (isEventType(e, 'artifact') && e.payload.kind === 'paper' && e.payload.refId) {
        const ref = e.payload.refId;
        bump(ref, 'discovered', { title: e.payload.title, url: e.payload.url, rep: e }, e);
        if (e.agentId === 'w_screener') bump(ref, 'screened', { score: lastRelevance });
        else if (e.agentId === 'w_deep_reader') bump(ref, 'distilled');
        continue;
      }
    }

    // Pitches: collapse to latest per refId, and use them to cite papers.
    const pitchList = latestArtifactByRef(artifactsOfKind(events, 'pitch'));
    const paperByUrl = new Map<string, string>();
    for (const p of map.values()) {
      const key = normUrl(p.url);
      if (key) paperByUrl.set(key, p.refId);
    }
    for (const e of pitchList) {
      // Legacy: body references paper_\d+ → those papers reach 'pitched'.
      const body = `${e.payload.title} ${e.payload.body ?? ''}`;
      for (const m of body.matchAll(/paper_\d+/g)) bump(m[0], 'pitched');
      // Real run: pitch url matches a paper's url → that paper is 'cited'.
      const cited = paperByUrl.get(normUrl(e.payload.url));
      if (cited) bump(cited, 'cited');
    }

    const papersOut = [...map.values()];
    return {
      papers: papersOut,
      pitches: pitchList,
      byRep: new Map(papersOut.map((p) => [p.rep?.seq, p])),
      pitchSeqs: new Set(pitchList.map((p) => p.seq)),
    };
  }, [events]);

  const items = [...papers.map((p) => p.rep).filter(Boolean), ...pitches];

  const countLabel = pitches.length
    ? `${papers.length} papers · ${pitches.length} pitches`
    : `${papers.length} papers tracked`;

  return (
    <TreeLayout>
      <div className="flex h-full flex-col">
        <div className="px-6 pt-6">
          <SectionHeader
            eyebrow="Paper pipeline"
            title="The Library"
            right={<span className="tnum text-xs text-ink-3">{countLabel}</span>}
          />
        </div>
        <div data-tour="library" className="min-h-0 flex-1 px-6 pb-6">
          {papers.length === 0 && pitches.length === 0 ? (
            <Canvas>
              <div className="text-sm text-ink-3">The paper scouts are searching Linkup + Exa…</div>
            </Canvas>
          ) : (
            <KanbanBoard
              items={items}
              stages={STAGES}
              stageAccent={(s) => STAGE_ACCENT[s]}
              stageOf={(a) => (pitchSeqs.has(a.seq) ? 'pitched' : byRep.get(a.seq)?.stage ?? 'discovered')}
              renderCard={(a) => {
                // Pitch card — its own accent + opens the source paper.
                if (pitchSeqs.has(a.seq)) {
                  return (
                    <EventCard
                      artifact={a}
                      dense
                      accent={STAGE_ACCENT.pitched}
                    />
                  );
                }
                const p = byRep.get(a.seq)!;
                return (
                  <EventCard
                    artifact={{ ...a, payload: { ...a.payload, title: p.title, url: p.url } }}
                    dense
                    accent={STAGE_ACCENT[p.stage]}
                    meta={
                      p.score != null ? (
                        <span
                          className="tnum rounded-pill px-2 py-0.5 text-[0.6875rem] font-semibold"
                          style={{
                            color: p.score >= 0.7 ? 'var(--good)' : p.score >= 0.5 ? 'var(--warning)' : 'var(--ink-3)',
                            background: p.score >= 0.7 ? 'var(--good-soft)' : p.score >= 0.5 ? 'var(--warning-soft)' : 'var(--surface-2)',
                          }}
                        >
                          {formatNum(p.score, 2)}
                        </span>
                      ) : undefined
                    }
                  />
                );
              }}
            />
          )}
        </div>
      </div>
    </TreeLayout>
  );
}
