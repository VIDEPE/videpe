import { useRef, useState, useEffect } from 'react';
import { Maximize2, Minimize2, ArrowLeftRight, X} from 'lucide-react';

export const SplitPane = ({ leftLabel, rightLabel, left, right, onLeftReset, onRightReset }) => {
  const [splitPercent, setSplitPercent] = useState(50);// the percentage width of the left panel (when not maximized)
  const [maximized, setMaximized] = useState(null); // null | 'left' | 'right'
  const [swapped, setSwapped] = useState(false); // whether the left/right content is swapped (affects which side splitPercent applies to)
  const containerRef = useRef(null); // for measuring dimensions and mouse position during drag
  const leftPanelRef = useRef(null); // for directly setting width during drag without causing React re-renders
  const rightPanelRef = useRef(null); // for directly setting width during drag without causing React re-renders
  const isDraggingRef = useRef(false); // tracks whether the divider is currently being dragged, without causing re-renders
  const rafRef = useRef(null); // stores the pending requestAnimationFrame id so we can cancel it if needed
  const splitPercentRef = useRef(50); // mirrors splitPercent without triggering re-renders during drag
  const swappedRef = useRef(false);   // mirrors swapped for use inside rAF callbacks

  // Keep swappedRef in sync so rAF callbacks always read the current value
  useEffect(() => { swappedRef.current = swapped; }, [swapped]);

  useEffect(() => {
    const onMouseMove = (e) => {
      if (!isDraggingRef.current || !containerRef.current) return;

      // Cancel any queued frame — fast mouse moves would otherwise stack up redundant updates
      if (rafRef.current) cancelAnimationFrame(rafRef.current);

      // Capture clientX now; the event object may be recycled by the time the rAF fires
      const clientX = e.clientX;
      // requestAnimationFrame tells the browser "run this just before the next screen repaint" — at most 60 times per second.
      rafRef.current = requestAnimationFrame(() => {
        if (!isDraggingRef.current || !containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const pct = Math.min(85, Math.max(15, ((clientX - rect.left) / rect.width) * 100));
        splitPercentRef.current = pct;
        // Directly write the new widths into the DOM directly — skips React render cycle entirely during drag
        const isSwapped = swappedRef.current;
        if (leftPanelRef.current)
          leftPanelRef.current.style.width = isSwapped ? `${100 - pct}%` : `${pct}%`;
        if (rightPanelRef.current)
          rightPanelRef.current.style.width = isSwapped ? `${pct}%` : `${100 - pct}%`;
      });
    };
    const onMouseUp = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      isDraggingRef.current = false;
      // Sync React state once at end of drag so subsequent renders use the correct value
      setSplitPercent(splitPercentRef.current);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const toggleMaximize = (which) => setMaximized((prev) => (prev === which ? null : which));

  // leftWidth / rightWidth are DOM widths; CSS order controls visual position.
  // splitPercent is always the visual-left panel's percentage.
  // When swapped: NII is visual-left (order:1) with splitPercent%, EEG is visual-right (order:3) with (100-splitPercent)%.
  const leftWidth =
    maximized === 'left' ? '100%' :
    maximized === 'right' ? '0%' :
    swapped ? `${100 - splitPercent}%` : `${splitPercent}%`;

  const rightWidth =
    maximized === 'right' ? '100%' :
    maximized === 'left' ? '0%' :
    swapped ? `${splitPercent}%` : `${100 - splitPercent}%`;

  const panelHeader = (label, which, onReset) => (
    <div className="shrink-0 flex items-center justify-between px-3 py-1 border-b border-border bg-surface">
      <h2 style={{ margin: 0 }}>{label}</h2>
      <div className="flex items-center gap-1">
        {!maximized && (
          <button
            type="button"
            className="thin-button"
            onClick={() => setSwapped((s) => !s)}
            title="Swap panels"
          >
            <ArrowLeftRight size={14} />
          </button>
        )}
        <button
          type="button"
          className="thin-button"
          onClick={() => toggleMaximize(which)}
          title={maximized === which ? 'Restore' : 'Maximize'}
        >
          {maximized === which ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
        {onReset && (
          <button
            type="button"
            className="thin-button"
            onClick={onReset}
            title="Reset viewer"
          >
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );

  // Swap logic: The two panels never move in the DOM — the EEG panel is always DOM-first, NII always DOM-second.
  // Instead, their CSS order property is toggled between 1 and 3, with the divider fixed at order 2.
  // This means the viewers never unmount when swapped, so EEG state (zoom, scroll position) is preserved
  return (
    <div ref={containerRef} className="flex-1 min-h-0 flex flex-row">
      {/* Left content — DOM-first; visually right when swapped (order:3) */}
      <div
        ref={leftPanelRef}
        className="flex flex-col min-h-0 overflow-hidden"
        style={{ order: swapped ? 3 : 1, width: leftWidth }}
      >
        {panelHeader(leftLabel, 'left', onLeftReset)}
        <div className="flex-1 min-h-0">{left}</div>
      </div>

      {/* Divider — always visually between the two panels (order:2) */}
      {!maximized && (
        <div
          style={{ order: 2 }}
          className="w-1.5 shrink-0 cursor-col-resize bg-border hover:bg-primary/50 active:bg-primary transition-colors select-none"
          onMouseDown={(e) => { e.preventDefault(); isDraggingRef.current = true; }}
        />
      )}

      {/* Right content — DOM-second; visually left when swapped (order:1) */}
      <div
        ref={rightPanelRef}
        className="flex flex-col min-h-0 overflow-hidden"
        style={{ order: swapped ? 1 : 3, width: rightWidth }}
      >
        {panelHeader(rightLabel, 'right', onRightReset)}
        <div className="flex-1 min-h-0">{right}</div>
      </div>
    </div>
  );
};
