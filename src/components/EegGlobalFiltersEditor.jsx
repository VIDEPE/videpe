import { useRef, useMemo, useState, useCallback } from 'react';
import { Check } from 'lucide-react';

import { useTheme } from '@/hooks/useTheme';
import { TrafficLightButtons } from '@/components/TrafficLightButtons';
import { TYPE_LIST, TYPE_ORDER } from '@/utils/channelTypes';
import { cn } from '@/utils/utils';

// ─── Window sizing constants ────────────────────────────────────────────────
// Default/minimum window size in px — much smaller than the montage editor, since this window
// only holds one row per channel type
const START_WINDOW_POS = { x: 40, y: 50 };
const DEFAULT_WINDOW_SIZE = { width: 420, height: 280 };
const MIN_WINDOW_WIDTH = 360;
const MIN_WINDOW_HEIGHT = 220;
const RESIZE_DIRECTIONS = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

// ─── Shared styling settings ────────────────────────────────────────
// Shared column-width classes — the header cell (with its bulk "set all" control) and each
// type row's own input use the exact same class, so the columns line up.
const TYPE_COL_CLASS = 'flex-1 min-w-12';
const FILTER_COL_CLASS = 'w-14 shrink-0';

export function EegGlobalFiltersEditor({
  globalFilters,
  fs, // sampling frequency of the loaded EEG recording
  onApplyGlobalFilters,
  onClose,
}) {
  const { isDarkMode } = useTheme();
  const rowDividerColor = isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
  const nyquist = fs / 2;

  // ─── Refs ───────────────────────────────────────────────────────────────────
  const dragOffset = useRef(null);

  // ─── State ──────────────────────────────────────────────────────────────────
  const [isMaximized, setIsMaximized] = useState(false);
  const [position, setPosition] = useState({ x: START_WINDOW_POS.x, y: START_WINDOW_POS.y });
  const [size, setSize] = useState(DEFAULT_WINDOW_SIZE);

  // Draft globalFilters — this component remounts fresh every time it's opened (EegViewer
  // conditionally renders it), so seeding draft state from the live props here naturally
  // re-snapshots on every open with no extra reset effect needed. Edits only ever touch this
  // draft; nothing reaches the live state in EegViewer until Apply/OK explicitly commits it.
  const [draftGlobalFilters, setDraftGlobalFilters] = useState(() => globalFilters);

  // Whether the draft differs from what was last applied — marks the title with * and
  // highlights Apply, same as the montage editor.
  const isModified = useMemo(
    () => JSON.stringify(draftGlobalFilters) !== JSON.stringify(globalFilters),
    [draftGlobalFilters, globalFilters]
  );

  // ─── Handlers ───────────────────────────────────────────────────────────────

  // Per-type draft setters — one per filter, keyed by channel type
  const setDraftFilterHighPass = useCallback((type, highPass) => {
    setDraftGlobalFilters((prev) => ({ ...prev, [type]: { ...prev[type], highPass } }));
  }, []);

  const setDraftFilterLowPass = useCallback((type, lowPass) => {
    setDraftGlobalFilters((prev) => ({ ...prev, [type]: { ...prev[type], lowPass } }));
  }, []);

  const setDraftFilterNotch = useCallback((type, notch) => {
    setDraftGlobalFilters((prev) => ({ ...prev, [type]: { ...prev[type], notch } }));
  }, []);

  const handleApply = useCallback(() => {
    onApplyGlobalFilters(draftGlobalFilters);
  }, [draftGlobalFilters, onApplyGlobalFilters]);

  const handleOk = useCallback(() => {
    handleApply();
    onClose();
  }, [handleApply, onClose]);

  // Bulk "set all" filter controls — each of the three applies independently (its own
  // checkmark button, inline under its column header), not as one combined action. A blank
  // field clears that one setting (off) for every type. Each typed value is clamped to
  // [0, nyquist], mirroring the per-type inputs' own bounds.
  const [bulkHighPass, setBulkHighPass] = useState('');
  const [bulkLowPass, setBulkLowPass] = useState('');
  const [bulkNotch, setBulkNotch] = useState('');

  const clampBulkFilterValue = (value) =>
    value === '' ? null : Math.min(nyquist, Math.max(0, Number(value)));
  const handleSetAllHighPass = () => {
    const highPass = clampBulkFilterValue(bulkHighPass);
    TYPE_ORDER.forEach((type) => setDraftFilterHighPass(type, highPass));
  };
  const handleSetAllLowPass = () => {
    const lowPass = clampBulkFilterValue(bulkLowPass);
    TYPE_ORDER.forEach((type) => setDraftFilterLowPass(type, lowPass));
  };
  const handleSetAllNotch = () => {
    const notch = clampBulkFilterValue(bulkNotch);
    TYPE_ORDER.forEach((type) => setDraftFilterNotch(type, notch));
  };

  //  window drag/resize
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

        if (direction.includes('e')) nextSize.width = Math.max(MIN_WINDOW_WIDTH, startWidth + dx);
        if (direction.includes('s'))
          nextSize.height = Math.max(MIN_WINDOW_HEIGHT, startHeight + dy);
        if (direction.includes('w')) {
          nextSize.width = Math.max(MIN_WINDOW_WIDTH, startWidth - dx);
          nextPosition.x = startPosition.x + (startWidth - nextSize.width);
        }
        if (direction.includes('n')) {
          nextSize.height = Math.max(MIN_WINDOW_HEIGHT, startHeight - dy);
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
    [size, position]
  );

  // ─── Render helpers ─────────────────────────────────────────────────────────
  const resizeCursor = {
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
  const resizePosition = {
    n: 'inset-x-0 top-0 h-1.5',
    s: 'inset-x-0 bottom-0 h-1.5',
    e: 'inset-y-0 right-0 w-1.5',
    w: 'inset-y-0 left-0 w-1.5',
    ne: 'top-0 right-0 w-2.5 h-2.5',
    nw: 'top-0 left-0 w-2.5 h-2.5',
    se: 'bottom-0 right-0 w-2.5 h-2.5',
    sw: 'bottom-0 left-0 w-2.5 h-2.5',
  };

  // The three filter columns share the same header layout (label + bulk input + checkmark),
  // so they're described once here and mapped over in both the header and the type rows.
  const filterColumns = [
    {
      key: 'highPass',
      label: 'High Pass',
      bulkValue: bulkHighPass,
      setBulkValue: setBulkHighPass,
      onSetAll: handleSetAllHighPass,
      setDraft: setDraftFilterHighPass,
    },
    {
      key: 'lowPass',
      label: 'Low Pass',
      bulkValue: bulkLowPass,
      setBulkValue: setBulkLowPass,
      onSetAll: handleSetAllLowPass,
      setDraft: setDraftFilterLowPass,
    },
    {
      key: 'notch',
      label: 'Notch',
      bulkValue: bulkNotch,
      setBulkValue: setBulkNotch,
      onSetAll: handleSetAllNotch,
      setDraft: setDraftFilterNotch,
    },
  ];

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      className={
        isMaximized
          ? 'fixed inset-0 z-50 flex flex-col bg-surface'
          : 'fixed z-50 flex flex-col rounded-lg border border-border bg-surface'
      }
      style={
        isMaximized
          ? { boxShadow: 'none' }
          : {
              left: position.x,
              top: position.y,
              width: size.width,
              height: size.height,
              boxShadow: 'var(--c-shadow)',
            }
      }
    >
      {/* Title bar — drag handle; explicit bg-surface so NiiVue's black canvas doesn't bleed through */}
      <div
        data-testid="global-filters-title-bar"
        className="flex items-center justify-between px-2 py-1 border-b border-border cursor-grab select-none shrink-0 bg-surface"
        onMouseDown={handleDragStart}
      >
        <span className="text-sm font-medium text-heading">
          {isModified ? 'Global EEG Filters *' : 'Global EEG Filters'}
        </span>
        <TrafficLightButtons
          onMaximize={() => setIsMaximized((v) => !v)}
          isMaximized={isMaximized}
          onClose={onClose}
        />
      </div>

      {/* Header + one row per channel type — bg-background inside a bg-surface padding, so the
          surrounding surface shows as a border around the list, like the montage row list. */}
      <div className="flex-1 min-h-0 flex flex-col p-2">
        <div className="flex-1 min-h-0 overflow-auto bg-background">
          {/* Column headers — sticky so they stay visible if the window is made very short */}
          <div className="sticky top-0 z-10 flex items-end gap-2 pl-3 pr-1 py-1 text-xs font-medium text-header border-b-2 border-border bg-background">
            <span className={cn(TYPE_COL_CLASS, 'cursor-default')}>Type</span>
            {/* High Pass / Low Pass / Notch — each applies independently: type a value in
                that column and click its own checkmark. A blank field clears that one setting
                (off) for every type. */}
            {filterColumns.map((column) => (
              <div
                key={column.key}
                className={cn(FILTER_COL_CLASS, 'flex flex-col gap-0.5')}
                title={`${column.label} filter frequency`}
              >
                <span className="text-center cursor-default">{column.label}</span>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    placeholder="Hz"
                    aria-label={`Set all types' ${column.label} filter frequency`}
                    className="flex-1 min-w-0 text-xs border border-border rounded bg-surface"
                    data-testid={`bulk-${column.key}-input`}
                    min={0}
                    max={nyquist}
                    step="any"
                    value={column.bulkValue}
                    onChange={(e) => column.setBulkValue(e.target.value)}
                  />
                  <button
                    type="button"
                    className="shrink-0 w-4 h-4 rounded-full bg-primary text-background flex items-center justify-center disabled:opacity-40 cursor-pointer"
                    data-testid={`bulk-${column.key}-apply-button`}
                    title={`Set every type's ${column.label} to this value`}
                    onClick={column.onSetAll}
                  >
                    <Check size={10} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* One row per channel type, in TYPE_ORDER — a type added to TYPE_LIST shows up here
              automatically */}
          {TYPE_ORDER.map((type) => (
            <div
              key={type}
              className="flex items-center gap-2 pl-3 pr-1 py-0.5"
              style={{ borderBottom: `1px solid ${rowDividerColor}` }}
              data-testid={`global-filters-row-${type}`}
            >
              <span className={cn(TYPE_COL_CLASS, 'truncate text-sm')}>{TYPE_LIST[type]}</span>
              {filterColumns.map((column) => (
                <input
                  key={column.key}
                  type="number"
                  data-testid={`global-${column.key}-${type}`}
                  aria-label={`${TYPE_LIST[type]} ${column.label} filter frequency`}
                  className={cn(FILTER_COL_CLASS, 'text-xs bg-surface')}
                  min={0}
                  max={nyquist}
                  step="any"
                  value={draftGlobalFilters[type]?.[column.key] ?? ''}
                  onChange={(e) =>
                    column.setDraft(type, e.target.value ? Number(e.target.value) : null)
                  }
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Footer — Apply/OK commit the draft to EegViewer's live globalFilters; Cancel (and
          the title bar's red X, via onClose) discard it by simply closing without committing. */}
      <div className="shrink-0 flex items-center justify-end gap-2 px-3 py-2 border-t border-border bg-surface">
        <button type="button" className="button" onClick={handleOk}>
          OK
        </button>
        <button
          type="button"
          className="text-xs border border-border rounded-full px-2 py-1 bg-surface hover:bg-background"
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          type="button"
          className={
            isModified
              ? 'button'
              : 'text-xs border border-border rounded-full px-2 py-1 bg-surface hover:bg-background'
          }
          onClick={handleApply}
        >
          Apply
        </button>
      </div>

      {/* Resize handles — hidden while maximized since the window already fills the screen.
          Rendered last so they paint above the title/footer content and stay grabbable at the edges. */}
      {!isMaximized &&
        RESIZE_DIRECTIONS.map((direction) => (
          <div
            key={direction}
            data-testid={`global-filters-resize-${direction}`}
            className={`absolute ${resizePosition[direction]} ${resizeCursor[direction]}`}
            onMouseDown={(e) => handleResizeStart(e, direction)}
          />
        ))}
    </div>
  );
}
