const RESIZE_DIRECTIONS = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

const RESIZE_CURSOR = {
  n: 'cursor-ns-resize',
  s: 'cursor-ns-resize',
  e: 'cursor-ew-resize',
  w: 'cursor-ew-resize',
  ne: 'cursor-nesw-resize',
  sw: 'cursor-nesw-resize',
  nw: 'cursor-nwse-resize',
  se: 'cursor-nwse-resize',
};

// Edge handles run the full length of their side; corner handles are small squares
// layered on top so diagonal resizing takes priority right at the corners.
const RESIZE_POSITION = {
  n: 'inset-x-0 top-0 h-1.5',
  s: 'inset-x-0 bottom-0 h-1.5',
  e: 'inset-y-0 right-0 w-1.5',
  w: 'inset-y-0 left-0 w-1.5',
  ne: 'top-0 right-0 w-2.5 h-2.5',
  nw: 'top-0 left-0 w-2.5 h-2.5',
  se: 'bottom-0 right-0 w-2.5 h-2.5',
  sw: 'bottom-0 left-0 w-2.5 h-2.5',
};

/**
 * Resize handles along a floating window's edges and corners (see useFloatingWindow). z-20
 * keeps them above the window's content at the edges, e.g. sticky z-10 column headers.
 *
 * @param {string} testIdPrefix - each handle's data-testid is `${testIdPrefix}-resize-${direction}`.
 * @param {Function} onResizeStart - `(event, direction)` on mouse down or touch start, e.g.
 *   useFloatingWindow's handleResizeStart.
 */
export function WindowResizeHandles({ testIdPrefix, onResizeStart }) {
  return RESIZE_DIRECTIONS.map((direction) => {
    // stopPropagation: a resize shouldn't also start whatever the window's parents do on a press
    const startResize = (e) => {
      e.stopPropagation();
      onResizeStart(e, direction);
    };
    return (
      <div
        key={direction}
        data-testid={`${testIdPrefix}-resize-${direction}`}
        // touch-none: dragging a handle with a finger doesn't scroll the page
        className={`absolute z-20 touch-none ${RESIZE_POSITION[direction]} ${RESIZE_CURSOR[direction]}`}
        onMouseDown={startResize}
        onTouchStart={startResize}
      />
    );
  });
}
