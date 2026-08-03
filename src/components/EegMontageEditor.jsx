import { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import { SplitPane } from '@/components/SplitPane';
import { useTheme } from '@/components/ThemeContext';
import { TrafficLightButtons } from '@/components/TrafficLightButtons';
import {} from '@/utils/eegViewerUtils';
import { EyeDashed } from 'lucide-react';
import { cn } from '@/utils/utils';

// ─── EEG Montage settings ────────────────────────────────────────
// Shared title styling — keeps panes titles visually consistent, with the same height (TrafficLightButtons are 16px tall).
const PANEL_TITLE_CLASS = 'h-5 flex items-center text-xs font-medium leading-none text-header';

// ─── Window sizing constants ────────────────────────────────────────────────
// Default/minimum window size in px — default matches the previous fixed w-96 h-80 (24rem x 20rem)
const DEFAULT_WINDOW_SIZE = { width: 1000, height: 800 };
const MIN_WINDOW_WIDTH = 600;
const MIN_WINDOW_HEIGHT = 450;
const RESIZE_DIRECTIONS = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

export function EegMontageEditor({
  electrodes,
  matched,
  voltages,
  totalChannels,
  onClose,
  isStandardElectrodes = true,
  onElecPosFile,
  channelNames,
  voltagesByChannel,
  customFileName = null, // filename (no extension) of the loaded custom positions file — owned by PatientView, passed down
  montage,
  channelSettings, // Record<name, {type, bad}> — live state owned by EegViewer/useChannelSettings
  onApplyChannelSettings, // (Record<name, {type, bad}>) => void — commits the draft on Apply/OK
}) {
  const { isDarkMode } = useTheme();

  // Draft channelSettings — this component remounts fresh every time it's opened (EegViewer
  // conditionally renders it), so seeding draft state from the live prop here naturally
  // re-snapshots on every open with no extra reset effect needed. Row edits (and later, bulk
  // edits from the settings section below) only ever touch this draft; nothing reaches the
  // live channelSettings in EegViewer until Apply/OK explicitly commits it.
  const [draftChannelSettings, setDraftChannelSettings] = useState(() => channelSettings);

  const setDraftChannelType = useCallback((name, type) => {
    setDraftChannelSettings((prev) => ({ ...prev, [name]: { ...prev[name], type } }));
  }, []);

  const setDraftChannelBad = useCallback((name, bad) => {
    setDraftChannelSettings((prev) => ({ ...prev, [name]: { ...prev[name], bad } }));
  }, []);

  // The live channelSettings prop only ever changes via a prior Apply/OK (or the seeding
  // effect in useChannelSettings) — never by draft edits — so comparing against it directly
  // doubles as "has the draft diverged from what was last applied", no separate snapshot needed.
  const isModified = useMemo(
    () => JSON.stringify(draftChannelSettings) !== JSON.stringify(channelSettings),
    [draftChannelSettings, channelSettings]
  );

  const handleApply = useCallback(() => {
    onApplyChannelSettings(draftChannelSettings);
  }, [draftChannelSettings, onApplyChannelSettings]);

  const handleOk = useCallback(() => {
    handleApply();
    onClose();
  }, [handleApply, onClose]);

  // ─── Refs ───────────────────────────────────────────────────────────────────
  const fileInputRef = useRef(null);
  const dragOffset = useRef(null);

  // ─── State ──────────────────────────────────────────────────────────────────
  const [isMaximized, setIsMaximized] = useState(false);
  const [maximizedPanel, setMaximizedPanel] = useState(null); // null | 'left' | 'right'
  const [position, setPosition] = useState({ x: 80, y: 80 });
  const [size, setSize] = useState(DEFAULT_WINDOW_SIZE);

  // ─── Handlers: window drag/resize ──────────────────────────────────────────────
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

  // Names of channels that matched an electrode position — a Set so each row below is an
  // O(1) lookup instead of re-scanning the whole matched array per channel.
  const matchedChannelNames = useMemo(() => new Set(matched.map((m) => m.name)), [matched]);

  const channelSelectionPane = (
    <div className="h-full flex flex-col bg-surface">
      {/* Header + scrollable list — bg-background, so the padding leaves the
          surrounding bg-surface visible as a border around this section. flex-1 min-h-0
          claims all remaining height above the fixed-height settings section below. */}
      <div className="flex-1 min-h-0 flex flex-col pl-2 pt-2 bg-background">
        {/* Column headers — widths mirror each row's controls below so labels stay aligned */}
        <div className="shrink-0 flex items-center gap-2 px-1 py-0.5 text-xs font-medium text-header border-b border-border">
          <span className="flex-1">Channel</span>
          <span className="w-13 text-center" title="Electrode Position Match">
            Pos
          </span>
          <span className="w-8" title="Channel Type">
            Type
          </span>
          <span className="w-11 text-center" title="Bad channel">
            Bad
          </span>
        </div>
        <div className="flex-1 min-h-0 pb-4 overflow-y-auto border-header">
          {channelNames.map((name) => {
            const settings = draftChannelSettings[name] ?? { type: 'eeg', bad: false };
            return (
              <div
                key={name}
                style={{
                  overflow: 'visible',
                  borderBottom: `1px solid ${isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}`,
                }}
                className={cn(
                  'relative flex items-center gap-2 px-1 py-0.5',
                  settings.bad ? (isDarkMode ? 'bg-alert/10' : 'bg-alert/20') : ''
                )}
              >
                {/* Channel name */}
                <span className={cn('flex-1 truncate text-sm', settings.bad && 'text-alert')}>
                  {name}
                </span>
                {/* Electrode Position Match */}
                <div className="w-4 flex justify-center">
                  <input
                    type="checkbox"
                    className="text-xs rounded bg-surface"
                    checked={matchedChannelNames.has(name)}
                    disabled={true}
                  ></input>
                </div>
                {/* Channel Type */}
                <select
                  className="w-16 text-xs border border-border rounded bg-surface"
                  value={settings.type}
                  onChange={(e) => setDraftChannelType(name, e.target.value)}
                >
                  <option value="eeg">EEG</option>
                  <option value="seeg">SEEG</option>
                  <option value="other">Other</option>
                </select>
                {/* Bad Channel */}
                <div className="w-4 flex justify-center">
                  <input
                    type="checkbox"
                    className="accent-alert"
                    checked={settings.bad}
                    onChange={(e) => setDraftChannelBad(name, e.target.checked)}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {/* Channel Selection Settings */}
      <div className="h-36 shrink-0 border-t border-border bg-surface">
        <span>PLACEHOLDER SETTINGS</span>
      </div>
    </div>
  );

  const montageSelectionPane = <div></div>;
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
        data-testid="montage-title-bar"
        className="flex items-center justify-between px-2 py-1 border-b border-border cursor-grab select-none shrink-0 bg-surface"
        onMouseDown={handleDragStart}
      >
        <span className="text-sm font-medium text-heading">
          {isModified ? 'Montage Editor *' : 'Montage Editor'}
        </span>
        <TrafficLightButtons
          onMaximize={() => setIsMaximized((v) => !v)}
          isMaximized={isMaximized}
          onClose={onClose}
        />
      </div>

      {/* Resize handles — hidden while maximized since the window already fills the screen.
          Rendered last so they paint above the title/footer content and stay grabbable at the edges. */}
      {!isMaximized &&
        RESIZE_DIRECTIONS.map((direction) => (
          <div
            key={direction}
            data-testid={`topo-resize-${direction}`}
            className={`absolute ${resizePosition[direction]} ${resizeCursor[direction]}`}
            onMouseDown={(e) => handleResizeStart(e, direction)}
          />
        ))}
      <SplitPane
        leftLabel={<span className={PANEL_TITLE_CLASS}>Channel Selection</span>}
        rightLabel={<span className={PANEL_TITLE_CLASS}>Montage Settings</span>}
        onMaximizeChange={setMaximizedPanel}
        left={channelSelectionPane}
        right={montageSelectionPane}
      />

      {/* Footer — Apply/OK commit the draft to EegViewer's live channelSettings; Cancel (and
          the title bar's red X, via onClose) discard it by simply closing without committing. */}
      <div className="shrink-0 flex items-center justify-end gap-2 px-3 py-2 border-t border-border bg-surface">
        <button type="button" className="button" onClick={handleOk}>
          OK
        </button>
        <button
          type="button"
          className="text-xs border border-border rounded-full px-3 py-1 bg-surface hover:bg-background"
          onClick={onClose}
        >
          Cancel
        </button>
        <button type="button" className="button" onClick={handleApply}>
          Apply
        </button>
      </div>
    </div>
  );
}
