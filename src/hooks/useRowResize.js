import { useRef, useCallback, useState } from 'react';

/**
 * Drag-to-resize for a row element's min-height. Writes to the DOM directly (not React state)
 * so dragging doesn't re-render on every mouse-move frame.
 *
 * @param {number} minHeight - px floor the row's min-height is clamped to; dragging past this
 *   point has no further effect.
 * @returns {Object}
 *   - `rowRef` (RefObject) — attach to the resizable row element.
 *   - `handleResizeStart` (Function) — attach to the drag handle's `onMouseDown` and
 *     `onTouchStart`; takes the mouse or touch event, reads the row's current height as the
 *     drag's starting point, and wires up (then tears down, on mouseup/touchend) the
 *     window-level move listener that updates `row.style.minHeight` on every frame.
 *   - `isDragging` (boolean) — true while a drag is in progress, so the handle can stay
 *     highlighted even when the pointer or finger moves off it. Only changes at the start and
 *     end of a drag, so it doesn't re-render on every move.
 */
export function useRowResize(minHeight) {
  const rowRef = useRef();
  const [isDragging, setIsDragging] = useState(false);

  const handleResizeStart = useCallback(
    (e) => {
      const row = rowRef.current;
      if (!row) return;
      // Touch screens send touch events (finger position in touches[0]) instead of mouse events
      const isTouch = e.type === 'touchstart';
      // Mouse only: stops text selection while dragging. React's touchstart listener is passive,
      // so page scrolling during a touch drag is stopped in onTouchMove (and by the handle's
      // touch-none class) instead.
      if (!isTouch) e.preventDefault();
      const startY = isTouch ? e.touches[0].clientY : e.clientY;
      const startHeight = row.getBoundingClientRect().height;
      setIsDragging(true);

      const resizeTo = (clientY) => {
        const nextHeight = Math.max(minHeight, startHeight + (clientY - startY));
        row.style.minHeight = `${nextHeight}px`;
      };
      const onMouseMove = (moveEvent) => resizeTo(moveEvent.clientY);
      const onTouchMove = (moveEvent) => {
        moveEvent.preventDefault(); // keep the page from scrolling while dragging the handle
        resizeTo(moveEvent.touches[0].clientY);
      };
      const onEnd = () => {
        setIsDragging(false);
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onEnd);
        window.removeEventListener('touchmove', onTouchMove);
        window.removeEventListener('touchend', onEnd);
        window.removeEventListener('touchcancel', onEnd);
      };
      if (isTouch) {
        // passive: false, so onTouchMove's preventDefault can stop the page scroll
        window.addEventListener('touchmove', onTouchMove, { passive: false });
        window.addEventListener('touchend', onEnd);
        window.addEventListener('touchcancel', onEnd); // e.g. a system gesture takes over
      } else {
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onEnd);
      }
    },
    [minHeight]
  );

  return { rowRef, handleResizeStart, isDragging };
}
