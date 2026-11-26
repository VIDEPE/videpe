import { useRef, useState, useCallback } from 'react';
import { usePointerDrag } from './usePointerDrag';

// The window's opening layout, fitted to the screen: shrunk to fit and moved fully on screen,
// and maximized when the screen is smaller than the minimum size (e.g. a phone), so the title
// bar's buttons are never off screen
function fitToScreen({ defaultPosition, defaultSize, minSize }) {
  const screen = { width: window.innerWidth, height: window.innerHeight };
  const size = {
    width: Math.min(defaultSize.width, screen.width),
    height: Math.min(defaultSize.height, screen.height),
  };
  return {
    isMaximized: screen.width < minSize.width || screen.height < minSize.height,
    position: {
      x: Math.max(0, Math.min(defaultPosition.x, screen.width - size.width)),
      y: Math.max(0, Math.min(defaultPosition.y, screen.height - size.height)),
    },
    size,
  };
}

/**
 * Position, size and maximize state of a floating window, with dragging by its title bar and
 * resizing by its edges and corners (see WindowResizeHandles). Opens fitted to the screen.
 *
 * @param {Object} options
 * @param {{x: number, y: number}} options.defaultPosition - px, the window's top-left corner on open.
 * @param {{width: number, height: number}} options.defaultSize - px, the window's size on open.
 * @param {{width: number, height: number}} options.minSize - px, resizing stops here.
 * @returns {Object}
 *   - `isMaximized` (boolean) and `toggleMaximize` (Function) — for the title bar's maximize button.
 *   - `windowProps` ({className, style}) — spread onto the window's outer element.
 *   - `handleDragStart` (Function) — attach to the title bar's `onMouseDown` and `onTouchStart`
 *     (and give it touch-none, so dragging it doesn't scroll the page).
 *   - `handleResizeStart` (Function) — `(event, direction)`, for WindowResizeHandles' `onResizeStart`.
 */
export function useFloatingWindow({ defaultPosition, defaultSize, minSize }) {
  const dragOffset = useRef(null);
  const [opening] = useState(() => fitToScreen({ defaultPosition, defaultSize, minSize }));
  const [isMaximized, setIsMaximized] = useState(opening.isMaximized);
  const [position, setPosition] = useState(opening.position);
  const [size, setSize] = useState(opening.size);

  const toggleMaximize = useCallback(() => setIsMaximized((v) => !v), []);

  // Drag the floating window by its title bar. Position is clamped to the viewport so the
  // window (and its title bar drag handle) can never be dragged out of view and get stranded.
  // Mouse/touch handling is in usePointerDrag.
  const startMove = useCallback(
    ({ clientX, clientY }) => {
      dragOffset.current = { x: clientX - position.x, y: clientY - position.y };
      return {
        onMove: ({ clientX, clientY }) => {
          const maxX = Math.max(0, window.innerWidth - size.width);
          const maxY = Math.max(0, window.innerHeight - size.height);
          setPosition({
            x: Math.min(Math.max(clientX - dragOffset.current.x, 0), maxX),
            y: Math.min(Math.max(clientY - dragOffset.current.y, 0), maxY),
          });
        },
      };
    },
    [position, size]
  );
  const { handleDragStart } = usePointerDrag(startMove);

  // Resize the floating window by dragging an edge or corner. direction is a combination of
  // 'n'/'s'/'e'/'w' identifying which edges move; dragging n/w also shifts position so the
  // opposite edge stays anchored in place, matching how OS window resizing behaves.
  const startResize = useCallback(
    ({ clientX: startX, clientY: startY }, direction) => {
      const startWidth = size.width;
      const startHeight = size.height;
      const startPosition = position;

      return {
        onMove: ({ clientX, clientY }) => {
          const dx = clientX - startX;
          const dy = clientY - startY;
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
        },
      };
    },
    [size, position, minSize.width, minSize.height]
  );
  const { handleDragStart: handleResizeStart } = usePointerDrag(startResize);

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
