import { useRef, useState, useEffect } from 'react';

/**
 * Tracks a container element's pixel size via ResizeObserver. The first measurement is
 * applied immediately (so charts render without delay on mount); every measurement after
 * that is debounced, so a drag-resize (e.g. the split-pane divider) only rebuilds
 * expensive children (uPlot charts) once resizing actually stops.
 *
 * @param {number} [debounceMs=150] - milliseconds to wait after a non-initial resize
 *   stops before committing the new width/height.
 * @returns {Object} The measured size, plus the ref to attach it to:
 *   - `containerRef` (RefObject) — attach to the element whose size should be tracked.
 *   - `width` (number) — the container's measured content width in px, 0 before the
 *     first measurement.
 *   - `height` (number) — the container's measured content height in px, 0 before the
 *     first measurement.
 */
export function useContainerResize(debounceMs = 150) {
  const containerRef = useRef(null);
  const resizeDebounceRef = useRef(null);
  const hasMeasuredRef = useRef(false);
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      const w = Math.floor(entry.contentRect.width);
      const h = Math.floor(entry.contentRect.height);
      if (!hasMeasuredRef.current) {
        hasMeasuredRef.current = true;
        setWidth(w);
        setHeight(h);
        return;
      }
      if (resizeDebounceRef.current) clearTimeout(resizeDebounceRef.current);
      resizeDebounceRef.current = setTimeout(() => {
        setWidth(w);
        setHeight(h);
      }, debounceMs);
    });
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { containerRef, width, height };
}
