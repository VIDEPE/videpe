import { useRef, useState, useEffect, useCallback } from 'react';
import { TrafficLightButtons } from './TrafficLightButtons';
import { usePointerDrag } from '@/hooks/usePointerDrag';

const COLUMN_BREAKPOINT = 640; // px — matches Tailwind's 'sm' breakpoint; below this the panels stack vertically
const MIN_PANEL_PX = 150; // minimum panel height in column mode — clamp tightens on short screens automatically
const ROW_MIN_PCT = 25; // minimum panel width % in row mode
const ROW_MAX_PCT = 100 - ROW_MIN_PCT; // = 75

export const SplitPane = ({
  leftLabel,
  rightLabel,
  left,
  right,
  onLeftReset,
  onRightReset,
  onMaximizeChange,
  onSwapChange,
  defaultSplitPercent = 50,
}) => {
  const [splitPercent, setSplitPercent] = useState(defaultSplitPercent); // proportion of the first panel (0–100)
  const [maximized, setMaximized] = useState(null); // null | 'left' | 'right'
  const [swapped, setSwapped] = useState(false); // whether the left/right (or top/bottom) content is swapped
  const [isColumn, setIsColumn] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < COLUMN_BREAKPOINT
  ); // true on narrow viewports — panels stack vertically instead of side by side

  const containerRef = useRef(null); // for measuring dimensions and mouse/touch position during drag
  const leftPanelRef = useRef(null); // for directly updating panel sizes during drag without triggering React re-renders
  const rightPanelRef = useRef(null);
  const rafRef = useRef(null); // stores the pending requestAnimationFrame id so we can cancel it if needed
  const splitPercentRef = useRef(defaultSplitPercent); // mirrors splitPercent without triggering re-renders during drag
  const swappedRef = useRef(false); // mirrors swapped for use inside rAF callbacks
  const isColumnRef = useRef(isColumn); // mirrors isColumn for use inside rAF callbacks

  // Keep refs in sync with state so rAF callbacks always read current values
  useEffect(() => {
    swappedRef.current = swapped;
  }, [swapped]);
  useEffect(() => {
    isColumnRef.current = isColumn;
  }, [isColumn]);

  // Watch the sm breakpoint and switch layout mode when it crosses
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${COLUMN_BREAKPOINT - 1}px)`);
    const handler = (e) => setIsColumn(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    onMaximizeChange?.(maximized);
  }, [maximized, onMaximizeChange]);

  useEffect(() => {
    onSwapChange?.(swapped);
  }, [swapped, onSwapChange]);

  // A divider drag. Mouse/touch handling is in usePointerDrag; this only sizes the panels
  const startSplitDrag = useCallback(
    () => ({
      onMove: ({ clientX, clientY }) => {
        if (!containerRef.current) return;
        if (rafRef.current) cancelAnimationFrame(rafRef.current);

        // Capture coordinates before the rAF fires — the event object may be recycled by then
        rafRef.current = requestAnimationFrame(() => {
          if (!containerRef.current) return;
          const rect = containerRef.current.getBoundingClientRect();
          const isCol = isColumnRef.current;
          const isSwapped = swappedRef.current;

          // In column mode drag along Y; in row mode drag along X.
          // Column mode clamps from a minimum pixel height so short screens stay usable.
          const colMinPct = Math.min(50, (MIN_PANEL_PX / rect.height) * 100);
          const pct = isCol
            ? Math.min(
                100 - colMinPct,
                Math.max(colMinPct, ((clientY - rect.top) / rect.height) * 100)
              )
            : Math.min(
                ROW_MAX_PCT,
                Math.max(ROW_MIN_PCT, ((clientX - rect.left) / rect.width) * 100)
              );
          splitPercentRef.current = pct;

          // Directly write the new size into the DOM — skips React render cycle entirely during drag.
          // Row mode uses width %; column mode uses flex-grow ratios (avoids percentage-height CSS issues).
          if (isCol) {
            if (leftPanelRef.current)
              leftPanelRef.current.style.flexGrow = isSwapped ? 100 - pct : pct;
            if (rightPanelRef.current)
              rightPanelRef.current.style.flexGrow = isSwapped ? pct : 100 - pct;
          } else {
            if (leftPanelRef.current)
              leftPanelRef.current.style.width = isSwapped ? `${100 - pct}%` : `${pct}%`;
            if (rightPanelRef.current)
              rightPanelRef.current.style.width = isSwapped ? `${pct}%` : `${100 - pct}%`;
          }
        });
      },
      onEnd: () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        // Sync React state once at end of drag so subsequent renders use the correct value
        setSplitPercent(splitPercentRef.current);
      },
    }),
    []
  );
  // isSplitResizing highlights the divider while dragged — on touch the active: pseudo-class is unreliable
  const { handleDragStart: handleSplitDragStart, isDragging: isSplitResizing } =
    usePointerDrag(startSplitDrag);

  const toggleMaximize = (side) => setMaximized((prev) => (prev === side ? null : side));

  // Compute the share of space each panel gets (0–100).
  // When maximized, one panel gets everything and the other nothing.
  const leftGrow =
    maximized === 'left'
      ? 100
      : maximized === 'right'
        ? 0
        : swapped
          ? 100 - splitPercent
          : splitPercent;
  const rightGrow = 100 - leftGrow;

  // Row mode uses explicit widths (same as before); column mode uses flex-grow so height allocation
  // works correctly even when the ancestor has no fixed pixel height.
  const leftStyle = isColumn
    ? { order: swapped ? 3 : 1, flexGrow: leftGrow, flexShrink: 1, flexBasis: '0px' }
    : { order: swapped ? 3 : 1, width: `${leftGrow}%` };

  const rightStyle = isColumn
    ? { order: swapped ? 1 : 3, flexGrow: rightGrow, flexShrink: 1, flexBasis: '0px' }
    : { order: swapped ? 1 : 3, width: `${rightGrow}%` };

  // Helper to render the header for each panel, with label and control buttons
  const panelHeader = (label, side, onReset) => (
    <div className="shrink-0 flex items-center justify-between px-3 py-1 border-b border-border bg-surface">
      {/* min-w-0: lets the label shrink (and truncate) instead of pushing the buttons away */}
      <h2 style={{ margin: 0 }} className="min-w-0 select-none pointer-events-none">
        {label}
      </h2>
      <TrafficLightButtons
        onSwap={!maximized ? () => setSwapped((s) => !s) : undefined}
        isSwapped={swapped}
        onMaximize={() => toggleMaximize(side)}
        isMaximized={maximized === side}
        onClose={onReset}
        closeTitle="Reset viewer"
      />
    </div>
  );

  // Swap logic: The two panels never move in the DOM — the EEG panel is always DOM-first, NII always DOM-second.
  // Instead, their CSS order property is toggled between 1 and 3, with the divider fixed at order 2.
  // This means the viewers never unmount when swapped, so EEG state (zoom, scroll position) is preserved
  return (
    <div ref={containerRef} className={`flex-1 min-h-0 flex ${isColumn ? 'flex-col' : 'flex-row'}`}>
      {/* Left/top content — DOM-first; visually right/bottom when swapped (order:3) */}
      <div
        ref={leftPanelRef}
        className={`flex flex-col min-h-0 overflow-hidden ${isSplitResizing ? '' : 'transition-[width,flex-grow] duration-200 ease-in-out'}`}
        style={leftStyle}
      >
        {panelHeader(leftLabel, 'left', onLeftReset)}
        <div className="flex-1 min-h-0 overflow-y-auto themed-scrollbar">{left}</div>
      </div>

      {/* Divider — always visually between the two panels (order:2).
          Horizontal bar in column mode, vertical bar in row mode. */}
      {!maximized && (
        <div
          style={{ order: 2 }}
          className={
            isColumn
              ? `h-1.5 pointer-coarse:h-4 w-full shrink-0 cursor-row-resize rounded-sm my-1 transition-colors select-none touch-none ${isSplitResizing ? 'bg-primary' : 'bg-border hover:bg-secondary'}`
              : `w-1.5 pointer-coarse:w-4 shrink-0 cursor-col-resize rounded-sm mx-1 transition-colors select-none touch-none ${isSplitResizing ? 'bg-primary' : 'bg-border hover:bg-secondary'}`
          }
          title="Drag to resize the split view"
          onMouseDown={handleSplitDragStart}
          onTouchStart={handleSplitDragStart}
        />
      )}

      {/* Right/bottom content — DOM-second; visually left/top when swapped (order:1) */}
      <div
        ref={rightPanelRef}
        className={`flex flex-col min-h-0 overflow-hidden ${isSplitResizing ? '' : 'transition-[width,flex-grow] duration-200 ease-in-out'}`}
        style={rightStyle}
      >
        {panelHeader(rightLabel, 'right', onRightReset)}
        <div className="flex-1 min-h-0 overflow-y-auto themed-scrollbar">{right}</div>
      </div>
    </div>
  );
};
