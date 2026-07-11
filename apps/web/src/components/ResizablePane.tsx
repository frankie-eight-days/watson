/**
 * ResizablePane — a left pane with a draggable right-edge handle.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

export function ResizablePane({
  children,
  initial = 320,
  min = 240,
  max = 520,
  storageKey,
}: {
  children: ReactNode;
  initial?: number;
  min?: number;
  max?: number;
  storageKey?: string;
}) {
  const [width, setWidth] = useState(() => {
    if (storageKey) {
      const saved = Number(localStorage.getItem(storageKey));
      if (saved >= min && saved <= max) return saved;
    }
    return initial;
  });
  const dragging = useRef(false);
  const paneRef = useRef<HTMLDivElement>(null);

  const onMove = useCallback(
    (e: PointerEvent) => {
      if (!dragging.current || !paneRef.current) return;
      const left = paneRef.current.getBoundingClientRect().left;
      const next = Math.max(min, Math.min(max, e.clientX - left));
      setWidth(next);
    },
    [min, max],
  );

  const stop = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    if (storageKey) localStorage.setItem(storageKey, String(Math.round(paneRef.current?.getBoundingClientRect().width ?? width)));
  }, [storageKey, width]);

  useEffect(() => {
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', stop);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', stop);
    };
  }, [onMove, stop]);

  return (
    <div ref={paneRef} className="relative flex shrink-0 flex-col" style={{ width }}>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize agent tree"
        onPointerDown={() => {
          dragging.current = true;
          document.body.style.cursor = 'col-resize';
          document.body.style.userSelect = 'none';
        }}
        className="group absolute right-0 top-0 h-full w-2 translate-x-1/2 cursor-col-resize"
      >
        <div className="mx-auto h-full w-px bg-hairline transition-colors group-hover:bg-[color:var(--accent-ring)]" />
      </div>
    </div>
  );
}
