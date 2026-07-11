/**
 * Markdown.tsx — a dependency-free markdown-lite renderer for artifact bodies
 * (the Conference report + the Watercooler dossier sections). It covers the
 * subset the brain actually emits: ATX headings (#..######), bold (**…**),
 * inline `code`, fenced ```code``` blocks (reusing the app's CodeBlock styling),
 * and ordered / unordered lists. Everything else renders as a paragraph.
 *
 * Pure + presentational: it takes a string and returns nodes, so it stays
 * replay-safe (the caller folds the body out of the event stream).
 */
import { Fragment, type ReactNode } from 'react';
import { CodeBlock } from './CodeBlock';

type Block =
  | { t: 'code'; lang?: string; code: string }
  | { t: 'h'; level: number; text: string }
  | { t: 'ul'; items: string[] }
  | { t: 'ol'; items: string[] }
  | { t: 'p'; text: string };

/** Render inline spans: **bold** and `code`. Everything else is plain text. */
export function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(<Fragment key={key++}>{text.slice(last, m.index)}</Fragment>);
    if (m[1] != null) {
      nodes.push(
        <strong key={key++} className="font-semibold text-ink">
          {m[1]}
        </strong>,
      );
    } else {
      nodes.push(
        <code
          key={key++}
          className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[0.85em] text-accent-ink"
        >
          {m[2]}
        </code>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(<Fragment key={key++}>{text.slice(last)}</Fragment>);
  return nodes;
}

/** Split a markdown body into a flat list of block descriptors. */
export function parseBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];

  const flushPara = () => {
    if (para.length) {
      blocks.push({ t: 'p', text: para.join(' ').trim() });
      para = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // fenced code block
    const fence = line.match(/^\s*```(\w+)?\s*$/);
    if (fence) {
      flushPara();
      const lang = fence[1];
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      blocks.push({ t: 'code', lang, code: buf.join('\n') });
      continue;
    }

    // heading
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushPara();
      blocks.push({ t: 'h', level: h[1].length, text: h[2].trim() });
      continue;
    }

    // unordered list run
    if (/^\s*[-*]\s+/.test(line)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ''));
        i++;
      }
      i--;
      blocks.push({ t: 'ul', items });
      continue;
    }

    // ordered list run
    if (/^\s*\d+\.\s+/.test(line)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      i--;
      blocks.push({ t: 'ol', items });
      continue;
    }

    // blank line ends a paragraph
    if (line.trim() === '') {
      flushPara();
      continue;
    }

    para.push(line.trim());
  }
  flushPara();
  return blocks;
}

const H_CLASS: Record<number, string> = {
  1: 'mt-4 text-base font-semibold tracking-tight text-ink',
  2: 'mt-4 text-sm font-semibold tracking-tight text-ink',
  3: 'mt-3 text-[0.8125rem] font-semibold text-ink',
  4: 'mt-3 text-[0.8125rem] font-semibold text-ink-2',
  5: 'mt-2 text-xs font-semibold text-ink-2',
  6: 'mt-2 text-xs font-semibold text-ink-3',
};

/** Render pre-parsed blocks. */
export function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <div className="space-y-2.5 text-[0.8125rem] leading-relaxed text-ink-2">
      {blocks.map((b, i) => {
        switch (b.t) {
          case 'code':
            return (
              <CodeBlock
                key={i}
                block={{ lang: b.lang, code: b.code, isDiff: (b.lang ?? '').toLowerCase() === 'diff' }}
              />
            );
          case 'h': {
            const cls = H_CLASS[b.level] ?? H_CLASS[6];
            return (
              <div key={i} className={`${cls} first:mt-0`}>
                {renderInline(b.text)}
              </div>
            );
          }
          case 'ul':
            return (
              <ul key={i} className="list-disc space-y-1 pl-5 marker:text-ink-3">
                {b.items.map((it, j) => (
                  <li key={j}>{renderInline(it)}</li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={i} className="list-decimal space-y-1 pl-5 marker:text-ink-3">
                {b.items.map((it, j) => (
                  <li key={j}>{renderInline(it)}</li>
                ))}
              </ol>
            );
          default:
            return <p key={i}>{renderInline(b.text)}</p>;
        }
      })}
    </div>
  );
}

/** Convenience: parse + render a whole markdown string. */
export function MarkdownLite({ body }: { body: string }) {
  return <Blocks blocks={parseBlocks(body)} />;
}
