/**
 * EventCard — a canvas card driven by an `artifact` event (kind/title/body/url).
 * Generic across views; new cards fade+slide in as the replay streams them.
 */
import type { ReactNode } from 'react';
import type { ArtifactEvent } from '@/lib/fold';
import { Eyebrow } from './primitives';

const KIND_LABEL: Record<string, string> = {
  dossier: 'Dossier',
  paper: 'Paper',
  pitch: 'Pitch',
  experiment: 'Experiment',
  pr: 'Pull request',
  report: 'Report',
  card: 'Note',
};

export function EventCard({
  artifact,
  accent,
  meta,
  footer,
  onClick,
  dense = false,
}: {
  artifact: ArtifactEvent;
  /** Left accent stripe color token (defaults by kind). */
  accent?: string;
  /** Small badge/score shown top-right (e.g. a relevance score). */
  meta?: ReactNode;
  footer?: ReactNode;
  onClick?: () => void;
  dense?: boolean;
}) {
  const p = artifact.payload;
  const clickable = Boolean(onClick);
  return (
    <div
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (clickable && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onClick?.();
        }
      }}
      className={`hairline-card animate-fade-slide-in group relative overflow-hidden ${
        dense ? 'p-3' : 'p-4'
      } ${clickable ? 'focus-ring cursor-pointer transition-shadow hover:shadow-lift' : ''}`}
    >
      <span
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ background: accent ?? 'var(--accent)' }}
      />
      <div className="flex items-start justify-between gap-3 pl-1.5">
        <div className="min-w-0">
          <Eyebrow>{KIND_LABEL[p.kind] ?? p.kind}</Eyebrow>
          <h4 className={`mt-0.5 font-semibold text-ink ${dense ? 'text-[0.8125rem]' : 'text-sm'} leading-snug`}>
            {p.title}
          </h4>
        </div>
        {meta && <div className="shrink-0">{meta}</div>}
      </div>

      {p.body && (
        <p
          className={`mt-2 pl-1.5 text-ink-2 ${dense ? 'text-xs' : 'text-[0.8125rem]'} leading-relaxed`}
          style={{
            display: '-webkit-box',
            WebkitLineClamp: dense ? 3 : 5,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {p.body}
        </p>
      )}

      {(p.url || footer) && (
        <div className="mt-3 flex items-center justify-between gap-2 pl-1.5">
          <div className="min-w-0">{footer}</div>
          {p.url && (
            <a
              href={p.url}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="focus-ring shrink-0 truncate text-xs font-medium text-accent-ink hover:underline"
            >
              {new URL(p.url).host.replace('www.', '')} ↗
            </a>
          )}
        </div>
      )}
    </div>
  );
}
