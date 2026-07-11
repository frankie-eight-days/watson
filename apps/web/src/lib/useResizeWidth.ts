/**
 * useResizeWidth — measures a container's width via ResizeObserver so SVG charts
 * can render crisply at any layout size (no viewBox blur).
 */
import { useEffect, useRef, useState } from 'react';

export function useResizeWidth(initial = 640) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(initial);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return { ref, width };
}
