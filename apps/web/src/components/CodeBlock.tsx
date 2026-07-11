/**
 * CodeBlock — renders the code an experiment's agent wrote. A `diff` block gets
 * added/removed line styling (green/red); any other fenced block is a clean
 * monospace panel. Horizontal scroll only inside the panel. Light lab theme.
 */
import type { CodeBlock as CodeBlockData } from '@/lib/experiments';

function DiffBody({ code }: { code: string }) {
  return (
    <div className="min-w-full font-mono text-[0.75rem] leading-relaxed">
      {code.split('\n').map((line, i) => {
        const add = /^\+/.test(line) && !/^\+\+\+/.test(line);
        const del = /^-/.test(line) && !/^---/.test(line);
        const meta = /^@@/.test(line) || /^(\+\+\+|---)/.test(line);
        const bg = add
          ? 'var(--good-soft)'
          : del
            ? 'var(--critical-soft)'
            : 'transparent';
        const color = add
          ? 'var(--good)'
          : del
            ? 'var(--critical)'
            : meta
              ? 'var(--ink-3)'
              : 'var(--ink-2)';
        return (
          <div key={i} className="flex whitespace-pre px-3" style={{ background: bg, color }}>
            <span className="w-3 shrink-0 select-none opacity-70">{add ? '+' : del ? '-' : ' '}</span>
            <span>{line.replace(/^[+-]/, '')}</span>
          </div>
        );
      })}
    </div>
  );
}

export function CodeBlock({ block }: { block: CodeBlockData }) {
  const label = block.isDiff ? 'diff' : block.lang || 'code';
  return (
    <div className="overflow-hidden rounded-lg border border-hairline bg-surface-2">
      <div className="flex items-center gap-2 border-b border-hairline px-3 py-1.5">
        <span className="flex gap-1">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--hairline-strong)' }} />
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--hairline-strong)' }} />
        </span>
        <span className="font-mono text-[0.625rem] uppercase tracking-wider text-ink-3">{label}</span>
      </div>
      <div className="scroll-slim overflow-x-auto py-2">
        {block.isDiff ? (
          <DiffBody code={block.code} />
        ) : (
          <pre className="whitespace-pre px-3 font-mono text-[0.75rem] leading-relaxed text-ink-2">{block.code}</pre>
        )}
      </div>
    </div>
  );
}
