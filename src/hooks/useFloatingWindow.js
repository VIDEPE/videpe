import { useRef, useState, useCallback } from 'react';

/**
 * Position, size and maximize state of a floating window, with dragging by its title bar and
 * resizing by its edges and corners (see WindowResizeHandles).
 *
 * @param {Object} options
 * @param {{x: number, y: number}} options.defaultPosition - px, the window's top-left corner on open.
 * @param {{width: number, height: number}} options.defaultSize - px, the window's size on open.
 * @param {{width: number, height: number}} options.minSize - px, resizing stops here.
 * @returns {Object}
 *   - `isMaximized` (boolean) and `toggleMaximize` (Function) — for the title bar's maximize button.
 *   - `windowProps` ({className, style}) — spread onto the window's outer element.
 *   - `handleDragStart` (Function) — attach to the title bar's `onMouseDown`.
 *   - `handleResizeStart` (Function) — `(event, direction)`, for WindowResizeHandles' `onResizeStart`.
 */
export function useFloatingWindow({ defaultPosition, defaultSize, minSize }) {
  const dragOffset = useRef(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const [position, setPosition] = useState(defaultPosition);
  const [size, setSize] = useState(defaultSize);

  const toggleMaximize = useCallback(() => setIsMaximized((v) => !v), []);

  // Drag the floating window by its title bar. Position is clamped to the viewport so the
  // window (and its title bar drag handle) can never be dragged out of view and get stranded.
  const handleDragStart = useCallback(
    (e) => {
      dragOffset.current = { x: e.clientX - position.x, y: e.clientY - position.y };
      const onMove = (e) => {
        const maxX = Math.max(0, window.innerWidth - size.width);
        const maxY = Math.max(0, window.innerHeight - size.height);
        setPosition({
          x: Math.min(Math.max(e.clientX - dragOffset.current.x, 0), maxX),
          y: Math.min(Math.max(e.clientY - dragOffset.current.y, 0), maxY),
        });
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [position, size]
  );

  // Resize the floating window by dragging an edge or corner. direction is a combination of
  // 'n'/'s'/'e'/'w' identifying which edges move; dragging n/w also shifts position so the
  // opposite edge stays anchored in place, matching how OS window resizing behaves.
  const handleResizeStart = useCallback(
    (e, direction) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startY = e.clientY;
      const startWidth = size.width;
      const startHeight = size.height;
      const startPosition = position;

      const onMove = (e) => {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        const nextSize = { width: startWidth, height: startHeight };
        const nextPosition = { ...startPosition };

        if (direction.includes('e')) nextSize.width = Math.max(minSize.width, startWidth + dx);
        if (direction.includes('s')) nextSize.height = Math.max(minSize.height, startHeight + dy);
        if (direction.includes('w')) {
          nextSize.width = Math.max(minSize.width, startWidth - dx);
          nextPosition.x = startPosition.x + (startWidth - nextSize.width);
        }
        if (direction.includes('n')) {
          nextSize.height = Math.max(minSize.height, startHeight - dy);
          nextPosition.y = startPosition.y + (startHeight - nextSize.height);
        }

        setSize(nextSize);
        setPosition(nextPosition);
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [size, position, minSize.width, minSize.height]
  );

  const windowProps = isMaximized
    ? { className: 'fixed inset-0 z-50 flex flex-col bg-surface', style: { boxShadow: 'none' } }
    : {
        className: 'fixed z-50 flex flex-col rounded-lg border border-border bg-surface',
        style: {
          left: position.x,
          top: position.y,
          width: size.width,
          height: size.height,
          boxShadow: 'var(--c-shadow)',
        },
      };

  return { isMaximized, toggleMaximize, windowProps, handleDragStart, handleResizeStart };
}
