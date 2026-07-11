/**
 * KanbanBoard — groups artifact cards into columns by a caller-provided stage
 * function. Generic: the Library view supplies paper stages, but any artifact
 * set + stage mapping works.
 */
import type { ReactNode } from 'react';
import type { ArtifactEvent } from '@/lib/fold';
import { Eyebrow } from './primitives';

export interface KanbanStage {
  id: string;
  label: string;
}

export function KanbanBoard({
  items,
  stages,
  stageOf,
  renderCard,
  stageAccent,
}: {
  items: ArtifactEvent[];
  stages: KanbanStage[];
  stageOf: (a: ArtifactEvent) => string;
  renderCard: (a: ArtifactEvent) => ReactNode;
  stageAccent?: (stageId: string) => string;
}) {
  const columns = stages.map((s) => ({
    ...s,
    cards: items.filter((a) => stageOf(a) === s.id),
  }));

  return (
    <div className="scroll-slim flex h-full gap-4 overflow-x-auto pb-2">
      {columns.map((col) => (
        <div key={col.id} className="flex w-72 shrink-0 flex-col">
          <div className="mb-2 flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              {stageAccent && (
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: stageAccent(col.id) }}
                />
              )}
              <Eyebrow>{col.label}</Eyebrow>
            </div>
            <span className="tnum rounded-pill bg-surface-2 px-1.5 text-[0.625rem] font-medium text-ink-3">
              {col.cards.length}
            </span>
          </div>
          <div className="scroll-slim flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto rounded-xl bg-surface-2/60 p-2">
            {col.cards.length === 0 ? (
              <div className="flex h-20 items-center justify-center text-[0.6875rem] text-ink-3">
                —
              </div>
            ) : (
              col.cards.map((a) => <div key={`${a.seq}`}>{renderCard(a)}</div>)
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
