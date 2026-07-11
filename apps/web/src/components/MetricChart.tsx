/**
 * MetricChart — a live-updating multi-line chart for `metric` series events.
 *
 * dataviz skill applied: one y-axis (never dual), thin 2px marks, recessive
 * grid/axes, tabular-figure labels, a legend for ≥2 series PLUS direct end
 * labels (identity never by color alone), and a crosshair+tooltip hover layer.
 * The two fixture series (baseline vs candidate) use the validated palette:
 * baseline = recessive slate, candidate = accent indigo.
 *
 * The line "grows" as the replay cursor advances because each fold delivers more
 * of the cumulative series — no bespoke animation needed.
 */
import { useMemo, useState } from 'react';
import type { MetricSeries } from '@/lib/fold';
import { BASELINE_COLOR, candidateColor, isBaselineLabel } from '@/lib/vizColors';
import { formatNum } from '@/lib/format';
import { useResizeWidth } from '@/lib/useResizeWidth';

const HEIGHT = 300;
const PAD = { top: 20, right: 88, bottom: 34, left: 44 };

interface Scaled {
  label: string;
  color: string;
  dashed: boolean;
  pts: { x: number; y: number; sx: number; sy: number }[];
}

export function MetricChart({
  series,
  unit,
  yFloor,
  xLabel = (x) => `v${x}`,
}: {
  series: MetricSeries[];
  unit?: string;
  /** Force the y-axis to start here (e.g. 0) rather than the data min. */
  yFloor?: number;
  /** Format an x-domain value for the axis + tooltip (e.g. day → "d12"). */
  xLabel?: (x: number) => string;
}) {
  const { ref, width } = useResizeWidth(640);
  const [hoverX, setHoverX] = useState<number | null>(null);

  const model = useMemo(() => {
    const all = series.flatMap((s) => s.points);
    if (all.length === 0) return null;
    const xs = all.map((p) => p.x);
    const ys = all.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs, minX + 1);
    const rawMinY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const minY = yFloor ?? Math.max(0, rawMinY - (maxY - rawMinY) * 0.15);
    const top = maxY + (maxY - minY) * 0.12 || maxY + 1;

    const plotW = Math.max(80, width - PAD.left - PAD.right);
    const plotH = HEIGHT - PAD.top - PAD.bottom;
    const sx = (x: number) => PAD.left + ((x - minX) / (maxX - minX || 1)) * plotW;
    const sy = (y: number) => PAD.top + plotH - ((y - minY) / (top - minY || 1)) * plotH;

    let candIdx = 0;
    const scaled: Scaled[] = series.map((s) => {
      const baseline = isBaselineLabel(s.label);
      const color = baseline ? BASELINE_COLOR : candidateColor(candIdx++);
      return {
        label: s.label,
        color,
        dashed: baseline,
        pts: s.points.map((p) => ({ ...p, sx: sx(p.x), sy: sy(p.y) })),
      };
    });

    const yTicks = Array.from({ length: 5 }, (_, i) => minY + ((top - minY) * i) / 4);
    const xTickVals = Array.from(new Set(all.map((p) => p.x))).sort((a, b) => a - b);

    return { scaled, sx, sy, minX, maxX, minY, top, plotW, plotH, yTicks, xTickVals };
  }, [series, width, yFloor]);

  if (!model) {
    return (
      <div ref={ref} className="flex h-[300px] items-center justify-center text-sm text-ink-3">
        Awaiting metric data…
      </div>
    );
  }

  // Nearest x-domain value under the cursor, for the crosshair tooltip.
  const hover = (() => {
    if (hoverX == null) return null;
    const xVal =
      model.minX + ((hoverX - PAD.left) / model.plotW) * (model.maxX - model.minX);
    const nearest = model.xTickVals.reduce((a, b) =>
      Math.abs(b - xVal) < Math.abs(a - xVal) ? b : a,
    );
    const cx = model.sx(nearest);
    const rows = model.scaled
      .map((s) => {
        const pt = s.pts.find((p) => p.x === nearest);
        return pt ? { label: s.label, color: s.color, y: pt.y, sy: pt.sy } : null;
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
    return rows.length ? { cx, nearest, rows } : null;
  })();

  return (
    <div ref={ref} className="relative w-full">
      <svg
        width={width}
        height={HEIGHT}
        role="img"
        aria-label="Metric time series"
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setHoverX(e.clientX - rect.left);
        }}
        onMouseLeave={() => setHoverX(null)}
      >
        {/* y grid + labels (recessive) */}
        {model.yTicks.map((t, i) => {
          const y = model.sy(t);
          return (
            <g key={i}>
              <line
                x1={PAD.left}
                x2={width - PAD.right}
                y1={y}
                y2={y}
                stroke="var(--hairline)"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 8}
                y={y + 3}
                textAnchor="end"
                className="tnum"
                fontSize={10.5}
                fill="var(--ink-3)"
              >
                {formatNum(t, 0)}
              </text>
            </g>
          );
        })}

        {/* x labels (thinned to ~7 to avoid collisions with many days) */}
        {model.xTickVals
          .filter((_, i, arr) => arr.length <= 8 || i % Math.ceil(arr.length / 7) === 0 || i === arr.length - 1)
          .map((xv) => (
            <text
              key={xv}
              x={model.sx(xv)}
              y={HEIGHT - PAD.bottom + 18}
              textAnchor="middle"
              className="tnum"
              fontSize={10.5}
              fill="var(--ink-3)"
            >
              {xLabel(xv)}
            </text>
          ))}

        {/* crosshair */}
        {hover && (
          <line
            x1={hover.cx}
            x2={hover.cx}
            y1={PAD.top}
            y2={HEIGHT - PAD.bottom}
            stroke="var(--hairline-strong)"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}

        {/* series lines + end labels */}
        {model.scaled.map((s) => {
          const d = s.pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.sx},${p.sy}`).join(' ');
          const last = s.pts[s.pts.length - 1];
          const showAllMarkers = s.pts.length <= 12;
          return (
            <g key={s.label}>
              <path
                d={d}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                strokeDasharray={s.dashed ? '5 4' : undefined}
                opacity={s.dashed ? 0.85 : 1}
              />
              {/* markers (thinned for long candidate lines) */}
              {s.pts.map((p, i) =>
                showAllMarkers || i === s.pts.length - 1 ? (
                  <circle
                    key={i}
                    cx={p.sx}
                    cy={p.sy}
                    r={i === s.pts.length - 1 ? 4 : 2.6}
                    fill={s.color}
                    stroke="var(--surface)"
                    strokeWidth={i === s.pts.length - 1 ? 2 : 0}
                  />
                ) : null,
              )}
              {/* pulsing head on the last point (candidates only — baseline is a static reference) */}
              {last && !s.dashed && (
                <circle cx={last.sx} cy={last.sy} r={7} fill="none" stroke={s.color} strokeWidth={1.2} className="animate-pulse-soft" />
              )}
              {/* direct end label — identity never by color alone */}
              {last && (
                <text x={Math.min(last.sx + 10, width - 4)} y={last.sy + 3.5} fontSize={11} fontWeight={600} fill={s.color} className="tnum">
                  {formatNum(last.y, last.y % 1 ? 1 : 0)}
                  <tspan fill="var(--ink-3)" fontWeight={400}> {s.label}</tspan>
                </text>
              )}
            </g>
          );
        })}

        {/* tooltip dots on hover */}
        {hover?.rows.map((r) => (
          <circle key={r.label} cx={hover.cx} cy={r.sy} r={4.5} fill={r.color} stroke="var(--surface)" strokeWidth={2} />
        ))}
      </svg>

      {/* legend + unit */}
      <div className="mt-1 flex items-center gap-4 pl-11">
        {model.scaled.map((s) => (
          <div key={s.label} className="flex items-center gap-1.5">
            <span
              className="h-0.5 w-4 rounded-full"
              style={
                s.dashed
                  ? { backgroundImage: `repeating-linear-gradient(90deg, ${s.color} 0 4px, transparent 4px 7px)` }
                  : { background: s.color }
              }
            />
            <span className="text-xs text-ink-2">{s.label}</span>
          </div>
        ))}
        {unit && <span className="ml-auto pr-1 text-[0.6875rem] text-ink-3">{unit}</span>}
      </div>

      {/* hover tooltip card */}
      {hover && (
        <div
          className="pointer-events-none absolute z-10 rounded-lg border border-hairline bg-surface px-2.5 py-1.5 shadow-lift"
          style={{ left: Math.min(hover.cx + 10, width - 130), top: PAD.top }}
        >
          <div className="eyebrow mb-1">{xLabel(hover.nearest)}</div>
          {hover.rows.map((r) => (
            <div key={r.label} className="flex items-center justify-between gap-3 text-xs">
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: r.color }} />
                <span className="text-ink-2">{r.label}</span>
              </span>
              <span className="tnum font-medium text-ink">
                {formatNum(r.y, r.y % 1 ? 1 : 0)}
                {unit ? ` ${unit}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
