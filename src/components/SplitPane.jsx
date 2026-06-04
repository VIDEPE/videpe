import { useRef, useState, useEffect } from 'react';
import { Maximize2, Minimize2, ArrowLeftRight, X } from 'lucide-react';

const ICON_SIZE = 13;
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
}) => {
  const [splitPercent, setSplitPercent] = useState(50); // proportion of the first panel (0–100)
  const [maximized, setMaximized] = useState(null); // null | 'left' | 'right'
  const [swapped, setSwapped] = useState(false); // whether the left/right (or top/bottom) content is swapped
  const [isDragging, setIsDragging] = useState(false); // true while the divider is being dragged — used to highlight it on touch where active: pseudo-class is unreliable
  const [isColumn, setIsColumn] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < COLUMN_BREAKPOINT
  ); // true on narrow viewports — panels stack vertically instead of side by side

  const containerRef = useRef(null); // for measuring dimensions and mouse/touch position during drag
  const leftPanelRef = useRef(null); // for directly updating panel sizes during drag without triggering React re-renders
  const rightPanelRef = useRef(null);
  const isDraggingRef = useRef(false); // tracks whether the divider is currently being dragged
  const rafRef = useRef(null); // stores the pending requestAnimationFrame id so we can cancel it if needed
  const splitPercentRef = useRef(50); // mirrors splitPercent without triggering re-renders during drag
  const swappedRef = useRef(false); // mirrors swapped for use inside rAF callbacks
  const isColumnRef = useRef(isColumn); // mirrors isColumn for use inside rAF callbacks

  // Keep refs in sync with state so rAF callbacks always read current values
  useEffect(() => { swappedRef.current = swapped; }, [swapped]);
  useEffect(() => { isColumnRef.current = isColumn; }, [isColumn]);

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
    // Shared drag update logic — used by both mouse and touch handlers
    const applyDrag = (clientX, clientY) => {
      if (!isDraggingRef.current || !containerRef.current) return;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);

      // Capture coordinates before the rAF fires — the event object may be recycled by then
      rafRef.current = requestAnimationFrame(() => {
        if (!isDraggingRef.current || !containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const isCol = isColumnRef.current;
        const isSwapped = swappedRef.current;

        // In column mode drag along Y; in row mode drag along X.
        // Column mode clamps from a minimum pixel height so short screens stay usable.
        const colMinPct = Math.min(50, (MIN_PANEL_PX / rect.height) * 100);
        const pct = isCol
          ? Math.min(100 - colMinPct, Math.max(colMinPct, ((clientY - rect.top) / rect.height) * 100))
          : Math.min(ROW_MAX_PCT, Math.max(ROW_MIN_PCT, ((clientX - rect.left) / rect.width) * 100));
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
    };

    const stopDrag = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      isDraggingRef.current = false;
      setIsDragging(false);
      // Sync React state once at end of drag so subsequent renders use the correct value
      setSplitPercent(splitPercentRef.current);
    };

    const onMouseMove = (e) => applyDrag(e.clientX, e.clientY);
    const onTouchMove = (e) => {
      if (!isDraggingRef.current) return;
      e.preventDefault(); // prevent page scroll while dragging the divider
      applyDrag(e.touches[0].clientX, e.touches[0].clientY);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', stopDrag);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', stopDrag);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', stopDrag);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', stopDrag);
    };
  }, []);

  const toggleMaximize = (which) => setMaximized((prev) => (prev === which ? null : which));

  // Compute the share of space each panel gets (0–100).
  // When maximized, one panel gets everything and the other nothing.
  const leftGrow =
    maximized === 'left' ? 100
    : maximized === 'right' ? 0
    : swapped ? 100 - splitPercent
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

  // Common styles for the traffic light buttons in the panel headers
  const trafficBtn =
    'inline-flex items-center justify-center w-4 h-4 rounded-full border-none cursor-pointer transition-all text-foreground/50 hover:text-black/70 bg-border';

  // Helper to render the header for each panel, with label and control buttons
  const panelHeader = (label, which, onReset) => (
    <div className="shrink-0 flex items-center justify-between px-3 py-1 border-b border-border bg-surface">
      <h2 style={{ margin: 0 }} className="select-none pointer-events-none">{label}</h2>
      <div className="flex items-center gap-1.5">
        {!maximized && (
          <button
            type="button"
            className={`${trafficBtn} hover:bg-[#28C840]`}
            onClick={() => setSwapped((s) => !s)}
            title="Swap panels"
            aria-pressed={swapped}
          >
            <ArrowLeftRight size={ICON_SIZE} />
          </button>
        )}
        <button
          type="button"
          className={`${trafficBtn} hover:bg-[#FFBD2E]`}
          onClick={() => toggleMaximize(which)}
          title={maximized === which ? 'Restore' : 'Maximize'}
          aria-pressed={maximized === which}
        >
          {maximized === which ? <Minimize2 size={ICON_SIZE} /> : <Maximize2 size={ICON_SIZE} />}
        </button>
        {onReset && (
          <button
            type="button"
            className={`${trafficBtn} hover:bg-[#FF5F57]`}
            onClick={onReset}
            title="Reset viewer"
          >
            <X size={ICON_SIZE} />
          </button>
        )}
      </div>
    </div>
  );

  // Swap logic: The two panels never move in the DOM — the EEG panel is always DOM-first, NII always DOM-second.
  // Instead, their CSS order property is toggled between 1 and 3, with the divider fixed at order 2.
  // This means the viewers never unmount when swapped, so EEG state (zoom, scroll position) is preserved
  return (
    <div
      ref={containerRef}
      className={`flex-1 min-h-0 flex ${isColumn ? 'flex-col' : 'flex-row'}`}
    >
      {/* Left/top content — DOM-first; visually right/bottom when swapped (order:3) */}
      <div
        ref={leftPanelRef}
        className="flex flex-col min-h-0 overflow-hidden"
        style={leftStyle}
      >
        {panelHeader(leftLabel, 'left', onLeftReset)}
        <div className="flex-1 min-h-0">{left}</div>
      </div>

      {/* Divider — always visually between the two panels (order:2).
          Horizontal bar in column mode, vertical bar in row mode. */}
      {!maximized && (
        <div
          style={{ order: 2 }}
          className={
            isColumn
              ? `h-1.5 w-full shrink-0 cursor-row-resize my-1 transition-colors select-none ${isDragging ? 'bg-primary' : 'bg-border hover:bg-secondary'}`
              : `w-1.5 shrink-0 cursor-col-resize mx-1 transition-colors select-none ${isDragging ? 'bg-primary' : 'bg-border hover:bg-secondary'}`
          }
          onMouseDown={(e) => {
            e.preventDefault();
            isDraggingRef.current = true;
            setIsDragging(true);
          }}
          onTouchStart={(e) => {
            e.preventDefault();
            isDraggingRef.current = true;
            setIsDragging(true);
          }}
        />
      )}

      {/* Right/bottom content — DOM-second; visually left/top when swapped (order:1) */}
      <div
        ref={rightPanelRef}
        className="flex flex-col min-h-0 overflow-hidden"
        style={rightStyle}
      >
        {panelHeader(rightLabel, 'right', onRightReset)}
        <div className="flex-1 min-h-0">{right}</div>
      </div>
    </div>
  );
};
