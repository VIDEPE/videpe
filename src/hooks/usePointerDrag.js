import { useRef, useCallback, useState, useEffect } from 'react';

// Mouse and touch events both carry the pointer position, touch in touches[0]
const pointOf = (e) => {
  const { clientX, clientY } = e.touches ? e.touches[0] : e;
  return { clientX, clientY };
};

/**
 * Mouse and touch drag plumbing for a drag handle: listens on the window for the duration of
 * a drag only, so the pointer can leave the handle, and ends the drag on release or a
 * cancelled touch. What the drag does is up to the caller.
 *
 * @param {Function} onDragStart - called with the start point `{ clientX, clientY }`, plus any
 *   extra arguments given to handleDragStart; returns the drag's handlers
 *   `{ onMove(point), onEnd?() }`, or null to not start a drag.
 * @returns {Object}
 *   - `handleDragStart` (Function) — `(event, ...args)`, attach to the handle's `onMouseDown`
 *     and `onTouchStart`; extra args (e.g. which window edge) are passed on to onDragStart.
 *   - `isDragging` (boolean) — true for the whole drag, so the handle can stay highlighted
 *     when the pointer moves off it. Only changes at the start and end of a drag.
 */
export function usePointerDrag(onDragStart) {
  const [isDragging, setIsDragging] = useState(false);
  const removeListenersRef = useRef(null); // set while a drag is in progress

  const handleDragStart = useCallback(
    (e, ...args) => {
      const drag = onDragStart(pointOf(e), ...args);
      if (!drag) return;
      const isTouch = e.type === 'touchstart';
      // Mouse only: stops text selection while dragging. React's touchstart listener is passive,
      // so page scrolling during a touch drag is stopped in onTouchMove (and by the handle's
      // touch-none class) instead.
      if (!isTouch) e.preventDefault();
      setIsDragging(true);

      // Window listeners for this drag only, added below and removed when it ends.
      // Mouse moved: pass the new pointer position to the drag
      const onMouseMove = (moveEvent) => drag.onMove(pointOf(moveEvent));
      // Finger moved: same, and keep the page from scrolling along
      const onTouchMove = (moveEvent) => {
        moveEvent.preventDefault();
        drag.onMove(pointOf(moveEvent));
      };
      // Detach all of this drag's listeners (also used on unmount, without ending the drag)
      const removeListeners = () => {
        removeListenersRef.current = null;
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onEnd);
        window.removeEventListener('touchmove', onTouchMove);
        window.removeEventListener('touchend', onEnd);
        window.removeEventListener('touchcancel', onEnd);
      };
      // Mouse released, finger lifted or touch cancelled: stop listening, clear isDragging,
      // and let the drag finish (e.g. commit its final size)
      const onEnd = () => {
        removeListeners();
        setIsDragging(false);
        drag.onEnd?.();
      };
      removeListenersRef.current = removeListeners;
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
    [onDragStart]
  );

  // Unmounted mid-drag: drop the window listeners
  useEffect(() => () => removeListenersRef.current?.(), []);

  return { handleDragStart, isDragging };
}
