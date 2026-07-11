/**
 * CostTicker — the running engagement cost. Tweens toward the live total and
 * flashes the accent on increase, so the header visibly "ticks up" as the replay
 * streams cost-bearing events. Tabular figures throughout.
 */
import { useEffect, useRef, useState } from 'react';
import { formatUsd } from '@/lib/format';

export function CostTicker({ value }: { value: number }) {
  const [display, setDisplay] = useState(value);
  const [bumped, setBumped] = useState(false);
  const fromRef = useRef(value);
  const rafRef = useRef<number>();

  useEffect(() => {
    const from = fromRef.current;
    const to = value;
    if (from === to) return;
    if (to > from) {
      setBumped(true);
      const t = window.setTimeout(() => setBumped(false), 380);
      cleanupTimer.current = t;
    }
    const start = performance.now();
    const dur = 420;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(from + (to - from) * eased);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = to;
    };
    cancelAnimationFrame(rafRef.current ?? 0);
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current ?? 0);
  }, [value]);

  const cleanupTimer = useRef<number>();
  useEffect(() => () => window.clearTimeout(cleanupTimer.current), []);

  return (
    <span
      className={`tnum text-lg font-semibold tabular-nums transition-colors duration-300 ${
        bumped ? 'text-accent-ink' : 'text-ink'
      }`}
    >
      {formatUsd(display)}
    </span>
  );
}
