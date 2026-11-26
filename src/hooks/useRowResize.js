import { useRef, useCallback } from 'react';
import { usePointerDrag } from './usePointerDrag';

/**
 * Drag-to-resize for a row element's min-height. Writes to the DOM directly (not React state)
 * so dragging doesn't re-render on every mouse-move frame.
 *
 * @param {number} minHeight - px floor the row's min-height is clamped to; dragging past this
 *   point has no further effect.
 * @returns {Object}
 *   - `rowRef` (RefObject) — attach to the resizable row element.
 *   - `handleResizeStart` (Function) — attach to the drag handle's `onMouseDown` and
 *     `onTouchStart`; reads the row's current height as the drag's starting point and updates
 *     `row.style.minHeight` on every move (see usePointerDrag for the mouse/touch handling).
 *   - `isDragging` (boolean) — true while a drag is in progress, so the handle can stay
 *     highlighted even when the pointer or finger moves off it. Only changes at the start and
 *     end of a drag, so it doesn't re-render on every move.
 */
export function useRowResize(minHeight) {
  const rowRef = useRef();

  const startResize = useCallback(
    ({ clientY: startY }) => {
      const row = rowRef.current;
      if (!row) return null;
      const startHeight = row.getBoundingClientRect().height;
      return {
        onMove: ({ clientY }) => {
          const nextHeight = Math.max(minHeight, startHeight + (clientY - startY));
          row.style.minHeight = `${nextHeight}px`;
        },
      };
    },
    [minHeight]
  );

  const { handleDragStart: handleResizeStart, isDragging } = usePointerDrag(startResize);
  return { rowRef, handleResizeStart, isDragging };
}
