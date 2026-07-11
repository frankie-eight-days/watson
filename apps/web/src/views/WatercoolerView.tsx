/**
 * Watercooler — repo ingestion. AgentTree (left) + a canvas of scout artifact
 * cards, converging to the Repo Dossier.
 *
 * The dossier renders as a glanceable card: the repo identity is parsed from the
 * `# Repo Dossier — \`owner/repo@branch\`` first line, the `**WEAKNESS:**`
 * paragraph is lifted into a prominent callout (the point of the view), and the
 * `## ` sections become progressive-disclosure <details>. Bodies that don't match
 * that shape (e.g. the mock fixture) fall back to a plain rendering.
 */
import { useMemo } from 'react';
import { useEngagementEvents } from '@/state/hooks';
import { foldArtifacts, type ArtifactEvent } from '@/lib/fold';
import { Canvas, SectionHeader, TreeLayout } from './_layout';
import { EventCard } from '@/components/EventCard';
import { EmptyState, Eyebrow } from '@/components/primitives';
import { Blocks, parseBlocks, renderInline } from '@/components/Markdown';

interface DossierModel {
  owner?: string;
  repo?: string;
  branch?: string;
  weakness?: string;
  sections: { heading: string; content: string }[];
  structured: boolean;
}

function parseDossier(title: string, body: string): DossierModel {
  // Repo identity: `# Repo Dossier — `owner/repo@branch``
  const idMatch = body.match(/^#\s+.*?`([^`]+)`/m);
  let owner: string | undefined;
  let repo: string | undefined;
  let branch: string | undefined;
  if (idMatch) {
    const [path, br] = idMatch[1].split('@');
    branch = br;
    const slash = path.indexOf('/');
    if (slash >= 0) {
      owner = path.slice(0, slash);
      repo = path.slice(slash + 1);
    } else {
      repo = path;
    }
  }

  // WEAKNESS callout — the final `**WEAKNESS:**` paragraph, lifted out of the body.
  const wkMatch = body.match(/\*\*WEAKNESS:?\*\*[\s\S]*$/i);
  const weakness = wkMatch
    ? wkMatch[0].replace(/^\*\*WEAKNESS:?\*\*\s*/i, '').trim()
    : undefined;
  const bodyNoWeakness = wkMatch ? body.slice(0, body.indexOf(wkMatch[0])) : body;

  // Sections split on `## ` headings; text before the first is dropped (it is the
  // `# Repo Dossier` title line we already parsed).
  const parts = bodyNoWeakness.split(/^##\s+/m);
  const sections = parts.slice(1).map((part) => {
    const nl = part.indexOf('\n');
    return {
      heading: (nl === -1 ? part : part.slice(0, nl)).trim(),
      content: (nl === -1 ? '' : part.slice(nl + 1)).trim(),
    };
  });

  const structured = Boolean(idMatch || weakness || sections.length > 0);
  return { owner, repo, branch, weakness, sections, structured };
}

function DossierCard({ dossier }: { dossier: ArtifactEvent }) {
  const body = dossier.payload.body ?? '';
  const model = useMemo(() => parseDossier(dossier.payload.title, body), [dossier.payload.title, body]);

  // Fallback: body doesn't look like a structured dossier → render as before.
  if (!model.structured) {
    return (
      <div className="hairline-card animate-fade-slide-in overflow-hidden">
        <div className="border-b border-hairline bg-accent-soft px-5 py-3">
          <div className="eyebrow text-accent-ink">Converged · Repo Dossier</div>
          <div className="mt-0.5 text-base font-semibold text-ink">{dossier.payload.title}</div>
        </div>
        {body && (
          <p className="whitespace-pre-line px-5 py-4 text-[0.8125rem] leading-relaxed text-ink-2">{body}</p>
        )}
      </div>
    );
  }

  const repoLabel =
    model.owner && model.repo ? `${model.owner}/${model.repo}` : model.repo ?? dossier.payload.title;

  return (
    <div className="hairline-card animate-fade-slide-in overflow-hidden">
      {/* header: repo identity */}
      <div className="border-b border-hairline bg-accent-soft px-5 py-3.5">
        <div className="eyebrow text-accent-ink">Converged · Repo Dossier</div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="font-mono text-[0.9375rem] font-semibold tracking-tight text-ink">{repoLabel}</span>
          {model.branch && (
            <span className="rounded-pill bg-surface-2 px-2 py-0.5 font-mono text-[0.6875rem] text-ink-2">
              ⎇ {model.branch}
            </span>
          )}
        </div>
      </div>

      {/* WEAKNESS callout — the headline finding */}
      {model.weakness && (
        <div
          className="border-b border-hairline px-5 py-4"
          style={{ background: 'var(--critical-soft)' }}
        >
          <div className="mb-1 flex items-center gap-1.5">
            <span aria-hidden style={{ color: 'var(--critical)' }}>◆</span>
            <span className="eyebrow" style={{ color: 'var(--critical)' }}>
              Identified weakness
            </span>
          </div>
          <p className="text-[0.875rem] font-medium leading-relaxed text-ink">
            {renderInline(model.weakness)}
          </p>
        </div>
      )}

      {/* sections — progressive disclosure */}
      {model.sections.length > 0 && (
        <div className="divide-y divide-hairline">
          {model.sections.map((s, i) => (
            <details key={i} open={i === 0} className="group px-5 py-3">
              <summary className="focus-ring flex cursor-pointer list-none items-center justify-between gap-2 py-0.5">
                <span className="text-[0.8125rem] font-semibold text-ink">{s.heading}</span>
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 12 12"
                  className="shrink-0 text-ink-3 transition-transform group-open:rotate-90"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4.5 3 L8 6 L4.5 9" />
                </svg>
              </summary>
              {s.content && (
                <div className="mt-2">
                  <Blocks blocks={parseBlocks(s.content)} />
                </div>
              )}
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

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
              <DossierCard dossier={dossier} />
            </div>
          )}

          {cards.length === 0 && !dossier ? (
            <EmptyState title="Agents are cloning the repo" hint="Findings appear here as the crew reads the harness." />
          ) : cards.length > 0 ? (
            <>
              <Eyebrow className="mb-2">Scout findings</Eyebrow>
              <div className="grid gap-3 sm:grid-cols-2">
                {cards.map((a) => (
                  <EventCard key={a.seq} artifact={a} dense />
                ))}
              </div>
            </>
          ) : null}
        </div>
      </Canvas>
    </TreeLayout>
  );
}
