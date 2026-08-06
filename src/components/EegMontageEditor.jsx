import { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import { SplitPane } from '@/components/SplitPane';
import { useTheme } from '@/components/ThemeContext';
import { TrafficLightButtons } from '@/components/TrafficLightButtons';
import {} from '@/utils/eegViewerUtils';
import { EyeDashed } from 'lucide-react';
import { cn } from '@/utils/utils';
import { Plus, X } from 'lucide-react';

// ─── EEG Montage settings ────────────────────────────────────────
// Shared title styling — keeps panes titles visually consistent, with the same height (TrafficLightButtons are 16px tall).
const PANEL_TITLE_CLASS = 'h-5 flex items-center text-xs font-medium leading-none text-header';
const TYPE_LIST = {
  eeg: 'EEG',
  seeg: 'SEEG',
  other: 'Other',
};

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
  channelSettings, // Record<channelname, {type, bad}> — live state owned by EegViewer/useChannelSettings
  onApplyChannelSettings, // (Record<name, {type, bad}>) => void — commits the draft on Apply/OK
  montageChannels, // Array<{id, channel, reference, color}> — live state owned by EegViewer/useMontageChannels
  onApplyMontageChannels, // (Array<{id, channel, reference, color}>) => void — commits the draft on Apply/OK
}) {
  const { isDarkMode } = useTheme();
  const channelDividerColor = isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';

  // Draft channelSettings/montageChannels — this component remounts fresh every time it's
  // opened (EegViewer conditionally renders it), so seeding draft state from the live props
  // here naturally re-snapshots on every open with no extra reset effect needed. Row edits
  // only ever touch these drafts; nothing reaches the live state in EegViewer until Apply/OK
  // explicitly commits it.
  const [draftChannelSettings, setDraftChannelSettings] = useState(() => channelSettings);
  const [draftMontageChannels, setDraftMontageChannels] = useState(() => montageChannels);

  const setDraftChannelType = useCallback((name, type) => {
    setDraftChannelSettings((prev) => ({ ...prev, [name]: { ...prev[name], type } }));
  }, []);

  const setDraftChannelBad = useCallback((name, bad) => {
    setDraftChannelSettings((prev) => ({ ...prev, [name]: { ...prev[name], bad } }));
  }, []);

  // Keyed by row id, not channel name — a channel can now have several montage rows
  // (duplicates are allowed, see handleAddSelectedChannels/handleAddByType below), so
  // matching by channel name would edit every one of that channel's rows at once.
  const setDraftMontageRowReference = useCallback((id, reference) => {
    setDraftMontageChannels((prev) =>
      prev.map((row) => (row.id === id ? { ...row, reference } : row))
    );
  }, []);

  const setDraftMontageRowColor = useCallback((id, color) => {
    setDraftMontageChannels((prev) => prev.map((row) => (row.id === id ? { ...row, color } : row)));
  }, []);

  // Channels checked in the channel-selection pane, pending "+ Add selected" — purely
  // ephemeral editor UI state, not part of either draft and never committed on Apply/OK.
  const [selectedChannels, setSelectedChannels] = useState(() => new Set());
  const toggleChannelSelected = useCallback((name) => {
    setSelectedChannels((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  // Adds one new montage row per currently-selected channel, then clears the selection so
  // the next pick starts fresh. Rows aren't deduped against existing ones — a channel can
  // end up with several rows (e.g. two different bipolar derivations).
  const handleAddSelectedChannels = useCallback(() => {
    setDraftMontageChannels((prev) => [
      ...prev,
      ...channelNames
        .filter((name) => selectedChannels.has(name))
        .map((name) => ({ id: crypto.randomUUID(), channel: name, reference: null, color: null })),
    ]);
    setSelectedChannels(new Set());
  }, [channelNames, selectedChannels]);

  // Selected value for the "Add by type" control below — adds a montage row for every
  // channel currently set (in the draft) to the picked type, regardless of selection.
  const [addByType, setAddByType] = useState('eeg');
  const handleAddByType = useCallback(() => {
    setDraftMontageChannels((prev) => [
      ...prev,
      ...channelNames
        .filter((name) => (draftChannelSettings[name]?.type ?? 'eeg') === addByType)
        .map((name) => ({ id: crypto.randomUUID(), channel: name, reference: null, color: null })),
    ]);
  }, [channelNames, draftChannelSettings, addByType]);

  const handleAddAll = useCallback(() => {
    setDraftMontageChannels((prev) => [
      ...prev,
      ...channelNames.map((name) => ({
        id: crypto.randomUUID(),
        channel: name,
        reference: null,
        color: null,
      })),
    ]);
  }, [channelNames]);

  // Removes every montage row — the reverse of Add all/Add selected/Add by type.
  const handleClearAllMontageRows = useCallback(() => {
    setDraftMontageChannels([]);
  }, []);

  // Removes a single row, keyed by id since channel names can repeat across rows.
  const handleRemoveMontageRow = useCallback((id) => {
    setDraftMontageChannels((prev) => prev.filter((row) => row.id !== id));
  }, []);

  // The live channelSettings/montageChannels props only ever change via a prior Apply/OK (or
  // the seeding effects in useChannelSettings/useMontageChannels) — never by draft edits — so
  // comparing against them directly doubles as "has either draft diverged from what was last
  // applied", no separate snapshot needed.
  const isModified = useMemo(
    () =>
      JSON.stringify(draftChannelSettings) !== JSON.stringify(channelSettings) ||
      JSON.stringify(draftMontageChannels) !== JSON.stringify(montageChannels),
    [draftChannelSettings, channelSettings, draftMontageChannels, montageChannels]
  );

  const handleApply = useCallback(() => {
    onApplyChannelSettings(draftChannelSettings);
    onApplyMontageChannels(draftMontageChannels);
  }, [draftChannelSettings, onApplyChannelSettings, draftMontageChannels, onApplyMontageChannels]);

  const handleOk = useCallback(() => {
    handleApply();
    onClose();
  }, [handleApply, onClose]);

  // isAlLBad tracks if all channels are set to bad and flips the 'Check all Bad/Good' settings button accordingly
  const isAllBad = useMemo(
    () => channelNames.every((name) => draftChannelSettings[name]?.bad),
    [channelNames, draftChannelSettings]
  );
  // When 'Check all Good/Bad'button is flipped this function handles the draft settings changes
  const handleFlipBadChannels = () => {
    channelNames.forEach((name) => setDraftChannelBad(name, !isAllBad));
  };

  // Selected value for the "Set all as [type]" bulk control below
  const [bulkType, setBulkType] = useState('eeg');
  const handleSetAllType = () => {
    channelNames.forEach((name) => setDraftChannelType(name, bulkType));
  };

  // ─── Refs ───────────────────────────────────────────────────────────────────
  const fileInputRef = useRef(null);
  const dragOffset = useRef(null);

  // ─── State ──────────────────────────────────────────────────────────────────
  const [isMaximized, setIsMaximized] = useState(false);
  const [maximizedPanel, setMaximizedPanel] = useState(null); // null | 'left' | 'right'
  const [position, setPosition] = useState({ x: 100, y: 70 });
  const [size, setSize] = useState(DEFAULT_WINDOW_SIZE);
  // Whether SplitPane's two panes are currently swapped — used to flip the montage pane's
  // own internal add-row-controls/row-list layout so the controls stay on the outer edge.
  const [isPanesSwapped, setIsPanesSwapped] = useState(false);

  // ─── Handlers  ─────────────────────────────────────────────────────────────

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

  // Channel name → matched electrode label, for the Pos checkbox's hover tooltip below.
  // A Map (not a Set of names) so each row's tooltip can name which electrode it matched,
  // not just whether it matched.
  const matchedElectrodeByName = useMemo(
    () => new Map(matched.map((m) => [m.name, m.pos.label])),
    [matched]
  );

  // Shared <option> list for every montage row's Reference select — every row offers the
  // same full channel list, so this is built once per channelNames change instead of once
  // per row per render (was O(rows × channels) <option> elements every render).
  const referenceOptions = useMemo(
    () =>
      channelNames.map((refName) => (
        <option key={refName} value={refName}>
          {refName}
        </option>
      )),
    [channelNames]
  );

  // Human-readable name of the electrode position source, for the Pos tooltip text below.
  const electrodePositionSourceLabel = isStandardElectrodes
    ? 'the standard 10-05 template'
    : customFileName
      ? `"${customFileName}"`
      : 'the loaded electrode position file';

  // ─── Channel Selection Pane ──────────────────────────────────────────────────────
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
            // take channel settings from draftChannelSetting (if exist) or default (type: 'eeg', bad: false)
            const settings = draftChannelSettings[name] ?? { type: 'eeg', bad: false };
            const matchedElectrode = matchedElectrodeByName.get(name);
            const posTooltip = matchedElectrode
              ? `Matched to electrode "${matchedElectrode}" in ${electrodePositionSourceLabel}`
              : `No match for "${name}" in ${electrodePositionSourceLabel}`;
            return (
              <div
                key={name}
                style={{
                  overflow: 'visible',
                  borderBottom: `1px solid ${channelDividerColor}`,
                }}
                className={cn(
                  'relative flex items-center gap-2 px-1 py-0.5',
                  settings.bad ? (isDarkMode ? 'bg-alert/10' : 'bg-alert/20') : '',
                  selectedChannels.has(name) && (isDarkMode ? 'bg-primary/15' : 'bg-primary/20')
                )}
              >
                {/* Channel name — click to select/deselect for "+ Add selected" in the
                    montage settings pane. */}
                <span
                  className={cn(
                    'flex-1 truncate text-sm cursor-pointer select-none',
                    settings.bad && 'text-alert'
                  )}
                  data-testid={`channel-select-${name}`}
                  title="Click to select for adding to the montage"
                  onClick={() => toggleChannelSelected(name)}
                >
                  {name}
                </span>
                {/* Electrode Position Match */}
                <div className="w-4 flex justify-center">
                  <input
                    type="checkbox"
                    className="text-xs rounded accent-border opacity-60 cursor-help"
                    data-testid={`channel-pos-${name}`}
                    title={posTooltip}
                    checked={Boolean(matchedElectrode)}
                    disabled={true}
                  ></input>
                </div>
                {/* Channel Type */}
                <select
                  className="w-16 text-xs border border-border rounded bg-surface"
                  data-testid={`channel-type-${name}`}
                  value={settings.type}
                  onChange={(e) => setDraftChannelType(name, e.target.value)}
                >
                  {Object.entries(TYPE_LIST).map(([typeValue, typeLabel]) => (
                    <option key={typeValue} value={typeValue}>
                      {typeLabel}
                    </option>
                  ))}
                </select>
                {/* Bad Channel */}
                <div className="w-4 flex justify-center">
                  <input
                    type="checkbox"
                    className="accent-alert"
                    data-testid={`channel-bad-${name}`}
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
      <div className="h-36 shrink-0 flex flex-col items-start gap-2 p-2 border-t border-border bg-surface">
        <button className="button" onClick={() => handleFlipBadChannels()}>
          {isAllBad ? 'Check all Good' : 'Check all Bad'}
        </button>
        <div className="flex items-center gap-2">
          <button className="button" onClick={handleSetAllType}>
            Set all as
          </button>
          <select
            className="text-xs border border-border rounded bg-surface"
            data-testid="bulk-type-select"
            value={bulkType}
            onChange={(e) => setBulkType(e.target.value)}
          >
            {Object.entries(TYPE_LIST).map(([typeValue, typeLabel]) => (
              <option key={typeValue} value={typeValue}>
                {typeLabel}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
  // ─── Montage Selection Pane ──────────────────────────────────────────────────────
  // Two sections: a narrow column to build rows (from the channel-selection pane's
  // selection, or by type), and the row list itself. Montage rows are never auto-seeded
  // (see useMontageChannels), so this is the only way rows get created.
  //
  // Kept as its own const (rather than inlined in montageSelectionPane below) so it can be
  // positioned on either side via the order classes applied where it's rendered — when
  // SplitPane's panes are swapped, this column flips to the opposite side so it stays on
  // the window's outer edge instead of jumping next to the divider.
  const addRowControls = (
    <div
      className={cn(
        'w-25 h-full items-center justify-center flex flex-col gap-6 p-2 bg-surface',
        isPanesSwapped ? 'order-2 border-l border-border' : 'order-1 border-r border-border'
      )}
    >
      {/* Add button */}
      <button
        type="button"
        className="button button-icon"
        data-testid="add-selected-button"
        disabled={selectedChannels.size === 0}
        onClick={handleAddSelectedChannels}
        title={
          selectedChannels.size === 0
            ? 'Add selected channels to Montage (first select channel(s) on the left!)'
            : 'Add selected channels to Montage'
        }
      >
        <Plus size={40} />
      </button>
      {/* Add ALL button */}
      <div className="flex flex-col gap-2 pt-6 border-t border-border">
        <button
          type="button"
          className="button"
          data-testid="add-all-button"
          onClick={handleAddAll}
          title="Add all channels"
        >
          Add ALL
        </button>
      </div>
      {/* Add bye type button + select */}
      <div className="flex flex-col gap-2 pt-6 border-t border-border">
        <button
          type="button"
          className="button"
          data-testid="add-by-type-button"
          onClick={handleAddByType}
          title="Add all channels with the selected type below"
        >
          Add by Type
        </button>

        <select
          className="text-xs border border-border rounded bg-surface"
          data-testid="add-by-type-select"
          value={addByType}
          onChange={(e) => setAddByType(e.target.value)}
          title="Channels with selected type can be added using the 'Add by type' button"
        >
          {Object.entries(TYPE_LIST).map(([typeValue, typeLabel]) => (
            <option key={typeValue} value={typeValue}>
              {typeLabel}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
  const montageSelectionPane = (
    <div className="h-full flex bg-surface">
      {addRowControls}
      {/* Header + scrollable row list — bg-background, so the padding leaves the
          surrounding bg-surface visible as a border around this section. */}
      <div
        className={cn(
          'flex-1 min-w-0 min-h-0 flex flex-col pt-2 bg-background',
          isPanesSwapped ? 'order-1' : 'order-2'
        )}
      >
        {/* Column headers — widths mirror each row's controls below so labels stay aligned */}
        <div className="shrink-0 flex items-center gap-2 pl-3 pr-1 py-0.5 text-xs font-medium text-header border-b border-border">
          <span className="flex-1">Channel</span>
          <span className="w-23 text-center" title="Reference Channel">
            Ref
          </span>
          <span className="w-20" title="Channel Type">
            Color
          </span>
        </div>
        <div className="flex-1 min-h-0 pb-4 overflow-y-auto border-header">
          {draftMontageChannels.length === 0 && (
            <p className="text-xs text-header pl-3 pr-1 py-2">
              No montage rows yet — select channel(s) in the Channel Selection pane and click "+ Add
              selected", or add every channel of a type at once on the left.
            </p>
          )}
          {draftMontageChannels.map((row) => {
            // A row is "bad" if either its source channel or its reference channel (for
            // bipolar rows) is marked bad — either one means the row can't be displayed.
            // Tracked separately so the channel name and reference select can each be
            // flagged individually, instead of both turning text-alert whenever either is bad.
            const isChannelBad = draftChannelSettings[row.channel]?.bad;
            const isReferenceBad = row.reference && draftChannelSettings[row.reference]?.bad;
            const isRowBad = isChannelBad || isReferenceBad;
            return (
              <div
                key={row.id}
                style={{
                  overflow: 'visible',
                  borderBottom: `1px solid ${channelDividerColor}`,
                  // The row's selected color tints its background, but is overwrited by bg-alert when
                  // the channel is bad (applied via className, not inline style, which always wins)
                  // color-mix keeps this a subtle tint rather than the fully-saturated color used in uPlot
                  ...(!isRowBad && row.color
                    ? {
                        backgroundColor: `color-mix(in srgb, ${row.color} ${isDarkMode ? 30 : 40}%, transparent)`,
                      }
                    : {}),
                }}
                className={cn(
                  'relative flex items-center gap-2 pl-3 pr-1 py-0.5',
                  isRowBad ? (isDarkMode ? 'bg-alert/20' : 'bg-alert/30') : ''
                )}
              >
                {/* Channel name */}
                <span
                  className={cn('flex-1 truncate text-sm', isChannelBad && 'text-alert')}
                  data-testid={`montage-channel-${row.id}`}
                >
                  {row.channel}
                </span>
                {/* Reference Channel */}
                <select
                  className={cn(
                    'w-16 text-xs border border-border rounded bg-surface',
                    isReferenceBad && 'text-alert'
                  )}
                  data-testid={`reference-${row.id}`}
                  value={row.reference ?? ''}
                  onChange={(e) => setDraftMontageRowReference(row.id, e.target.value)}
                >
                  <option value="">— n/a —</option>
                  {referenceOptions}
                </select>
                {/* Channel Color — "Default" (color: null) follows the theme (white in
                    dark mode, black in light mode) wherever it's actually plotted; this
                    editor doesn't need to know which, so the option's value/label stay
                    theme-independent unlike the old scheme where "Default" was literally
                    stored as 'white' or 'black'. */}
                <select
                  className="w-16 text-xs border border-border rounded bg-surface"
                  data-testid={`color-${row.id}`}
                  value={row.color ?? ''}
                  onChange={(e) => setDraftMontageRowColor(row.id, e.target.value || null)}
                >
                  <option value="">Default</option>
                  <option value="red">Red</option>
                  <option value="blue">Blue</option>
                  <option value="green">Green</option>
                  <option value="yellow">Yellow</option>
                  <option value="cyan">Cyan</option>
                  <option value="magenta">Magenta</option>
                </select>
                {/* Remove row */}
                <button
                  type="button"
                  className="text-header hover:text-alert"
                  data-testid={`remove-row-${row.id}`}
                  title={`Remove ${row.channel} from the montage`}
                  onClick={() => handleRemoveMontageRow(row.id)}
                >
                  <X size={14} />
                </button>
              </div>
            );
          })}
        </div>
        {/* Montage Settings */}
        <div className="h-36 shrink-0 flex flex-col items-start gap-2 p-2 border-t border-border bg-surface">
          <button
            type="button"
            className="button"
            data-testid="clear-all-button"
            disabled={draftMontageChannels.length === 0}
            onClick={handleClearAllMontageRows}
            title="Remove all montage rows"
          >
            Clear all
          </button>
        </div>
      </div>
    </div>
  );

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
            data-testid={`montage-resize-${direction}`}
            className={`absolute ${resizePosition[direction]} ${resizeCursor[direction]}`}
            onMouseDown={(e) => handleResizeStart(e, direction)}
          />
        ))}
      <SplitPane
        leftLabel={<span className={PANEL_TITLE_CLASS}>Channel Selection</span>}
        rightLabel={<span className={PANEL_TITLE_CLASS}>Montage Settings</span>}
        onMaximizeChange={setMaximizedPanel}
        onSwapChange={setIsPanesSwapped}
        left={channelSelectionPane}
        right={montageSelectionPane}
        defaultSplitPercent={30}
      />

      {/* Footer — Apply/OK commit the draft to EegViewer's live channelSettings; Cancel (and
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
    </div>
  );
}
