import { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import UplotReact from 'uplot-react';
import { cn } from '../utils/utils';
import toast from 'react-hot-toast';
import 'uplot/dist/uPlot.min.css';
import { useTheme } from '@/components/ThemeContext';
import {
  ZoomIn,
  ZoomOut,
  ChevronRight,
  ChevronLeft,
  ChevronLast,
  ChevronFirst,
  Plus,
  Minus,
  ListChevronsUpDown,
  ListChevronsDownUp,
  Keyboard,
  Map,
  Box,
  LocateFixed,
  Layers,
  LayersArrowDown,
} from 'lucide-react';
import { minMaxDownsample } from '@/utils/downsample';
import {
  buildMontageDisplayRows,
  deriveMontageRowSamples,
  computeReferenceSeries,
} from '@/utils/eegViewerUtils';
import { useEegBuffer } from '@/loaders/eegBuffer';
import { useContainerResize } from '@/hooks/useContainerResize';
import { useEegPlotControls } from '@/hooks/useEegPlotControls';
import { useScrubberDrag } from '@/hooks/useScrubberDrag';
import { useElectrodeMatching } from '@/hooks/useElectrodeMatching';
import { useChannelSettings } from '@/hooks/useChannelSettings';
import { useMontageChannels } from '@/hooks/useMontage';
import { useMontageTemplates } from '@/hooks/useMontageTemplates';
import { useTimepointSnapshot } from '@/hooks/useTimepointSnapshot';
import { useRowResize } from '@/hooks/useRowResize';

import { ELEC_POS_EXTENSIONS, INV_SOLUTIONS_EXTENSIONS } from '@/loaders/eegFormatRegistry';
import { EegTopoViewer } from '@/components/EegTopoViewer';
import { FileDropZone } from '@/components/FileDropZone';
import { StatusLed } from '@/components/StatusLed';
import { EegMontageEditor } from './EegMontageEditor';

const EEG_LOADING_TOAST_ID = 'eeg-buffer-loading'; // fixed id so the loading/success toasts update in place rather than stacking
const Y_AXIS_WIDTH = 80; // px for the y-axis area (channel name + tick space) — must match x-axis strip left padding
const PLOT_RIGHT_PAD = 20; // px right padding — must match in both channel plots and x-axis strip so ticks align
const OVERDRAW = 2; // canvas height multiplier — peaks bleed ±50% into adjacent lanes instead of clipping
const X_AXIS_GRID_SPACE = 60; // Min px between vertical gridlines — shared by the channel plots and the x-axis =>uPlot uses it to pick an increment (1,2,5,10,etc)
const MIN_CHANNEL_AREA_HEIGHT = 120; // px floor for the channel-plot scroll area. Below this the whole viewer overflows and the pane's scroll container takes over (mirrors NiiViewer's MIN_CANVAS_HEIGHT) instead of letting the x-axis/scrubber/controls/dropzone overlap
const MIN_PLOT_ROW_HEIGHT = 350; // px floor for the uPlot area
const ICON_SIZE = 22; // default size for lucide icons in the controls, used to compute input widths
const INPUT_MIN_CH = 3; // minimum input width in ch units
const INPUT_EXTRA_CH = 3; // extra ch of breathing room beyond the value's character length
const INPUT_PAD = '0.5rem'; // offsets px-1 padding (box-sizing: border-box shrinks the content area by this amount)
const ROW_DIVIDER_COLOR_DARK = 'rgba(255,255,255,0.05)'; // channel row bottom border in dark mode
const ROW_DIVIDER_COLOR_LIGHT = 'rgba(0,0,0,0.05)'; // channel row bottom border in light mode
const ZERO_LINE_COLOR_DARK = 'rgba(255,255,255,0.25)'; // y=0 reference line in dark mode
const ZERO_LINE_COLOR_LIGHT = 'rgba(0,0,0,0.25)'; // y=0 reference line in light mode
// Computes the width for the numeric inputs based on their current value, so they expand to fit large and small numbers
const inputWidth = (str) =>
  `calc(${Math.max(INPUT_MIN_CH, str.length + INPUT_EXTRA_CH)}ch + ${INPUT_PAD})`;

// Builds uPlot options for a single channel. Called once per channel on each render.
const buildChannelOptions = ({
  channelIndex,
  totalChannels,
  isDarkMode,
  syncKey,
  width,
  height,
  windowSize,
  startTime,
  yScale,
  color, // row's selected trace color ('red'|'blue'|...), or null/undefined for the theme default
}) => {
  const stroke = color ?? (isDarkMode ? 'rgba(255, 255, 255, 0.8)' : 'rgba(0, 0, 0, 0.8)');
  const gridColor = isDarkMode ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)';

  return {
    width,
    height,
    background: 'rgba(0,0,0,0)', // transparent so peaks from adjacent channels show through
    // All plots share the same syncKey — panning/zooming one moves all others
    cursor: { y: false, sync: { key: syncKey } },
    scales: {
      x: { time: false, range: [startTime, startTime + windowSize] },
      // y-range is extended by OVERDRAW so the center plotHeight pixels show ±yScale,
      // while the overdraw areas above/below render values beyond ±yScale
      y: { range: [-yScale * OVERDRAW, yScale * OVERDRAW] },
    },
    axes: [
      {
        show: true, // must be true for uPlot to draw the grid at all; everything but the grid itself is hidden below
        size: 0, // no reserved vertical space below plot for the tick marks/labels — labels live in the fixed x-axis strip instead
        ticks: { show: false }, // no little perpendicular tick mark poking out the axis baseline
        border: { show: false }, // no solid baseline along axis
        values: () => [], // no tick labels (an empty array skips uPlot's label-draw loop entirely)
        space: X_AXIS_GRID_SPACE, // keeps the same min tick spacing as the x-axis strip so gridlines line up with its labels
        grid: { show: true, stroke: gridColor, width: 1 },
      },
      { show: false }, // y-axis hidden; left padding below takes its place
    ],
    series: [{}, { stroke, width: 1 }],
    legend: { show: false },
    padding: [0, PLOT_RIGHT_PAD, 0, Y_AXIS_WIDTH], // left padding replaces the hidden y-axis size; 0 top/bottom so overdraw areas aren't consumed by padding
  };
};

export const EegViewer = ({
  nvRef_eegtopo,
  provider,
  channelNames,
  onViewReady,
  onTopoNvReady,
  customElectrodes = [], // [{label,x,y,z}] — owned by PatientView, loaded from a user-supplied .elc/.tsv file
  customElecPosFileName = null,
  inverseSolutionFileName = null, // filename (no extension) of the loaded inverse-solution file — owned by PatientView, passed down
  esiChannelMatchCount, // how many of the inverse solution's own channels have a same-named match in this recording — owned by PatientView, passed down
  esiChannelTotalCount, // paired with esiChannelMatchCount for the Inverse Solution status LED
  isEsiChannelMatchGoodForLed = false, // true only for a *full* match — a partial match means ESI can't compute at all
  esiSeegChannelNames = [], // which of the model's own channels are matched by name but themselves typed SEEG — explains an amber/disabled state a bare match count can't
  onElecPosFile,
  onInverseSolutionFile,
  onElectrodeSnapshotChange,
  onChannelSnapshotChange,
  onChannelTypesChange, // channelSettings type per channelNames index, independent of any plot click — lets the Inverse Solution LED/ESI toggle react to a montage-editor type edit without waiting for a topo click
  onTopoHasContentChange, // whether the topography NiiVue canvas currently has a mesh, so PatientView can enable/disable the cross-panel rotation link accordingly
  electrodeRenderEnabled, // boolean — owned by PatientView => whether electrode 3D render is enabled
  onElectrodeRenderChange, // handle for electrodeRender changes
  esiEnabled, // boolean — owned by PatientView => whether the Electrical Source Imaging layer is shown
  onEsiEnabledChange, // handle for esiEnabled changes
}) => {
  const { isDarkMode } = useTheme();
  const syncKey = 'eeg-sync'; // shared across all channels to link their interactions

  const tMax = provider.tMax; // total time span of the recording, in seconds

  // Container measurement — plotWidth feeds uPlot options, channelAreaHeight drives plotHeight below
  const { containerRef, width: plotWidth, height: channelAreaHeight } = useContainerResize();

  // Drag-to-resize for the canvas row's min-height.
  const { rowRef, handleResizeStart } = useRowResize(MIN_PLOT_ROW_HEIGHT);

  // Channel count / x-range / time-step / y-range controls, plus their input handlers
  const {
    visibleChannelCount,
    visibleChannelCountStr,
    windowSize,
    windowSizeStr,
    startTime,
    setStartTime,
    setWindowSize,
    setWindowSizeStr,
    shiftTimeStepSizeStr,
    yScale,
    yScaleStr,
    updateVisibleChannelCount,
    updateYScale,
    onVisibleChannelCountChange,
    onVisibleChannelCountBlur,
    onWindowSizeChange,
    onWindowSizeBlur,
    onShiftTimeStepChange,
    onShiftTimeStepBlur,
    onYScaleChange,
    onYScaleBlur,
    increaseWindowSize,
    decreaseWindowSize,
    forwardshiftStartTime,
    backwardshiftStartTime,
  } = useEegPlotControls({ tMax, channelCount: channelNames.length, channelAreaHeight });

  const X_AXIS_HEIGHT = 45; // px reserved for the fixed x-axis strip below the scroll area
  const plotHeight =
    channelAreaHeight > 0 ? Math.floor(channelAreaHeight / visibleChannelCount) : 0;
  const axisColor = isDarkMode ? 'rgba(255, 255, 255, 0.8)' : 'rgba(0, 0, 0, 0.8)';

  // Buffer of EEG data around the visible window — reloads on big jumps, otherwise
  // keeps the previous buffer's data on screen until the new one arrives (no flash).
  const { timestamps, channels, isLoading } = useEegBuffer(provider, startTime, windowSize);

  // ── Topography state ─────────────────────────────────────────────────────────────────────
  const [topoEnabled, setTopoEnabled] = useState(false);
  const [topoTimepoint, setTopoTimepoint] = useState(null);

  // hoveredLedHighlight indicates which StatusLED should light up when the disabled toggle
  // toggle (Topo/3D render/ESI) is hovered over => gives additional cue to user why it's disabled.
  // Set on the toggle's wrapper div rather than the <button> itself (disabled buttons don't reliably fire mouse events)
  const [hoveredLedHighlight, setHoveredLedHighlight] = useState(null); // 'electrodePosition' | 'inverseSolution' | 'stackEeg' | null
  // Topograph window only opens when the toggle is on (topoEnabled) AND once a EEGplot
  // click has produced a timepoint to show (topoTimepoint)
  const topoVisible = topoEnabled && topoTimepoint !== null;

  // EEG Montage window only opens when the button is pressed
  const [montageVisible, setMontageVisible] = useState(false);

  // Toggle stacked vs unStacked EEG plot
  const [eegIsStacked, setEegIsStacked] = useState(false);

  // Px position (from the plot area's left edge) of the vertical marker for topoTimepoint — the
  // timestamp the electrode voltage snapshot was taken at, shared by the topography, ESI, and
  // 3D-render views. Null hides the marker: no snapshot yet, or it's scrolled outside the window.
  const snapshotMarkerLeft =
    topoTimepoint !== null && topoTimepoint >= startTime && topoTimepoint <= startTime + windowSize
      ? Y_AXIS_WIDTH +
        ((topoTimepoint - startTime) / windowSize) * (plotWidth - Y_AXIS_WIDTH - PLOT_RIGHT_PAD)
      : null;

  // Electrode-position matching + recording-type (EEG/SEEG) auto-detection — feeds
  // channelSettings' initial seed below (see useChannelSettings) now that the manual
  // EEGTypeToggle is gone.
  const {
    detectedIsSeeg,
    electrodes,
    matched,
    isStandardElectrodes,
    electrodePositionMatchCount,
    electrodePositionTotalCount,
    isElectrodePositionMatchGoodForLed,
  } = useElectrodeMatching({
    channelNames,
    customElectrodes,
    customElecPosFileName,
  });

  // Per-channel type/bad-channel state, edited via the EegMontageEditor window — new
  // channels are seeded from the whole-recording auto-detection above; from then on the
  // per-channel value (and the majorityIsSeeg aggregate derived from it, below) is what
  // the rest of this component reads — detectedIsSeeg itself is never read again below.
  const { channelSettings, applyChannelSettings } = useChannelSettings(
    channelNames,
    detectedIsSeeg ? 'seeg' : 'eeg'
  );

  const majorityIsSeeg =
    Object.values(channelSettings).filter((c) => c.type === 'seeg').length >
    Object.values(channelSettings).filter((c) => c.type === 'eeg').length;

  // Whether any channel is currently typed EEG — gates EegTopoViewer's 3D mesh tab, since
  // the scalp mesh has nothing to render without at least one EEG-typed channel.
  const hasEegChannels = Object.values(channelSettings).some((c) => c.type === 'eeg');

  // How many channels are typed EEG — the denominator for the mesh's "X / Y channels mapped"
  // footer. Using the whole recording's channel count there would read as if a mixed
  // EEG+SEEG recording with every EEG channel matched still had unmatched channels (the SEEG
  // ones, which were never eligible to match a scalp position template in the first place).
  const eegChannelCount = useMemo(
    () => Object.values(channelSettings).filter((c) => c.type === 'eeg').length,
    [channelSettings]
  );

  // One channelSettings type per channelNames index — lets ESI reject a channel it needs
  // that's itself typed SEEG, even if its name happens to match (see channelSnapshot below).
  const channelTypes = useMemo(
    () => channelNames.map((name) => channelSettings[name]?.type),
    [channelNames, channelSettings]
  );
  // Reported upward if the channel types have changed (mirrors onTopoHasContentChange below) so
  // the Inverse Solution LED/ESI toggle can react to a montage-editor type edit immediately
  useEffect(() => {
    onChannelTypesChange?.(channelTypes);
  }, [channelTypes, onChannelTypesChange]);

  // File-backed montage templates (public/montage_files/TEMPLATE_MONTAGES.json), listed
  // in the sidebar quick-select alongside the None/CAR/Custom presets below — fetched here
  // (rather than where it's applied, further down) so useMontageChannels can recognize a
  // live montage that exactly matches one of them.
  const montageTemplates = useMontageTemplates();

  // Montage row list (reference/color per displayed trace), edited via the same window's
  // montage-settings pane — kept separate from channelSettings since it's an array (can
  // later support arbitrary derived rows), not a per-channel record.
  const {
    montageChannels,
    applyMontageChannels,
    montageTemplate,
    customMontageChannels,
    applyMontageTemplate,
  } = useMontageChannels(channelNames, montageTemplates);

  // Rows to render in the channel-plot area: one per non-bad channel (in channelNames
  // order) when no montage rows are configured, or the configured montage rows once any
  // exist — each named "channel - reference" (or just "channel" when unreferenced) and
  // filtered to drop rows whose channel/reference is bad. See buildMontageDisplayRows.
  const displayRows = useMemo(
    () => buildMontageDisplayRows(channelNames, channelSettings, montageChannels),
    [channelNames, channelSettings, montageChannels]
  );

  // Shared average/median reference series (see the diagram atop eegViewerUtils.js) —
  // computed once from the raw buffer's non-bad channels, then handed to both the montage
  // row waveform below (deriveMontageRowSamples) and the topography/connectome/ESI
  // snapshot (useTimepointSnapshot's always-average referencing) rather than each
  // recomputing it. The filtered non-bad array itself is only a transient local — nothing
  // but the small { average, median } result needs to survive between renders.
  const referenceSeries = useMemo(() => {
    if (!channels) return null;
    const nonBadChannels = channels.filter(
      (_, index) => !channelSettings[channelNames[index]]?.bad
    );
    return computeReferenceSeries(nonBadChannels);
  }, [channels, channelSettings, channelNames]);

  // Bad channels are hidden from topography/connectome/ESI entirely, not just excluded from
  // the reference calc — a bad electrode's position never appears as a node to plot, and
  // its own voltage never contributes to ESI's source-power computation (voltage set to 0).
  // `matched` (from useElectrodeMatching) is kept raw for EegMontageEditor's Pos-match indicator below,
  // which cares about position-file coverage independent of the current bad-channel flags.
  // visibleMatched 'type' for each match => buildElectrodeLayer in eegTopographyUtils.js uses it
  // to reconstruct proper connectome
  const visibleMatched = useMemo(
    () =>
      matched
        .filter((m) => !channelSettings[m.name]?.bad)
        .map((m) => ({ ...m, type: channelSettings[m.name]?.type })),
    [matched, channelSettings]
  );

  // Zeroes a bad channel's entry in an all-channel voltage array (channelNames-aligned) —
  // used for the ESI/matrix snapshot below, where entries can't simply be dropped (their
  // positions must stay aligned with channelNames/the inverse-solution model), only zeroed
  // out so they stop contributing real-looking data. Memoized so the onChannelSnapshotChange
  // wrapper below keeps a stable identity across renders — useTimepointSnapshot's effect
  // deliberately fires only on topoTimepoint changes, not on every re-render.
  const zeroBadChannelVoltages = useCallback(
    (voltages) => voltages.map((v, index) => (channelSettings[channelNames[index]]?.bad ? 0 : v)),
    [channelSettings, channelNames]
  );

  const applyMontageFileTemplate = (template) => {
    // Warn about any channel/reference the template names that this recording doesn't
    // have — those rows still get applied to montageChannels state below (so the dropdown
    // keeps reflecting "this is the template, as loaded"), but buildMontageDisplayRows
    // silently drops them from the waveform, which otherwise looks like a mystery
    // empty/partial montage.
    const missingNames = new Set();
    for (const row of template.rows) {
      if (!channelNames.includes(row.channel)) missingNames.add(row.channel);
      if (row.reference && !channelNames.includes(row.reference)) missingNames.add(row.reference);
    }
    if (missingNames.size > 0) {
      if (missingNames.size < 20) {
        toast(
          `"${template.name}" applied.\nRecording is missing ${missingNames.size} ${missingNames.size > 1 ? 'channels' : 'channel'}.\nIt references: (${[...missingNames].join(', ')}) — these rows won't be shown.`,
          {
            icon: '⚠️',
          }
        );
      } else {
        toast(
          `"${template.name}" applied.\nRecording is missing ${missingNames.size} channels.\nThese rows won't be shown.`,
          {
            icon: '⚠️',
          }
        );
      }
    }

    // Overwrite the current montage rows with the one from the template
    applyMontageChannels(
      template.rows.map((row) => ({
        id: crypto.randomUUID(),
        ...row, // this preserves whatever channel, reference and color the fil has per row
      }))
    );
    // Patch the type of every channel the template names. A name not in this recording
    // still gets added (harmless — nothing reads channelSettings by iterating its keys).
    const nextChannelSettings = { ...channelSettings };
    for (const [name, type] of Object.entries(template.channelTypes)) {
      nextChannelSettings[name] = { ...nextChannelSettings[name], type };
    }
    applyChannelSettings(nextChannelSettings);
  };

  // Routes the sidebar template <select>'s value to the right apply function — a file path
  // (looked up in montageTemplates) or one of the built-in preset strings.
  const applyTemplateSelection = (value) => {
    const template = montageTemplates.find((t) => t.path === value);
    if (template) applyMontageFileTemplate(template);
    else applyMontageTemplate(value);
  };

  // Electrode/channel voltage snapshots at the clicked topography timepoint, lifted up to
  // PatientView for the intracranial connectome and ESI — always common-average-referenced
  // (see useTimepointSnapshot), independent of the montage row waveform above.
  const handleChannelSnapshotChange = useCallback(
    (snapshot) =>
      onChannelSnapshotChange?.({
        ...snapshot,
        voltages: zeroBadChannelVoltages(snapshot.voltages),
      }),
    [onChannelSnapshotChange, zeroBadChannelVoltages]
  );
  const { topoVoltages, topoVoltagesByChannel: rawTopoVoltagesByChannel } = useTimepointSnapshot({
    channels,
    referenceSeries,
    topoTimepoint,
    timestamps,
    fs: provider.fs,
    matched: visibleMatched,
    channelNames,
    channelTypes,
    isIntracranial: majorityIsSeeg,
    onElectrodeSnapshotChange,
    onChannelSnapshotChange: handleChannelSnapshotChange,
  });
  const topoVoltagesByChannel = useMemo(
    () => zeroBadChannelVoltages(rawTopoVoltagesByChannel),
    [rawTopoVoltagesByChannel, zeroBadChannelVoltages]
  );

  // The 3D mesh is a scalp surface — only EEG-typed matches belong on it, even if a channel
  // marked SEEG happens to share a name with a template position label. topoVoltages is
  // index-aligned with visibleMatched (see useTimepointSnapshot), so both are filtered by the
  // same predicate/order here to stay aligned.
  const eegMesh = useMemo(() => {
    const matched = [];
    const voltages = [];
    visibleMatched.forEach((m, i) => {
      if (m.type === 'eeg') {
        matched.push(m);
        voltages.push(topoVoltages[i]);
      }
    });
    return { matched, voltages };
  }, [visibleMatched, topoVoltages]);

  // Reports whether EegTopoViewer's NiiVue canvas currently has a mesh loaded — mirrors
  // the guard in EegTopoViewer's mesh-loading effect (!hasEegChannels || !electrodes?.length
  // || !voltages?.length skips the load) so PatientView can tell when the 3D scene it's
  // synced to is genuinely empty and disable the cross-panel rotation link accordingly. The
  // mesh stays loaded even while the matrix tab is the one showing (see EegTopoViewer), so
  // this doesn't need to track which of the two tabs is currently active.
  const topoHasContent =
    topoEnabled && hasEegChannels && electrodes?.length > 0 && eegMesh.voltages.length > 0;
  useEffect(() => {
    onTopoHasContentChange?.(topoHasContent);
  }, [topoHasContent, onTopoHasContentChange]);

  // Show a loading toast while the initial buffer loads, then update it to a success
  // message — self-contained so EegViewer reports its own status regardless of where
  // it's embedded. Later reloads keep showing the previous buffer's data, so no toast
  // is needed for those (isLoading is only true before the first buffer arrives).
  useEffect(() => {
    if (isLoading) {
      toast.loading('Loading EEG data…', { id: EEG_LOADING_TOAST_ID });
    } else {
      toast.success('EEG data loaded!', { id: EEG_LOADING_TOAST_ID });
    }
  }, [isLoading]);

  // Dismiss the toast if the viewer unmounts mid-load (e.g. resetting the EEG panel)
  useEffect(() => {
    return () => toast.dismiss(EEG_LOADING_TOAST_ID);
  }, []);

  // Downsample each display row's (possibly channel-minus-reference) series for the
  // visible window
  const displayedData = useMemo(() => {
    // If we don't have valid dimensions or data yet, return empty arrays for each row to avoid rendering broken plots
    const empty = displayRows.map(() => [[], []]);
    if (plotWidth === 0 || !timestamps || timestamps.length === 0 || !channels) return empty;

    const endTime = startTime + windowSize;
    return displayRows.map((row) =>
      minMaxDownsample(
        timestamps,
        deriveMontageRowSamples(channels, row, referenceSeries),
        startTime,
        endTime,
        plotWidth
      )
    );
  }, [timestamps, channels, referenceSeries, displayRows, startTime, windowSize, plotWidth]);

  // Signal onViewReady once the first measurement lands and charts have rendered
  const onViewReadyCalledRef = useRef(false);
  useEffect(() => {
    if (plotWidth > 0 && !onViewReadyCalledRef.current) {
      onViewReadyCalledRef.current = true;
      onViewReady?.();
    }
  }, [plotWidth, onViewReady]);

  // Timeline scrubber drag (pan/resize the visible window)
  const { scrubberRef, isDragging, startDrag } = useScrubberDrag({
    tMax,
    startTime,
    windowSize,
    setStartTime,
    setWindowSize,
    setWindowSizeStr,
  });

  // Clicking anywhere in the viewer (other than a button/input) moves keyboard focus to the
  // container so the shortcuts above become active, without stealing focus from form controls
  const viewerRef = useRef(null);
  const focusViewer = (e) => {
    // If the click originated from a button or input, don't move focus to the container
    // this allows users to click the controls and then use the keyboard without interruption, e.g. click the range input and then type a number or use the arrow keys to adjust it.
    if (e.target.closest('button, input, textarea, select')) return;
    // Otherwise, focus the container to enable keyboard shortcuts
    viewerRef.current?.focus();
  };

  // Keyboard navigation: Up/Down adjust range, Left/Right pan by the shift step,
  // Page Up/Down jump by a full window, Home/End jump to the start/end of the recording.
  const handleKeyDown = (e) => {
    // Guard clause to ignore key presses when focused on anything other than
    // the viewer container — this allows form controls to receive focus and handle their own key events
    if (e.target !== viewerRef.current) return;
    switch (e.key) {
      case 'ArrowUp':
        // Zoom in (halve the y-range)
        e.preventDefault(); // prevent arrow keys from scrolling the page
        updateYScale(yScale / 2);
        break;
      case 'ArrowDown':
        // Zoom out (double the y-range)
        e.preventDefault();
        updateYScale(yScale * 2);
        break;
      case 'ArrowLeft':
        // Pan left by the shift step
        e.preventDefault();
        backwardshiftStartTime();
        break;
      case 'ArrowRight':
        // Pan right by the shift step
        e.preventDefault();
        forwardshiftStartTime();
        break;
      case 'PageUp':
        // Jump back by a full window
        e.preventDefault();
        setStartTime((start) => Math.max(0, start - windowSize));
        break;
      case 'PageDown':
        // Jump forward by a full window
        e.preventDefault();
        setStartTime((start) => Math.min(tMax - windowSize, start + windowSize));
        break;
      case ' ':
        // Jump forward by a full window
        e.preventDefault();
        setStartTime((start) => Math.min(tMax - windowSize, start + windowSize));
        break;
      case 'Home':
        // Jump to the start of the recording
        e.preventDefault();
        setStartTime(0);
        break;
      case 'End':
        // Jump to the end of the recording
        e.preventDefault();
        setStartTime(tMax - windowSize);
        break;
      default:
        break;
    }
  };

  // Current default view: one uPlot instance per displayed row, each in its own
  // horizontal lane with an independent y-baseline (see buildChannelOptions/OVERDRAW
  // above). Kept as a plain function (not a component) so it closes over the render's
  // variables directly — a <UnstackedPlots /> component would get a fresh identity every
  // render and remount its uPlot instances instead of updating them in place.
  const renderUnstackedPlots = () => (
    <div className="relative">
      {/* Snapshot marker — one continuous vertical line spanning every channel, at the
          timepoint for the current topography/ESI/3D-render voltages. Rendered once
          here (rather than per-row) so there's no seam at each row's border, and placed
          before the rows so it paints behind their canvases like the zero-line does. */}
      {snapshotMarkerLeft !== null && (
        <div
          data-testid="snapshot-marker"
          className="absolute pointer-events-none top-0 bottom-0 w-0.25"
          style={{
            left: snapshotMarkerLeft,
            backgroundColor: 'var(--c-secondary)',
          }}
        />
      )}
      {displayRows.map((row, rowIndex) => (
        // Channel divider below each row
        <div
          key={row.id}
          style={{
            height: plotHeight,
            overflow: 'visible',
            borderBottom: `1px solid ${isDarkMode ? ROW_DIVIDER_COLOR_DARK : ROW_DIVIDER_COLOR_LIGHT}`,
          }}
          className="relative"
        >
          {/* Row name label */}
          <span
            className="absolute left-0 top-1/2 -translate-y-1/2 text-xs text-center select-none z-10 px-0.5 truncate"
            style={{ width: Y_AXIS_WIDTH }}
            title={row.name}
          >
            {row.name}
          </span>
          {/* Zero-line at y=0, aligned with the plot area (not drawn by uPlot to avoid grid issues) */}
          <div
            className="absolute pointer-events-none"
            style={{
              top: '50%',
              left: Y_AXIS_WIDTH,
              right: PLOT_RIGHT_PAD,
              height: 1,
              backgroundColor: isDarkMode ? ZERO_LINE_COLOR_DARK : ZERO_LINE_COLOR_LIGHT,
            }}
          />
          {/* Canvas wrapper — absolutely positioned to center the taller canvas in the lane */}
          <div
            style={{
              position: 'absolute',
              top: -((plotHeight * (OVERDRAW - 1)) / 2),
              left: 0,
            }}
          >
            <UplotReact
              options={buildChannelOptions({
                channelIndex: row.channelIndex,
                totalChannels: displayRows.length,
                isDarkMode,
                syncKey,
                width: plotWidth,
                height: plotHeight * OVERDRAW,
                windowSize,
                startTime,
                yScale,
                color: row.color,
              })}
              data={displayedData[rowIndex]}
              onCreate={(u) => {
                {
                  /* click listener that converts the click's x-position into a timestamp => sets topoTimepoint */
                }
                u.over.addEventListener('click', () => {
                  const t = u.posToVal(u.cursor.left, 'x');
                  if (!isNaN(t)) {
                    setTopoTimepoint(t);
                  }
                });
              }}
              onDelete={() => {}}
            />
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <>
      {/* min-h-full (not h-full) so this box grows with a dragged-taller plot row, keeping the
          absolute keyboard-hint icon below anchored to the real bottom instead of overlapping it */}
      {/* tabIndex + onKeyDown make the viewer keyboard-navigable once focused (see handleKeyDown) */}
      <div
        ref={viewerRef}
        data-testid="eeg-viewer-container"
        className="w-full min-h-full pb-2.5 px-2 flex flex-col group/viewer relative focus:outline-solid focus:outline-2 focus:outline-secondary focus:-outline-offset-2"
        tabIndex={0}
        onMouseDown={focusViewer}
        onKeyDown={handleKeyDown}
      >
        {/* Keyboard shortcut hint — bottom-right corner of the viewer pane.
            Uses a custom hover tooltip instead of the native title attribute, since native
            tooltips have a long built-in show delay — long enough that clicking the icon (to
            focus the viewer) often fired before the tooltip ever appeared. */}
        <div className="absolute bottom-18 right-3 z-20 group/tip">
          <div className="text-foreground/40 hover:text-foreground/80 group-focus/viewer:text-secondary transition-colors cursor-help">
            <Keyboard size={18} />
          </div>
          <div
            role="tooltip"
            className={cn(
              'opacity-0 invisible transition-opacity duration-250 ease-in', // fades in/out on hover
              'group-hover/tip:opacity-100 group-hover/tip:visible',
              'absolute bottom-full right-0 z-30 mb-1 w-max', // positioned above the icon, right-aligned
              'rounded-md border border-border bg-surface shadow-[var(--c-shadow)]', // card look
              'px-2 py-2 text-xs text-foreground' // spacing & text
            )}
          >
            <p className="mb-1.5 max-w-[250px]">
              Click the EEG viewer to enable keyboard navigation (
              <span className="text-secondary font-bold">blue </span>outline when active):
            </p>
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
              <span className="text-foreground/60">↑ / ↓</span>
              <span>Range adjustment up/down</span>
              <span className="text-foreground/60">← / →</span>
              <span>Move a time step back/forward</span>
              <span className="text-foreground/60">Space</span>
              <span>Jump a time window forward</span>
              <span className="text-foreground/60">Page ↑ / ↓</span>
              <span>Jump a time window back/forward</span>
              <span className="text-foreground/60">Home / End</span>
              <span>Jump to start/end</span>
            </div>
          </div>
        </div>
        {/* Plot row: sidebar + channel plots side by side; flex-1 so controls sit below.
            No min-h-0 here on purpose — its min-height stays content-based so the row can
            never shrink below the channel-area floor + x-axis + scrubber + controls. When the
            pane gets shorter than that, the viewer overflows and the pane scrolls (see the
            MIN_CHANNEL_AREA_HEIGHT floor below) rather than the fixed rows overlapping. */}
        <div
          ref={rowRef}
          data-testid="eeg-plot-row"
          className="flex-1 flex flex-row"
          style={{ minHeight: MIN_PLOT_ROW_HEIGHT }}
        >
          {/* Left sidebar: Channels controls centered in the available height, Montage pinned to the bottom-left corner */}
          <div className="shrink-0 flex flex-col px-1">
            <div className="flex flex-col gap-1 absolute pl-7 pt-7">
              {/* EEG Topography Toggle*/}
              <div
                className=""
                onMouseEnter={() =>
                  !electrodes?.length && setHoveredLedHighlight('electrodePosition')
                }
                onMouseLeave={() => setHoveredLedHighlight(null)}
              >
                <button
                  type="button"
                  className="button button-icon"
                  title={
                    electrodes?.length > 0
                      ? `${topoEnabled ? 'Close Topograph Map' : 'EEG Topograph Map. If enabled: click EEG plot to generate an EEG Topography map at selected timestamp (requires known electrode positions)'}`
                      : 'EEG Topograph Map. Requires known electrode positions'
                  }
                  aria-label={`${topoEnabled ? 'Disable' : 'Enable'} Topograph Map`}
                  aria-pressed={topoEnabled}
                  disabled={!electrodes?.length}
                  onClick={() => setTopoEnabled(!topoEnabled)}
                >
                  <Map size={ICON_SIZE} />
                </button>
              </div>
              {/* 3D Electrode Render Toggle*/}
              <div
                className=""
                onMouseEnter={() =>
                  (!electrodes?.length || isStandardElectrodes) &&
                  setHoveredLedHighlight('electrodePosition')
                }
                onMouseLeave={() => setHoveredLedHighlight(null)}
              >
                <button
                  type="button"
                  className="button button-icon"
                  title={
                    electrodes?.length > 0 && !isStandardElectrodes
                      ? `${electrodeRenderEnabled ? 'Close 3D Electrode Rendering' : 'Open 3D Electrode Rendering'}`
                      : majorityIsSeeg
                        ? '3D Electrode Rendering. Requires known electrode positions'
                        : "3D Electrode Rendering. Requires a patient-specific electrode position file — the fsaverage_1005 (FreeSurfer) template is only an indicative layout, not this patient's actual head geometry"
                  }
                  aria-label={`${electrodeRenderEnabled ? 'Hide' : 'Show'} 3D Electrode Rendering`}
                  aria-pressed={electrodeRenderEnabled}
                  disabled={!electrodes?.length || isStandardElectrodes}
                  onClick={() => onElectrodeRenderChange(!electrodeRenderEnabled)}
                >
                  <Box size={ICON_SIZE} />
                </button>
              </div>
              {/* Electrical Source Imaging (ESI) Toggle*/}
              <div
                className=""
                onMouseEnter={() =>
                  (!inverseSolutionFileName || !isEsiChannelMatchGoodForLed) &&
                  setHoveredLedHighlight('inverseSolution')
                }
                onMouseLeave={() => setHoveredLedHighlight(null)}
              >
                <button
                  type="button"
                  className="button button-icon"
                  title={
                    inverseSolutionFileName && isEsiChannelMatchGoodForLed
                      ? `${esiEnabled ? 'Disable Electrical Source Imaging' : 'Electrical Source Imaging. If enabled: click EEG plot to compute source power at selected timestamp'}`
                      : inverseSolutionFileName
                        ? esiSeegChannelNames.length > 0
                          ? 'Electrical Source Imaging not available when not all required channels have type EEG'
                          : 'Electrical Source Imaging. Inverse solution channels do not fully match this recording'
                        : 'Electrical Source Imaging. Requires a loaded inverse solution'
                  }
                  aria-label={`${esiEnabled ? 'Disable' : 'Enable'} Electrical Source Imaging`}
                  aria-pressed={esiEnabled}
                  disabled={!inverseSolutionFileName || !isEsiChannelMatchGoodForLed}
                  onClick={() => onEsiEnabledChange(!esiEnabled)}
                >
                  <LocateFixed size={ICON_SIZE} />
                </button>
              </div>

              {/* Stack/Unstack EEG toggle*/}
              <div
                className=""
                onMouseEnter={() =>
                  !electrodes?.length && setHoveredLedHighlight('electrodePosition')
                }
                onMouseLeave={() => setHoveredLedHighlight(null)}
              >
                <button
                  type="button"
                  className="button button-icon"
                  title={
                    electrodes?.length > 1
                      ? `${eegIsStacked ? 'Unstack' : 'Stack'} EEG Plots`
                      : 'Stacking EEG plots requires more than 1 active channel'
                  }
                  aria-label={`${eegIsStacked ? 'Unstack' : 'Stack'} EEG Plots`}
                  aria-pressed={eegIsStacked}
                  disabled={!electrodes?.length}
                  onClick={() => setEegIsStacked(!eegIsStacked)}
                >
                  {eegIsStacked ? (
                    <LayersArrowDown size={ICON_SIZE} />
                  ) : (
                    <Layers size={ICON_SIZE} />
                  )}
                </button>
              </div>
            </div>

            {/* Channel Controls*/}
            <div className="flex-1 flex flex-row items-center">
              <div className="flex flex-row items-center gap-1 py-1 border-border/50 border-1 border-r-0 rounded-tl-md rounded-bl-md">
                <span className="text-xs text-foreground/60 whitespace-nowrap [writing-mode:vertical-rl] rotate-180 select-none pointer-events-none">
                  Channels
                </span>
                <div className="flex flex-col items-center gap-1">
                  <button
                    type="button"
                    className="button button-icon"
                    onClick={() => updateVisibleChannelCount(visibleChannelCount + 1)}
                    title="Show more channels"
                  >
                    <ListChevronsUpDown size={ICON_SIZE} />
                  </button>
                  <input
                    id="eeg-visible-channels"
                    type="number"
                    value={visibleChannelCountStr}
                    min={1}
                    max={channelNames.length}
                    style={{ width: inputWidth(visibleChannelCountStr) }}
                    onChange={onVisibleChannelCountChange}
                    onBlur={onVisibleChannelCountBlur}
                    className="text-center border border-border rounded px-1 py-0.5 text-sm bg-background text-foreground [appearance:textfield]"
                    aria-label="Number of channels displayed"
                  />
                  <button
                    type="button"
                    className="button button-icon"
                    onClick={() => updateVisibleChannelCount(visibleChannelCount - 1)}
                    title="Show fewer channels"
                  >
                    <ListChevronsDownUp size={ICON_SIZE} />
                  </button>
                </div>
              </div>
            </div>
            {/* EEG Montage: opens the montage editor window for per-channel/row referencing,
                plus a quick template <select> below it that applies a preset straight to
                the live montage (no Apply/OK gate) — None/Common Average Reference always
                offered, "Custom" only once a hand-built montage exists to switch back to. */}
            <div className="flex flex-col items-center gap-1 pb-1">
              <button type="button" className="button" onClick={() => setMontageVisible((v) => !v)}>
                Montage
              </button>
              <select
                className="text-xs w-20 border border-border rounded bg-surface disabled:opacity-40 disabled:cursor-not-allowed"
                data-testid="montage-template-select"
                title={
                  montageVisible
                    ? 'Close the montage editor to apply a template'
                    : 'Montage template'
                }
                value={montageTemplate}
                onChange={(e) => applyTemplateSelection(e.target.value)}
                disabled={montageVisible}
              >
                <option value="none">None</option>
                {customMontageChannels && <option value="custom">Custom</option>}
                <option value="average">CAR (Common Average Reference)</option>
                {montageTemplates.map((template) => (
                  <option key={template.path} value={template.path}>
                    {template.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* flex-col so the scroll area and fixed x-axis strip stack vertically */}
          <div className="flex-1 min-w-0 flex flex-col">
            {/* relative wrapper: sized by flex layout, never by content. minHeight floors the
                channel-plot area so it stays viewable; once the pane is too short to honour
                this floor, the whole viewer overflows into the pane's scroll container instead
                of the plots collapsing to nothing. */}
            <div className="flex-1 relative" style={{ minHeight: MIN_CHANNEL_AREA_HEIGHT }}>
              {/* containerRef is on the scroll div itself: absolute inset-0 fixes its size so
                content can never inflate it. scrollbar-gutter:stable always reserves the scrollbar
                lane so contentRect.width is stable and no horizontal scrollbar ever appears */}
              <div
                ref={containerRef}
                className="absolute top-2 left-0 bottom-0 right-0 overflow-y-auto themed-scrollbar"
                title={
                  visibleMatched.length > 0 && topoEnabled && !topoVisible
                    ? 'Click any channel to view the EEG topography for that time point'
                    : undefined
                }
                style={{ scrollbarGutter: 'stable' }}
              >
                {/* Wait for first measurements before rendering — avoids zero-size flash */}
                {plotWidth > 0 &&
                  plotHeight > 0 &&
                  (eegIsStacked ? renderStackedPlots() : renderUnstackedPlots())}
              </div>
            </div>

            {/* Fixed x-axis strip — always visible, never scrolls with the channels */}
            {plotWidth > 0 && (
              <div className="shrink-0" style={{ height: X_AXIS_HEIGHT }}>
                <UplotReact
                  options={{
                    width: plotWidth,
                    height: X_AXIS_HEIGHT,
                    cursor: { sync: { key: syncKey } },
                    scales: { x: { time: false, range: [startTime, startTime + windowSize] } },
                    axes: [
                      // space matches the channel plots' hidden grid axis so tick labels line up with the gridlines above
                      {
                        stroke: axisColor,
                        size: 40,
                        space: X_AXIS_GRID_SPACE,
                        grid: { show: false },
                      },
                      { show: false },
                    ],
                    series: [{}],
                    legend: { show: false },
                    padding: [0, PLOT_RIGHT_PAD, 0, Y_AXIS_WIDTH],
                  }}
                  data={[timestamps ?? []]}
                  onCreate={() => {}}
                  onDelete={() => {}}
                />
              </div>
            )}

            {/* Timeline scrubber: thumb position = startTime, thumb width = windowSize */}
            {plotWidth > 0 && (
              <div
                className="shrink-0 py-2"
                style={{
                  width: plotWidth,
                  paddingLeft: Y_AXIS_WIDTH,
                  paddingRight: PLOT_RIGHT_PAD,
                }}
              >
                <div
                  ref={scrubberRef}
                  data-testid="timeline-scrubber"
                  className="relative h-3 bg-surface cursor-pointer"
                  onMouseDown={(e) => {
                    const bar = scrubberRef.current.getBoundingClientRect();
                    const ratio = (e.clientX - bar.left) / bar.width;
                    setStartTime(
                      Math.max(0, Math.min(tMax - windowSize, ratio * tMax - windowSize / 2))
                    );
                  }}
                >
                  {/* Timeline thumb. left/width are clamped so the thumb can never extend past
                      the track's right edge — decimal-rounding in updateWindowSize can leave
                      windowSize a hair above tMax, which would otherwise push the thumb past
                      100% and overflow the panel (horizontal scrollbar / misaligned scrubber). */}
                  <div
                    data-testid="timeline-thumb"
                    style={{
                      left: `${Math.max(0, Math.min(100, (startTime / tMax) * 100))}%`,
                      width: `${Math.min(100 - (startTime / tMax) * 100, (windowSize / tMax) * 100)}%`,
                    }}
                    className={`absolute inset-y-0 cursor-grab active:cursor-grabbing ${isDragging ? 'bg-primary' : 'bg-border hover:bg-foreground'}`}
                    onMouseDown={(e) => startDrag(e, 'move')}
                  >
                    {/* Left resize handle — secondary-coloured line extending above and below the thumb */}
                    <div
                      data-testid="timeline-resize-left"
                      className="absolute left-0 w-0.75 cursor-ew-resize"
                      style={{ top: '-4px', bottom: '-4px', backgroundColor: 'var(--c-secondary)' }}
                      onMouseDown={(e) => startDrag(e, 'resize-left')}
                    />
                    {/* Right resize handle */}
                    <div
                      data-testid="timeline-resize-right"
                      className="absolute right-0 w-0.75 cursor-ew-resize"
                      style={{ top: '-4px', bottom: '-4px', backgroundColor: 'var(--c-secondary)' }}
                      onMouseDown={(e) => startDrag(e, 'resize-right')}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Range: shrink/expand the shared y-range (all channels) */}
            {/* shrink-0 pins the controls at the bottom, never squeezed by the channel area.
                px-8 reserves room matching the keyboard hint icon (absolute bottom-right, see
                above) on both sides — flex-wrap can't otherwise see that icon, so without this
                the row stays unwrapped right up until its last button sits behind the icon. */}
            <div className="shrink-0 flex flex-wrap justify-center gap-4 py-1 px-8">
              <div className="flex flex-col items-center gap-0.5 px-1 pb-1 border-border/50 border-1 border-t-0 rounded-bl-md rounded-br-md">
                <label htmlFor="eeg-range" className="text-xs text-foreground/60 select-none">
                  Range (µV)
                </label>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="button button-icon"
                    onClick={() => updateYScale(yScale * 2)}
                    title="Zoom out"
                  >
                    <ZoomOut size={ICON_SIZE} />
                  </button>
                  <input
                    id="eeg-range"
                    type="number"
                    value={yScaleStr}
                    min={1}
                    style={{ width: inputWidth(yScaleStr) }}
                    onChange={onYScaleChange}
                    onBlur={onYScaleBlur}
                    className="text-center border border-border rounded px-1 py-0.5 text-sm bg-background text-foreground [appearance:textfield]"
                    aria-label="Range (µV)"
                  />
                  <button
                    type="button"
                    className="button button-icon"
                    onClick={() => updateYScale(yScale / 2)}
                    title="Zoom in"
                  >
                    <ZoomIn size={ICON_SIZE} />
                  </button>
                </div>
              </div>

              {/* Time Step: move the x-range forward/backward by a user-defined step */}
              <div className="flex flex-col items-center gap-0.5 px-1 border-border/50 border-1 border-t-0 rounded-bl-md rounded-br-md">
                <label htmlFor="eeg-time-step" className="text-xs text-foreground/60 select-none">
                  Time Step (s)
                </label>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="button button-icon"
                    onClick={() => setStartTime(0)}
                    title="Jump to start"
                  >
                    <ChevronFirst size={15} />
                  </button>
                  <button
                    type="button"
                    className="button button-icon"
                    onClick={backwardshiftStartTime}
                    title="Shift backward"
                  >
                    <ChevronLeft size={ICON_SIZE} />
                  </button>
                  <input
                    id="eeg-time-step"
                    type="number"
                    value={shiftTimeStepSizeStr}
                    min={1}
                    max={windowSize}
                    style={{ width: inputWidth(shiftTimeStepSizeStr) }}
                    onChange={onShiftTimeStepChange}
                    onBlur={onShiftTimeStepBlur}
                    className="text-center border border-border rounded px-1 py-0.5 text-sm bg-background text-foreground [appearance:textfield]"
                    aria-label="Time step (s)"
                  />
                  <button
                    type="button"
                    className="button button-icon"
                    onClick={forwardshiftStartTime}
                    title="Shift forward"
                  >
                    <ChevronRight size={ICON_SIZE} />
                  </button>
                  <button
                    type="button"
                    className="button button-icon"
                    onClick={() => setStartTime(tMax - windowSize)}
                    title="Jump to end"
                  >
                    <ChevronLast size={15} />
                  </button>
                </div>
              </div>

              {/* Window Size: increase/decrease the total visible x-range */}
              <div className="flex flex-col items-center gap-0.5 px-1 pb-1 border-border/50 border-1 border-t-0 rounded-bl-md rounded-br-md">
                <label htmlFor="eeg-window-size" className="text-xs text-foreground/60 select-none">
                  Window Size (s)
                </label>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="button button-icon"
                    onClick={decreaseWindowSize}
                    title="Decrease window size"
                  >
                    <Minus size={ICON_SIZE} />
                  </button>
                  <input
                    id="eeg-window-size"
                    type="number"
                    value={windowSizeStr}
                    min={1}
                    style={{ width: inputWidth(windowSizeStr) }}
                    max={tMax}
                    onChange={onWindowSizeChange}
                    onBlur={onWindowSizeBlur}
                    className="text-center border border-border rounded px-1 py-0.5 text-sm bg-background text-foreground [appearance:textfield]"
                    aria-label="Window size (s)"
                  />
                  <button
                    type="button"
                    className="button button-icon"
                    onClick={increaseWindowSize}
                    title="Increase window size"
                  >
                    <Plus size={ICON_SIZE} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Persistent electrode-position dropzone — always available once EEG is loaded,
            not just buried in the topography popup. Overwrites whatever positions are
            currently active (fsaverage_1005, or a file loaded via any of the other entry
            points) — onElecPosFile has no "only if empty" guard. */}
        <FileDropZone
          onFiles={(files) => {
            const all = Array.from(files);
            const invFile = all.findLast((f) =>
              INV_SOLUTIONS_EXTENSIONS.some((ext) => f.name.toLowerCase().endsWith(ext))
            );
            if (invFile) onInverseSolutionFile?.(invFile);
            const elecFile = all.findLast((f) =>
              ELEC_POS_EXTENSIONS.some((ext) => f.name.toLowerCase().endsWith(ext))
            );
            if (elecFile) onElecPosFile?.(elecFile);

            // Anything that isn't an electrode-position or inverse-solution file (e.g. an
            // imaging volume meant for the Neuroimaging panel) would otherwise be silently
            // swallowed here — surface it instead of leaving the user to wonder why
            // nothing happened.
            const recognizedExtensions = [...ELEC_POS_EXTENSIONS, ...INV_SOLUTIONS_EXTENSIONS];
            const unsupported = all.filter(
              (f) => !recognizedExtensions.some((ext) => f.name.toLowerCase().endsWith(ext))
            );
            if (unsupported.length > 0) {
              toast.error(
                `Unsupported file${unsupported.length > 1 ? 's' : ''}: ${unsupported
                  .map((f) => f.name)
                  .join(
                    ', '
                  )}\nExpected electrode positions (.elc, .tsv) or an inverse solution (.mat).`
              );
            }
          }}
          accepted_formats=".elc,.tsv,.mat"
          label="Browse or drop electrode positions / inverse solution"
          compact
          className="shrink-0 mb-2 mt-1"
        >
          {/* Makes it clear whether a custom electrode-position/inverse-solution file is
              currently active, rather than leaving the user to guess from the dropzone alone
              (which shows no state of its own in compact mode). shrink-0 keeps this block at
              its natural size instead of being squeezed as the panel is resized narrower. */}
          <div className="flex flex-col items-start gap-1 pr-2 mr-1 border-r border-border/50 text-[10px] text-foreground/60 shrink-0">
            <StatusLed
              label="Electrode Position"
              fileName={customElecPosFileName}
              matchCount={electrodePositionMatchCount}
              totalCount={electrodePositionTotalCount}
              isGoodMatch={isElectrodePositionMatchGoodForLed}
              highlighted={hoveredLedHighlight === 'electrodePosition'}
            />
            <StatusLed
              label="Inverse Solution"
              fileName={inverseSolutionFileName}
              matchCount={esiChannelMatchCount}
              totalCount={esiChannelTotalCount}
              isGoodMatch={isEsiChannelMatchGoodForLed}
              matchIssue={
                esiSeegChannelNames.length > 0
                  ? "Alert: some required channels don't have EEG type"
                  : undefined
              }
              highlighted={hoveredLedHighlight === 'inverseSolution'}
            />
          </div>
        </FileDropZone>

        {/* Resize handle — drag down to grow the EEG plot area past flex size, drag up to shrink back.
          Once it reaches the row's natural flex size, further upward dragging has no effect,
          since min-height never shrinks a flex item below what it'd render at anyway. See handleCanvasResizeStart*/}
        <div
          data-testid="eeg-plot-resize-handle"
          className="h-1.5 w-full shrink-0 cursor-row-resize rounded-sm select-none bg-border hover:bg-secondary active:bg-primary"
          title="Drag to resize the EEG plot area"
          onMouseDown={handleResizeStart}
        />
      </div>

      {/* Floating topography viewer — position:fixed so it overlays the whole page */}
      {topoVisible && (
        <EegTopoViewer
          nvRef={nvRef_eegtopo}
          electrodes={electrodes}
          matched={eegMesh.matched}
          voltages={eegMesh.voltages}
          channelNames={channelNames}
          channelTypes={channelTypes}
          voltagesByChannel={topoVoltagesByChannel}
          totalChannels={eegChannelCount}
          onClose={() => setTopoEnabled(false)}
          onTopoNvReady={onTopoNvReady}
          isStandardElectrodes={isStandardElectrodes}
          onElecPosFile={onElecPosFile}
          customFileName={customElecPosFileName}
          isIntracranial={majorityIsSeeg}
          hasEegChannels={hasEegChannels}
        />
      )}

      {/* Floating EEG Montage Editor — position:fixed so it overlays the whole page */}
      {montageVisible && (
        <EegMontageEditor
          electrodes={electrodes}
          matched={matched}
          voltages={topoVoltages}
          channelNames={channelNames}
          voltagesByChannel={topoVoltagesByChannel}
          totalChannels={channelNames.length}
          onClose={() => setMontageVisible(false)}
          onTopoNvReady={onTopoNvReady}
          isStandardElectrodes={isStandardElectrodes}
          onElecPosFile={onElecPosFile}
          customFileName={customElecPosFileName}
          channelSettings={channelSettings}
          onApplyChannelSettings={applyChannelSettings}
          montageChannels={montageChannels}
          onApplyMontageChannels={applyMontageChannels}
        />
      )}
    </>
  );
};
