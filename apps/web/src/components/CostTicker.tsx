/**
 * CostTicker — the running engagement cost. Tweens toward the live total and
 * flashes the accent on increase, so the header visibly "ticks up" as the replay
 * streams cost-bearing events. Tabular figures throughout.
 */
import { useEffect, useRef, useState } from 'react';
import { formatUsd } from '@/lib/format';

const DUR = 400;

export function CostTicker({ value }: { value: number }) {
  const [display, setDisplay] = useState(value);
  const [bumped, setBumped] = useState(false);
  const prev = useRef(value);
  const rafRef = useRef<number>();
  const flashRef = useRef<number>();

  useEffect(() => {
    const from = prev.current;
    const to = value;
    prev.current = value; // commit immediately — never leave `from` stale
    if (from === to) {
      setDisplay(to);
      return;
    }
    if (to > from) {
      setBumped(true);
      window.clearTimeout(flashRef.current);
      flashRef.current = window.setTimeout(() => setBumped(false), 360);
    }
    const start = performance.now();
    const tick = (now: number) => {
      // Clamp progress to [0,1] so a non-monotonic clock can never extrapolate
      // the eased value outside [from, to].
      const p = Math.max(0, Math.min(1, (now - start) / DUR));
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(from + (to - from) * eased);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };
    cancelAnimationFrame(rafRef.current ?? 0);
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current ?? 0);
  }, [value]);

  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current ?? 0);
      window.clearTimeout(flashRef.current);
    },
    [],
  );

  return (
    <span
      className={`tnum text-lg font-semibold transition-colors duration-300 ${
        bumped ? 'text-accent-ink' : 'text-ink'
      }`}
    >
      {formatUsd(Math.max(0, display))}
    </span>
  );
}
