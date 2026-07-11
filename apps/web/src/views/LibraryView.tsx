/**
 * Library — the paper pipeline as a Kanban. Each paper's stage is INFERRED FROM
 * THE EVENT STREAM (which agent/tool touched it), so cards flow left→right across
 * columns as the replay cursor advances. Relevance scores come from the screener's
 * metric events.
 */
import { useMemo } from 'react';
import { isEventType } from '@watson/shared';
import { useEngagementEvents } from '@/state/hooks';
import { type ArtifactEvent } from '@/lib/fold';
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

export function LibraryView() {
  const events = useEngagementEvents();

  const papers = useMemo(() => {
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
      if (isEventType(e, 'metric') && e.payload.name === 'relevance_score') {
        lastRelevance = e.payload.value;
        continue;
      }
      if (isEventType(e, 'tool_call') && e.agentId === 'w_citation') {
        const pid = (e.payload.args as { paperId?: string }).paperId;
        if (pid) bump(pid, 'cited');
        continue;
      }
      if (isEventType(e, 'artifact') && e.payload.refId?.startsWith('paper')) {
        const ref = e.payload.refId;
        if (e.agentId === 'w_paper_scout') {
          bump(ref, 'discovered', { title: e.payload.title, url: e.payload.url, rep: e }, e);
        } else if (e.agentId === 'w_screener') {
          bump(ref, 'screened', { score: lastRelevance, rep: e }, e);
        } else if (e.agentId === 'w_deep_reader') {
          bump(ref, 'distilled', { rep: e }, e);
        }
        continue;
      }
      if (isEventType(e, 'artifact') && e.payload.kind === 'pitch') {
        const body = `${e.payload.title} ${e.payload.body ?? ''}`;
        for (const m of body.matchAll(/paper_\d+/g)) bump(m[0], 'pitched');
      }
    }
    return [...map.values()];
  }, [events]);

  const items = papers.map((p) => p.rep).filter(Boolean);
  const byRep = new Map(papers.map((p) => [p.rep?.seq, p]));

  return (
    <TreeLayout>
      <div className="flex h-full flex-col">
        <div className="px-6 pt-6">
          <SectionHeader
            eyebrow="Paper pipeline"
            title="The Library"
            right={<span className="tnum text-xs text-ink-3">{papers.length} papers tracked</span>}
          />
        </div>
        <div className="min-h-0 flex-1 px-6 pb-6">
          {papers.length === 0 ? (
            <Canvas>
              <div className="text-sm text-ink-3">The paper scout is searching Linkup…</div>
            </Canvas>
          ) : (
            <KanbanBoard
              items={items}
              stages={STAGES}
              stageAccent={(s) => STAGE_ACCENT[s]}
              stageOf={(a) => byRep.get(a.seq)?.stage ?? 'discovered'}
              renderCard={(a) => {
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
