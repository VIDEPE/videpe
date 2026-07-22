import { useRef, useCallback } from 'react';

/**
 * Drag-to-resize for a row element's min-height. Writes to the DOM directly (not React state)
 * so dragging doesn't re-render on every mouse-move frame.
 *
 * @param {number} minHeight - px floor the row's min-height is clamped to; dragging past this
 *   point has no further effect.
 * @returns {Object}
 *   - `rowRef` (RefObject) — attach to the resizable row element.
 *   - `handleResizeStart` (Function) — attach to the drag handle's `onMouseDown`; takes
 *     the mouse event, reads the row's current height as the drag's starting point, and wires
 *     up (then tears down, on mouseup) the window-level mousemove listener that updates
 *     `row.style.minHeight` on every frame.
 */
export function useRowResize(minHeight) {
  const rowRef = useRef();

  const handleResizeStart = useCallback(
    (e) => {
      e.preventDefault();
      const row = rowRef.current;
      if (!row) return;
      const startY = e.clientY;
      const startHeight = row.getBoundingClientRect().height;

      const onMove = (moveEvent) => {
        const nextHeight = Math.max(minHeight, startHeight + (moveEvent.clientY - startY));
        row.style.minHeight = `${nextHeight}px`;
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [minHeight]
  );

  return { rowRef, handleResizeStart };
}
