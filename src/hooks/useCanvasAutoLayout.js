import { useRef, useState, useEffect } from 'react';
import { MULTIPLANAR_TYPE } from '@niivue/niivue';

/**
 * Tracks the NiiVue canvas container's pixel size (debounced, so a resize-drag doesn't thrash
 * NiiVue's own layout math) and switches nv between AUTO (panels in a row) and GRID (2×2)
 * multiplanar layout based on the resulting aspect ratio.
 *
 * @param {Object} params
 * @param {React.RefObject} params.nvRef - the shared, long-lived NiiVue instance ref; the
 *   layout switch is skipped until `nvRef.current` exists.
 * @returns {Object}
 *   - `canvasContainerRef` (RefObject) — attach to the element whose size should drive the
 *     layout switch (typically the div wrapping the `<canvas>`).
 */
export function useCanvasAutoLayout({ nvRef }) {
  const canvasContainerRef = useRef();
  const canvasSizeTimeoutRef = useRef(null); // debounce timeout for canvas size updates
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  // Track canvas container dimensions; debounced to avoid thrashing during resize transitions.
  useEffect(() => {
    const canvasContainer = canvasContainerRef.current;
    if (!canvasContainer) return;
    const canvasSizeObserver = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (canvasSizeTimeoutRef.current) clearTimeout(canvasSizeTimeoutRef.current);
      canvasSizeTimeoutRef.current = setTimeout(() => setCanvasSize({ width, height }), 150);
    });
    canvasSizeObserver.observe(canvasContainer);
    return () => {
      canvasSizeObserver.disconnect();
      if (canvasSizeTimeoutRef.current) clearTimeout(canvasSizeTimeoutRef.current);
    };
  }, []);

  // Switch between AUTO (panels in a row) and GRID (2×2) based on aspect ratio.
  useEffect(() => {
    if (!nvRef.current) return;
    const isWide = canvasSize.height > 0 && canvasSize.width >= 1.75 * canvasSize.height;
    nvRef.current.setMultiplanarLayout(isWide ? MULTIPLANAR_TYPE.AUTO : MULTIPLANAR_TYPE.GRID);
  }, [canvasSize]);

  return { canvasContainerRef };
}
