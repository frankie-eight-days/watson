/**
 * Shared view scaffolding: a scrollable padded Canvas, a section header, and a
 * TreeLayout that pairs the resizable AgentTree pane with a view canvas.
 */
import type { ReactNode } from 'react';
import { ResizablePane } from '@/components/ResizablePane';
import { AgentTree } from '@/components/AgentTree';
import { Eyebrow } from '@/components/primitives';

export function Canvas({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`scroll-slim h-full overflow-y-auto ${className}`}>
      <div className="mx-auto max-w-6xl px-6 py-6">{children}</div>
    </div>
  );
}

export function SectionHeader({
  eyebrow,
  title,
  right,
}: {
  eyebrow: string;
  title: string;
  right?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h2 className="mt-0.5 text-lg font-semibold tracking-tight text-ink">{title}</h2>
      </div>
      {right}
    </div>
  );
}

/** AgentTree (resizable, left) + a view canvas (right). */
export function TreeLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full min-h-0">
      <ResizablePane initial={296} min={248} max={460} storageKey="watson.tree.w">
        <AgentTree />
      </ResizablePane>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
