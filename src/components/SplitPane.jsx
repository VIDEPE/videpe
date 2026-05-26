import { useRef, useState, useEffect } from 'react';
import { Maximize2, Minimize2, ArrowLeftRight } from 'lucide-react';

export const SplitPane = ({ leftLabel, rightLabel, left, right }) => {
  const [splitPercent, setSplitPercent] = useState(50);
  const [maximized, setMaximized] = useState(null); // null | 'left' | 'right'
  const [swapped, setSwapped] = useState(false);
  const containerRef = useRef(null);
  const isDraggingRef = useRef(false);
  const rafRef = useRef(null);

  useEffect(() => {
    const onMouseMove = (e) => {
      if (!isDraggingRef.current || !containerRef.current) return;

      // Cancel any queued frame — fast mouse moves would otherwise stack up redundant updates
      if (rafRef.current) cancelAnimationFrame(rafRef.current);

      // Capture clientX now; the event object may be recycled by the time the rAF fires
      const clientX = e.clientX;
      rafRef.current = requestAnimationFrame(() => {
        if (!isDraggingRef.current || !containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const pct = ((clientX - rect.left) / rect.width) * 100;
        setSplitPercent(Math.min(85, Math.max(15, pct)));
      });
    };
    const onMouseUp = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      isDraggingRef.current = false;
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

  const panelHeader = (label, which) => (
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
      </div>
    </div>
  );

  return (
    <div ref={containerRef} className="flex-1 min-h-0 flex flex-row">
      {/* Left content — DOM-first; visually right when swapped (order:3) */}
      <div
        className="flex flex-col min-h-0 overflow-hidden"
        style={{ order: swapped ? 3 : 1, width: leftWidth }}
      >
        {panelHeader(leftLabel, 'left')}
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
        className="flex flex-col min-h-0 overflow-hidden"
        style={{ order: swapped ? 1 : 3, width: rightWidth }}
      >
        {panelHeader(rightLabel, 'right')}
        <div className="flex-1 min-h-0">{right}</div>
      </div>
    </div>
  );
};
