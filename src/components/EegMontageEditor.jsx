import { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import { SplitPane } from '@/components/SplitPane';
import { useTheme } from '@/components/ThemeContext';
import { TrafficLightButtons } from '@/components/TrafficLightButtons';
import {} from '@/utils/eegViewerUtils';
import { parseMontageFile } from '@/loaders/parseMontageFile';
import { toAnyWaveMontage } from '@/loaders/toAnyWaveMontage';
import { downloadTextFile } from '@/utils/fileDownload';
import { EyeDashed } from 'lucide-react';
import { cn } from '@/utils/utils';
import {
  Plus,
  X,
  MoveUp,
  MoveDown,
  ArrowUpAZ,
  ArrowDownAZ,
  ArrowUpWideNarrow,
  ArrowDownWideNarrow,
} from 'lucide-react';

// ─── EEG Montage settings ────────────────────────────────────────
// Shared title styling — keeps panes titles visually consistent, with the same height (TrafficLightButtons are 16px tall).
const PANEL_TITLE_CLASS = 'h-5 flex items-center text-xs font-medium leading-none text-header';
// Shared Channel column sizing for both row lists' header and rows — flex-1 so it fills
// leftover width, min-w so it stops shrinking there and the other columns scroll instead.
const CHANNEL_COL_CLASS = 'flex-1 min-w-8';
const TYPE_LIST = {
  eeg: 'EEG',
  seeg: 'SEEG',
  other: 'Other',
};
// Canonical grouping order for Sort by Type — clinical convention (eeg, then seeg, then
// other), not alphabetical (which would separate seeg from eeg).
const TYPE_ORDER = Object.keys(TYPE_LIST);
// Preset options offered by each row's Color <select>. A loaded montage file (AnyWave) can
// carry any CSS color keyword, not just these — see the color <select> below, which injects
// an extra option for a row's current color when it isn't one of these presets.
const PRESET_COLORS = ['red', 'blue', 'green', 'yellow', 'cyan', 'magenta'];

// ─── Window sizing constants ────────────────────────────────────────────────
// Default/minimum window size in px — default matches the previous fixed w-96 h-80 (24rem x 20rem)
const DEFAULT_WINDOW_SIZE = { width: 870, height: 700 };
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
  // Clears the channel selection when empty space in the channel-selection pane is clicked
  // (the list background, its header, or the settings card below). The target check means a
  // click that started on a channel row/control and bubbled up doesn't undo its own handler.
  const handleChannelPaneBackgroundClick = useCallback((e) => {
    if (e.target === e.currentTarget) setSelectedChannels(new Set());
  }, []);

  // Builds a fresh montage row for `name` — shared by the three "add row(s)" actions below
  // plus Load. No `type` field: a row's type is always looked up live from
  // draftChannelSettings[row.channel] at render time, so it stays in sync with later edits.
  // `overrides` lets Load seed reference/color from a parsed file; every other caller omits
  // it (or, via .map(makeMontageRow), passes the ignored numeric index), so the `??`
  // fallbacks apply unchanged.
  const makeMontageRow = useCallback(
    (name, overrides = {}) => ({
      id: crypto.randomUUID(),
      channel: name,
      reference: overrides.reference ?? null,
      color: overrides.color ?? null,
    }),
    []
  );

  // Adds one new montage row per currently-selected channel, then clears the selection so
  // the next pick starts fresh. Rows aren't deduped against existing ones — a channel can
  // end up with several rows (e.g. two different bipolar derivations).
  const handleAddSelectedChannels = useCallback(() => {
    setDraftMontageChannels((prev) => [
      ...prev,
      ...channelNames.filter((name) => selectedChannels.has(name)).map(makeMontageRow),
    ]);
    setSelectedChannels(new Set());
  }, [channelNames, selectedChannels, makeMontageRow]);

  // Selected value for the "Add by type" control below — adds a montage row for every
  // channel currently set (in the draft) to the picked type, regardless of selection.
  const [addByType, setAddByType] = useState('eeg');
  const handleAddByType = useCallback(() => {
    setDraftMontageChannels((prev) => [
      ...prev,
      ...channelNames
        .filter((name) => (draftChannelSettings[name]?.type ?? 'eeg') === addByType)
        .map(makeMontageRow),
    ]);
  }, [channelNames, draftChannelSettings, addByType, makeMontageRow]);

  const handleAddAll = useCallback(() => {
    setDraftMontageChannels((prev) => [...prev, ...channelNames.map(makeMontageRow)]);
  }, [channelNames, makeMontageRow]);

  // Rows checked for Move Up/Down below, keyed by row id (not channel name, so two rows
  // sharing a channel select independently). Declared before handleClearAllMontageRows/
  // handleRemoveMontageRow below since they reference its setter — React Compiler couldn't
  // preserve those handlers' memoization with a forward reference.
  const [selectedMontageRows, setSelectedMontageRows] = useState(() => new Set());
  const toggleMontageRowSelected = useCallback((id) => {
    setSelectedMontageRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  // Anywhere on a row toggles its selection, so the whole row is one big target rather
  // than just the channel name. Clicks landing on the row's own controls are ignored —
  // those have their own jobs (edit the reference/color, remove the row) and shouldn't
  // also flip selection as a side effect.
  const handleMontageRowClick = useCallback(
    (e, id) => {
      if (e.target.closest('button, input, select, textarea')) return;
      toggleMontageRowSelected(id);
    },
    [toggleMontageRowSelected]
  );
  // Clears the montage row selection when empty space in the montage pane is clicked (the
  // row list background, its header, the settings row below, or the add-row controls
  // column). The target check means a click that started on a row/control and bubbled up
  // doesn't undo that row's own click-to-select handler.
  const handleMontagePaneBackgroundClick = useCallback((e) => {
    if (e.target === e.currentTarget) setSelectedMontageRows(new Set());
  }, []);

  // Removes every montage row — the reverse of Add all/Add selected/Add by type.
  const handleClearAllMontageRows = useCallback(() => {
    setDraftMontageChannels([]);
    setSelectedMontageRows(new Set());
  }, []);

  // Removes a single row, keyed by id since channel names can repeat across rows.
  const handleRemoveMontageRow = useCallback((id) => {
    setDraftMontageChannels((prev) => prev.filter((row) => row.id !== id));
    setSelectedMontageRows((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  // Moves every selected row up one slot. Scanning left-to-right and swapping a selected
  // row with its predecessor only when that predecessor isn't also selected handles several
  // separately-selected rows in one pass without them fighting each other.
  const handleMoveSelectedUp = useCallback(() => {
    setDraftMontageChannels((prev) => {
      const next = [...prev];
      for (let i = 1; i < next.length; i++) {
        if (selectedMontageRows.has(next[i].id) && !selectedMontageRows.has(next[i - 1].id)) {
          [next[i - 1], next[i]] = [next[i], next[i - 1]];
        }
      }
      return next;
    });
  }, [selectedMontageRows]);

  // Mirror of handleMoveSelectedUp, scanning right-to-left.
  const handleMoveSelectedDown = useCallback(() => {
    setDraftMontageChannels((prev) => {
      const next = [...prev];
      for (let i = next.length - 2; i >= 0; i--) {
        if (selectedMontageRows.has(next[i].id) && !selectedMontageRows.has(next[i + 1].id)) {
          [next[i], next[i + 1]] = [next[i + 1], next[i]];
        }
      }
      return next;
    });
  }, [selectedMontageRows]);

  // Sorts by channel name, flipping ascending/descending on each click.
  const [nameSortDescending, setNameSortDescending] = useState(false);
  const handleSortByName = useCallback(() => {
    setDraftMontageChannels((prev) =>
      [...prev].sort((a, b) =>
        nameSortDescending ? b.channel.localeCompare(a.channel) : a.channel.localeCompare(b.channel)
      )
    );
    setNameSortDescending((prev) => !prev);
  }, [nameSortDescending]);

  // Sorts by type (TYPE_ORDER: eeg, seeg, other), then name within each group, also
  // flipping direction on each click. Reads type live from draftChannelSettings, same as
  // the Channel Type column (see channelType below) — a row has no type field of its own.
  const [typeSortDescending, setTypeSortDescending] = useState(false);
  const handleSortByType = useCallback(() => {
    setDraftMontageChannels((prev) =>
      [...prev].sort((a, b) => {
        const typeA = draftChannelSettings[a.channel]?.type ?? 'eeg';
        const typeB = draftChannelSettings[b.channel]?.type ?? 'eeg';
        const typeOrderDiff = TYPE_ORDER.indexOf(typeA) - TYPE_ORDER.indexOf(typeB);
        const diff = typeOrderDiff !== 0 ? typeOrderDiff : a.channel.localeCompare(b.channel);
        return typeSortDescending ? -diff : diff;
      })
    );
    setTypeSortDescending((prev) => !prev);
  }, [typeSortDescending, draftChannelSettings]);

  // Loads a montage file (AnyWave XML or Cartool text) and replaces the draft montage rows
  // wholesale, same as Add ALL/Clear all.
  const handleLoadMontageFile = useCallback(
    async (e) => {
      const file = e.target.files?.[0];
      e.target.value = ''; // reset so the same file can be re-selected
      if (!file) return;

      try {
        const { rows, channelTypes } = await parseMontageFile(file);
        setDraftMontageChannels(
          rows.map((row) =>
            makeMontageRow(row.channel, { reference: row.reference, color: row.color })
          )
        );
        // AnyWave files carry a per-channel type alongside each row; patch those into the
        // channel-selection draft too. Cartool files have no type info, so channelTypes is
        // {} for them and this loop is a no-op, leaving existing types untouched.
        setDraftChannelSettings((prev) => {
          const next = { ...prev };
          for (const [name, type] of Object.entries(channelTypes)) {
            next[name] = { ...next[name], type };
          }
          return next;
        });
      } catch (err) {
        // Parse failure (unrecognized/invalid content): surface it and leave the draft as
        // it was — returning here means neither setDraft* call above ever runs, so there's
        // nothing to roll back.
        toast.error(`Error loading montage file:\n${err.message}`);
      }
    },
    [makeMontageRow]
  );

  // Exports the current draft as AnyWave XML, regardless of whether it was built by hand
  // or loaded from either supported file format — Save always emits this one format.
  const handleSaveMontage = useCallback(() => {
    const xml = toAnyWaveMontage(draftMontageChannels, draftChannelSettings);
    downloadTextFile(xml, 'montage.mtg', 'text/xml');
  }, [draftMontageChannels, draftChannelSettings]);

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

  // Same bad/missing checks the row list uses for its own styling (see isChannelBad etc. in
  // montageSelectionPane below) — reused here to warn before committing a montage that can't
  // actually be displayed correctly.
  const getRowIssues = useCallback(
    (row) => {
      const issues = [];
      const isChannelMissing = !channelNames.includes(row.channel);
      if (isChannelMissing) issues.push(`'${row.channel}' is not a channel in this recording`);
      else if (draftChannelSettings[row.channel]?.bad)
        issues.push(`'${row.channel}' is marked as a bad channel`);
      const isReferenceMissing =
        Boolean(row.reference) &&
        row.reference !== 'average' &&
        row.reference !== 'median' &&
        !channelNames.includes(row.reference);
      if (isReferenceMissing)
        issues.push(`its reference '${row.reference}' is not a channel in this recording`);
      else if (row.reference && draftChannelSettings[row.reference]?.bad)
        issues.push(`its reference '${row.reference}' is marked as a bad channel`);
      return issues;
    },
    [channelNames, draftChannelSettings]
  );

  // Apply/OK confirms with the user before committing a draft where a row's channel or
  // reference is bad or missing — those rows can't be displayed correctly, but the user may
  // still want to proceed (e.g. a known-noisy channel they'll exclude from display later).
  const okToApply = useCallback(() => {
    const problems = draftMontageChannels
      .map((row) => ({ row, issues: getRowIssues(row) }))
      .filter(({ issues }) => issues.length > 0);
    if (problems.length === 0) return true;
    const summary = problems
      .map(({ row, issues }) => `- ${row.channel}: ${issues.join(', ')}`)
      .join('\n');
    return window.confirm(
      `${problems.length} montage ${problems.length > 1 ? 'rows have' : 'row has'} a bad or missing channel/reference:\n\n${summary}\n\nApply anyway?`
    );
  }, [draftMontageChannels, getRowIssues]);

  const handleApply = useCallback(() => {
    if (!okToApply()) return false;
    onApplyChannelSettings(draftChannelSettings);
    onApplyMontageChannels(draftMontageChannels);
    return true;
  }, [
    okToApply,
    draftChannelSettings,
    onApplyChannelSettings,
    draftMontageChannels,
    onApplyMontageChannels,
  ]);

  const handleOk = useCallback(() => {
    if (handleApply()) onClose();
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

  const [bulkReference, setBulkReference] = useState('');
  const handleSetAllReference = () => {
    draftMontageChannels.forEach((row) => setDraftMontageRowReference(row.id, bulkReference));
  };

  const [bulkColor, setBulkColor] = useState('');
  const handleSetAllColor = () => {
    draftMontageChannels.forEach((row) => setDraftMontageRowColor(row.id, bulkColor || null));
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
  // same full n/a, average, med channel list, so this is built once per channelNames/bad-status
  // change instead of once per row per render (was O(rows × channels) <option> elements every
  // render). Each bad channel's own <option> is tinted text-alert directly — coloring lived on
  // the <select> itself, which cascaded that color onto every option in the dropdown, not just
  // the bad one.
  const referenceOptions = useMemo(
    () => [
      <option key="none" value="">
        — n/a —
      </option>,
      <option key="average" value="average">
        Average
      </option>,
      <option key="median" value="median">
        Median
      </option>,
      ...channelNames.map((refName) => (
        <option
          key={refName}
          value={refName}
          className={draftChannelSettings[refName]?.bad ? 'text-alert' : undefined}
        >
          {refName}
        </option>
      )),
    ],
    [channelNames, draftChannelSettings]
  );

  // Shared <option> list for the bulk "Set all Colors" select — the per-row Color select
  // below builds its own list so it can also inject the row's current non-preset color.
  // Each option's text is tinted to match the color it applies, so the picked shade is
  // visible before the row is committed.
  const colorOptions = PRESET_COLORS.map((color) => (
    <option key={color} value={color} style={{ color }}>
      {color[0].toUpperCase() + color.slice(1)}
    </option>
  ));

  // Human-readable name of the electrode position source, for the Pos tooltip text below.
  const electrodePositionSourceLabel = isStandardElectrodes
    ? 'the fsaverage_1005 (FreeSurfer) template'
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
        {/* Header + rows share one horizontal-scroll wrapper (w-max/min-w-full inner) so
            Channel stays a fixed width and visible, while Pos/Type/Bad scroll out of view
            together instead of squeezing when the pane is narrow. */}
        <div className="flex-1 min-h-0 overflow-x-auto">
          <div className="h-full flex flex-col w-max min-w-full">
            {/* Column headers — widths mirror each row's controls below so labels stay aligned */}
            <div
              className="shrink-0 flex items-center gap-2 px-1 py-0.5 text-xs font-medium text-header border-b border-border"
              onClick={handleChannelPaneBackgroundClick}
            >
              <span className={CHANNEL_COL_CLASS}>Channel</span>
              <span className="w-13 shrink-0 text-center" title="Electrode Position Match">
                Pos
              </span>
              <span className="w-8 shrink-0" title="Channel Type">
                Type
              </span>
              <span className="w-11 shrink-0 text-center" title="Bad channel">
                Bad
              </span>
            </div>
            <div
              className="flex-1 min-h-0 pb-4 overflow-y-auto border-header"
              data-testid="channel-list"
              onClick={handleChannelPaneBackgroundClick}
            >
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
                        CHANNEL_COL_CLASS,
                        'truncate text-sm cursor-pointer select-none',
                        settings.bad && 'text-alert'
                      )}
                      data-testid={`channel-select-${name}`}
                      title="Click to select for adding to the montage"
                      onClick={() => toggleChannelSelected(name)}
                    >
                      {name}
                    </span>
                    {/* Electrode Position Match */}
                    <div className="w-4 shrink-0 flex justify-center">
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
                      className="w-16 shrink-0 text-xs border border-border rounded bg-surface"
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
                    <div className="w-4 shrink-0 flex justify-center">
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
        </div>
      </div>
      {/* Channel Selection Settings */}
      <div
        className="h-32 shrink-0 flex flex-col items-start gap-2 p-2 border-t border-border bg-surface"
        onClick={handleChannelPaneBackgroundClick}
      >
        <button className="button" onClick={() => handleFlipBadChannels()}>
          {isAllBad ? 'Set all Good' : 'Set all Bad'}
        </button>
        <div className="flex items-center gap-2">
          <button
            className="button"
            data-testid="bulk-type-apply-button"
            onClick={handleSetAllType}
          >
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
      onClick={handleMontagePaneBackgroundClick}
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
        {/* Header + rows share one horizontal-scroll wrapper (w-max/min-w-full inner) so
            Channel stays a fixed width and visible, while Type/Ref/Color scroll out of view
            together instead of squeezing when the pane is narrow. */}
        <div className="flex-1 min-h-0 overflow-x-auto">
          <div className="h-full flex flex-col w-max min-w-full">
            {/* Column headers — widths mirror each row's controls below so labels stay aligned */}
            <div
              className="shrink-0 flex items-center gap-2 pl-3 pr-1 py-0.5 text-xs font-medium text-header border-b border-border"
              onClick={handleMontagePaneBackgroundClick}
            >
              <span className={CHANNEL_COL_CLASS} title="Montage Channel">
                Channel
              </span>
              <span className="w-17 shrink-0 text-center" title="Channel Type">
                Type
              </span>
              <span className="w-23 shrink-0 text-center" title="Reference Channel">
                Ref
              </span>
              <span className="w-20 shrink-0" title="Montage Channel Color">
                Color
              </span>
            </div>
            <div
              className="flex-1 min-h-0 pb-4 overflow-y-auto border-header"
              data-testid="montage-row-list"
              onClick={handleMontagePaneBackgroundClick}
            >
              {draftMontageChannels.length === 0 && (
                <p className="max-w-sm text-xs text-header pl-3 pr-1 py-2">
                  {`No montage rows yet — select channel(s) in the Channel Selection pane (${isPanesSwapped ? 'right' : 'left'})
              and use the + / Add buttons to add them to the montage row list (${isPanesSwapped ? 'left' : 'right'}).`}
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
                // "Missing" (channel/reference not in this recording, only possible via a
                // loaded file) is unfixable when it's the row's own channel — nothing about
                // the row can be edited to recover it, so it's greyed out and its Reference/
                // Color controls disabled (Remove still works). A missing reference alone
                // (channel is fine) stays interactive, since picking a different reference from
                // the select is literally the fix.
                const isChannelMissing = !channelNames.includes(row.channel);
                const isReferenceMissing =
                  Boolean(row.reference) &&
                  row.reference !== 'average' &&
                  row.reference !== 'median' &&
                  !channelNames.includes(row.reference);
                const channelType = isChannelMissing
                  ? null
                  : (draftChannelSettings[row.channel]?.type ?? 'eeg');
                return (
                  <div
                    key={row.id}
                    style={{
                      overflow: 'visible',
                      borderBottom: `1px solid ${channelDividerColor}`,
                      // The row's selected color tints its background, but is overwrited by bg-alert when
                      // the channel is bad (applied via className, not inline style, which always wins)
                      // color-mix keeps this a subtle tint rather than the fully-saturated color used in uPlot
                      ...(!isRowBad && !isChannelMissing && row.color
                        ? {
                            backgroundColor: `color-mix(in srgb, ${row.color} ${isDarkMode ? 30 : 40}%, transparent)`,
                          }
                        : {}),
                    }}
                    className={cn(
                      'relative flex items-center gap-2 pl-3 pr-1 py-0.5 cursor-pointer select-none',
                      isRowBad && (isDarkMode ? 'bg-alert/20' : 'bg-alert/30'),
                      isChannelMissing && 'opacity-50',
                      // A ring (not a background) marks the row selected for Move Up/Down —
                      // background is already spoken for by the bad/color tints above, and an
                      // inline style (row.color) would win over a background className anyway.
                      selectedMontageRows.has(row.id) && 'ring-2 ring-inset ring-primary'
                    )}
                    title="Click row to select for Move Up/Down"
                    onClick={(e) => handleMontageRowClick(e, row.id)}
                  >
                    {/* Channel name */}
                    <span
                      className={cn(
                        CHANNEL_COL_CLASS,
                        'truncate text-sm',
                        isChannelBad && 'text-alert',
                        isChannelMissing && 'text-red-500'
                      )}
                      title={
                        isChannelMissing
                          ? 'Channel not found in this recording'
                          : isChannelBad
                            ? 'Channel marked as bad'
                            : undefined
                      }
                      data-testid={`montage-channel-${row.id}`}
                    >
                      {row.channel}
                    </span>
                    {/* Channel Type — looked up live from draftChannelSettings (see channelType
                        above), so it tracks edits made afterward in the channel-selection pane
                        rather than freezing whatever the type was when the row was added. A
                        missing channel has no draftChannelSettings entry to read a type from. */}
                    <span
                      className="w-23 shrink-0 text-center truncate text-sm"
                      data-testid={`montage-type-${row.id}`}
                    >
                      {channelType ? TYPE_LIST[channelType] : '—'}
                    </span>
                    {/* Reference Channel — 
                        Disabled when the row's own channel name is missing (see isChannelMissing above).
                        When a channel is referenced that isn't in the current recording (only reachable
                        via a loaded montage file), gets its own injected option so it can display this 
                        this channel as missing (instead of falling back to blank "— n/a —"). a missing 
                        reference alone is fixable by picking another one. 
                        Bad/missing coloring lives on the individual <option> elements below (not
                        this <select>'s own className) — a color class here would cascade onto
                        every option in the dropdown instead of just the one that's actually bad
                        or missing. */}
                    <select
                      className="w-16 shrink-0 text-xs border border-border rounded bg-surface cursor-default"
                      title={
                        isReferenceMissing
                          ? 'Reference channel not found in this recording'
                          : isReferenceBad
                            ? 'Reference channel marked bad'
                            : undefined
                      }
                      data-testid={`reference-${row.id}`}
                      value={row.reference ?? ''}
                      disabled={isChannelMissing}
                      onChange={(e) => setDraftMontageRowReference(row.id, e.target.value)}
                    >
                      {isReferenceMissing && (
                        <option value={row.reference} className="text-red-500">
                          {row.reference} (missing)
                        </option>
                      )}
                      {referenceOptions}
                    </select>
                    {/* Channel Color — "Default" (color: null) follows the theme (white in
                        dark mode, black in light mode) wherever it's actually plotted; this
                        editor doesn't need to know which, so the option's value/label stay
                        theme-independent unlike the old scheme where "Default" was literally
                        stored as 'white' or 'black'. */}
                    <select
                      className="w-16 shrink-0 text-xs border border-border rounded bg-surface cursor-default"
                      data-testid={`color-${row.id}`}
                      value={row.color ?? ''}
                      disabled={isChannelMissing}
                      onChange={(e) => setDraftMontageRowColor(row.id, e.target.value || null)}
                    >
                      <option value="">Default</option>
                      {/* A loaded file (AnyWave) can carry any CSS color keyword, not just the
                          presets below — inject it as an extra option so the select shows the
                          row's actual color instead of falling back to blank/unselected. */}
                      {row.color && !PRESET_COLORS.includes(row.color) && (
                        <option value={row.color} style={{ color: row.color }}>
                          {row.color[0].toUpperCase() + row.color.slice(1)}
                        </option>
                      )}
                      {colorOptions}
                    </select>
                    {/* Remove row */}
                    <button
                      type="button"
                      className="shrink-0 text-header hover:text-alert cursor-pointer"
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
          </div>
        </div>
        {/* Montage Settings — a row of three column groups (Clear/Sort/Move), each stacking
            its own buttons; the Move group is pushed to the right edge (ml-auto) since it
            acts on row selection rather than the list as a whole, like Clear/Sort do. A
            second row below holds Load/Save side by side. */}
        <div
          className="shrink-0 flex flex-col p-2 border-t border-border bg-surface"
          onClick={handleMontagePaneBackgroundClick}
        >
          {/* Scrolls horizontally as one unit when the pane is too narrow, so a single
              scrollbar sits below Load/Save instead of one wedged between the two rows. */}
          <div className="overflow-x-auto">
            <div className="flex flex-col gap-4 pb-2 w-max min-w-full">
              <div className="flex items-start gap-4">
                {/* Clear group */}
                <div className="flex flex-col gap-2 shrink-0">
                  <button
                    type="button"
                    className="button whitespace-nowrap"
                    data-testid="clear-all-button"
                    disabled={draftMontageChannels.length === 0}
                    onClick={handleClearAllMontageRows}
                    title="Remove all montage rows"
                  >
                    Clear all
                  </button>
                </div>
                {/* Sort group — the arrow shows the direction the next click will sort in. */}
                <div className="flex flex-col gap-2 shrink-0">
                  <button
                    type="button"
                    className="button flex items-center gap-1 whitespace-nowrap"
                    data-testid="sort-by-name-button"
                    disabled={draftMontageChannels.length === 0}
                    onClick={handleSortByName}
                    title={`Sort rows by channel name (${nameSortDescending ? 'descending' : 'ascending'})`}
                  >
                    Sort by Name
                    {nameSortDescending ? <ArrowDownAZ size={15} /> : <ArrowUpAZ size={15} />}
                  </button>
                  <button
                    type="button"
                    className="button flex items-center gap-1 whitespace-nowrap"
                    data-testid="sort-by-type-button"
                    disabled={draftMontageChannels.length === 0}
                    onClick={handleSortByType}
                    title={`Sort rows by channel type (${typeSortDescending ? 'descending' : 'ascending'})`}
                  >
                    Sort by Type
                    {typeSortDescending ? (
                      <ArrowDownWideNarrow size={15} />
                    ) : (
                      <ArrowUpWideNarrow size={15} />
                    )}
                  </button>
                </div>
                {/* Set all Ref group */}
                <div className="flex flex-col gap-2 shrink-0">
                  <button
                    className="button whitespace-nowrap"
                    data-testid="bulk-reference-apply-button"
                    disabled={draftMontageChannels.length === 0}
                    onClick={handleSetAllReference}
                  >
                    Set all as
                  </button>
                  <select
                    className="text-xs border border-border rounded bg-surface"
                    data-testid="bulk-reference-select"
                    disabled={draftMontageChannels.length === 0}
                    value={bulkReference}
                    onChange={(e) => setBulkReference(e.target.value)}
                  >
                    {referenceOptions}
                  </select>
                </div>

                {/* Set all Color group */}
                <div className="flex flex-col gap-2 shrink-0">
                  <button
                    className="button whitespace-nowrap"
                    data-testid="bulk-color-apply-button"
                    disabled={draftMontageChannels.length === 0}
                    onClick={handleSetAllColor}
                  >
                    Set all as
                  </button>
                  <select
                    className="text-xs border border-border rounded bg-surface"
                    data-testid="bulk-color-select"
                    disabled={draftMontageChannels.length === 0}
                    value={bulkColor}
                    onChange={(e) => setBulkColor(e.target.value)}
                  >
                    <option value="">Default</option>
                    {colorOptions}
                  </select>
                </div>

                {/* Move group — acts on whichever row(s) are selected (click a row's channel
                    name above to select it); disabled with none selected since there's nothing
                    to move. overflow-hidden + p-1 clips the buttons' :hover scale so it can't
                    escape into the scrollable toolbar's width and flicker the scrollbar. */}
                <div className="flex flex-col gap-2 shrink-0 ml-auto overflow-hidden p-1">
                  <button
                    type="button"
                    className="button button-icon"
                    data-testid="move-up-button"
                    disabled={selectedMontageRows.size === 0}
                    onClick={handleMoveSelectedUp}
                    title={
                      selectedMontageRows.size === 0
                        ? 'Select montage row(s) first'
                        : 'Move selected row(s) up'
                    }
                  >
                    <MoveUp size={20} />
                  </button>
                  <button
                    type="button"
                    className="button button-icon"
                    data-testid="move-down-button"
                    disabled={selectedMontageRows.size === 0}
                    onClick={handleMoveSelectedDown}
                    title={
                      selectedMontageRows.size === 0
                        ? 'Select montage row(s) first'
                        : 'Move selected row(s) down'
                    }
                  >
                    <MoveDown size={20} />
                  </button>
                </div>
              </div>
              {/* File row — Load replaces all draft rows wholesale (grouped conceptually with
                  Clear, both whole-list-replacing); Save always exports AnyWave format
                  regardless of the montage's origin. Both .mtg formats share the same file
                  extension, so format detection happens by content-sniffing in
                  parseMontageFile, not via the file input's accept filter. */}
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  className="button whitespace-nowrap"
                  data-testid="load-montage-button"
                  onClick={() => fileInputRef.current?.click()}
                  title="Load a montage from an AnyWave or Cartool .mtg file (replaces all current rows)"
                >
                  Load
                </button>
                <button
                  type="button"
                  className="button whitespace-nowrap"
                  data-testid="save-montage-button"
                  disabled={draftMontageChannels.length === 0}
                  onClick={handleSaveMontage}
                  title="Save the current montage as an AnyWave .mtg file"
                >
                  Save
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".mtg"
                  hidden
                  data-testid="montage-file-input"
                  onChange={handleLoadMontageFile}
                />
              </div>
            </div>
          </div>
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
