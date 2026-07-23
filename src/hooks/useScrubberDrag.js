import { useRef, useState, useEffect } from 'react';

/**
 * Owns the timeline scrubber's drag interaction — moving the thumb (panning) or dragging
 * either edge (resizing the visible window). Tracks the drag with refs (not state) so
 * mousemove doesn't re-render on every pixel, and only commits to state (via the setters
 * passed in) inside a requestAnimationFrame callback.
 *
 * @param {Object} params
 * @param {number} params.tMax - total recording duration in seconds; drag deltas are
 *   computed as a fraction of the scrubber's pixel width scaled by this.
 * @param {number} params.startTime - the visible window's current start time, captured
 *   into the drag state when a drag begins.
 * @param {number} params.windowSize - the visible window's current size, captured into
 *   the drag state when a drag begins.
 * @param {(value: number|((prev: number) => number)) => void} params.setStartTime
 *   Called during a move/resize drag to update the visible window's start time.
 * @param {(value: number) => void} params.setWindowSize
 *   Called during a resize drag to update the visible window's size.
 * @param {(value: string) => void} params.setWindowSizeStr
 *   Kept in sync with setWindowSize so the window-size input reflects drag-driven resizes.
 * @returns {Object} The drag state and the ref/handler needed to wire it to the scrubber:
 *   - `scrubberRef` (RefObject) — attach to the scrubber track element; used to measure
 *     its pixel width while dragging.
 *   - `isDragging` (boolean) — true for the duration of any drag, so the thumb can
 *     highlight itself.
 *   - `startDrag` (e: MouseEvent, type: 'move'|'resize-left'|'resize-right') => void —
 *     call from a handle's onMouseDown to begin that kind of drag.
 */
export function useScrubberDrag({
  tMax,
  startTime,
  windowSize,
  setStartTime,
  setWindowSize,
  setWindowSizeStr,
}) {
  const scrubberRef = useRef(null);
  const dragRef = useRef(null); // stores active drag state — null when not dragging
  const rafRef = useRef(null); // stores the pending requestAnimationFrame id so we can cancel it
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    const onMouseMove = (e) => {
      if (!dragRef.current || !scrubberRef.current) return;

      // Cancel any frame that was already queued but hasn't run yet.
      // Without this, fast mouse moves would stack up multiple pending updates
      // and they'd all fire in the same frame, doing redundant work.
      if (rafRef.current) cancelAnimationFrame(rafRef.current);

      // Capture clientX immediately — by the time the rAF callback runs,
      // the original event object may be recycled by the browser and clientX would be 0.
      const clientX = e.clientX;

      rafRef.current = requestAnimationFrame(() => {
        if (!dragRef.current || !scrubberRef.current) return;
        const barWidth = scrubberRef.current.offsetWidth;
        const dt = ((clientX - dragRef.current.startX) / barWidth) * tMax;
        const { type, startTime: st, startWindowSize: sw } = dragRef.current;

        const r10 = (v) => Math.round(v * 10) / 10;
        if (type === 'move') {
          setStartTime(r10(Math.max(0, Math.min(tMax - sw, st + dt))));
        } else if (type === 'resize-right') {
          const newSize = r10(Math.max(1, Math.min(tMax - st, sw + dt)));
          setWindowSize(newSize);
          setWindowSizeStr(String(newSize));
        } else if (type === 'resize-left') {
          const newStart = r10(Math.max(0, Math.min(st + sw - 1, st + dt)));
          const newSize = r10(st + sw - newStart);
          setStartTime(newStart);
          setWindowSize(newSize);
          setWindowSizeStr(String(newSize));
        }
      });
    };
    // On mouse up, clear the drag state to stop dragging
    const onMouseUp = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      dragRef.current = null;
      setIsDragging(false);
    };

    // Attach listeners to the window to track mouse movements instead of the scrubber,
    // this allows dragging to continue even if the cursor leaves the scrubber area
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [tMax, setStartTime, setWindowSize, setWindowSizeStr]);

  const startDrag = (e, type) => {
    e.preventDefault(); // stops text selection during drag
    e.stopPropagation(); // stops the event bubbling up to the bar's own onMouseDown
    dragRef.current = { type, startX: e.clientX, startTime, startWindowSize: windowSize };
    setIsDragging(true);
  };

  return { scrubberRef, isDragging, startDrag };
}
