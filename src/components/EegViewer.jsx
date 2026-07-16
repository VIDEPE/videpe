import { useRef, useState, useEffect, useMemo } from 'react';
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
} from 'lucide-react';
import { minMaxDownsample } from '@/utils/downsample';
import { useEegBuffer } from '@/loaders/eegBuffer';
import { applyMontage } from '@/utils/eegViewerUtils';

import { parseElcElectrodePositions } from '@/loaders/parseElcElectrodePositions';
import { ELEC_POS_EXTENSIONS, INV_SOLUTIONS_EXTENSIONS } from '@/loaders/eegFormats';
import { matchChannelsToPositions } from '@/utils/eegTopographyUtils';
import { detectIsIntracranial } from '@/utils/intracranialDetection';
import { EegTopoViewer } from '@/components/EegTopoViewer';
import { FileDropZone } from '@/components/FileDropZone';

const EEG_LOADING_TOAST_ID = 'eeg-buffer-loading'; // fixed id so the loading/success toasts update in place rather than stacking
const RECORDING_TYPE_TOAST_ID = 'eeg-recording-type-detected'; // fixed id so re-detection updates the toast in place instead of stacking
const Y_AXIS_WIDTH = 60; // px for the y-axis area (channel name + tick space) — must match x-axis strip left padding
const PLOT_RIGHT_PAD = 20; // px right padding — must match in both channel plots and x-axis strip so ticks align
const OVERDRAW = 2; // canvas height multiplier — peaks bleed ±50% into adjacent lanes instead of clipping
const MIN_PLOT_HEIGHT = 12; // minimum px per channel lane — prevents uPlot from collapsing at high channel counts
const MIN_CHANNEL_AREA_HEIGHT = 120; // px floor for the channel-plot scroll area. Below this the whole viewer overflows and the pane's scroll container takes over (mirrors NiiViewer's MIN_CANVAS_HEIGHT) instead of letting the x-axis/scrubber/controls/dropzone overlap
const ICON_SIZE = 22; // default size for lucide icons in the controls, used to compute input widths
const INPUT_MIN_CH = 3; // minimum input width in ch units
const INPUT_EXTRA_CH = 3; // extra ch of breathing room beyond the value's character length
const INPUT_PAD = '0.5rem'; // offsets px-1 padding (box-sizing: border-box shrinks the content area by this amount)
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
}) => {
  const stroke = isDarkMode ? 'rgb(255, 255, 255)' : 'rgba(0, 0, 0, 0.8)';

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
      { show: false },
      { show: false }, // y-axis hidden; left padding below takes its place
    ],
    series: [{}, { stroke, width: 1 }],
    legend: { show: false },
    padding: [0, PLOT_RIGHT_PAD, 0, Y_AXIS_WIDTH], // left padding replaces the hidden y-axis size; 0 top/bottom so overdraw areas aren't consumed by padding
  };
};

// LED-style indicator for whether an optional file (electrode positions, inverse solution)
// is loaded — overlaps the persistent dropzone's clickable area, since that dropzone shows
// no state of its own in compact mode. title carries the filename/reason on hover.
//   • green  — a user file is loaded
//   • blue   — no user file, but the built-in standard_1005 template matched positions
//   • red    — nothing loaded or matched
//   • grey   — disabled: this file type doesn't apply to the current recording mode
//              (e.g. inverse solution in iEEG) — greyed rather than removed so the layout
//              doesn't jump and a loaded-but-unused file doesn't just disappear
const StatusLed = ({ label, fileName, disabled = false, autoMatched = false, autoTitle }) => {
  // isDarkMode is the one source of truth that actually reflects the app's theme toggle.
  const { isDarkMode } = useTheme();
  const isActive = Boolean(fileName);
  const isAuto = !isActive && autoMatched;
  const dotColor = disabled
    ? 'bg-foreground/20'
    : isActive
      ? isDarkMode
        ? 'bg-green-400'
        : 'bg-green-500'
      : isAuto
        ? isDarkMode
          ? 'bg-blue-400'
          : 'bg-blue-500'
        : isDarkMode
          ? 'bg-red-400/70'
          : 'bg-red-500/70';
  // Subtle glow only when on (custom file) or auto-matched — off (red) stays a flat dot
  const glow = disabled
    ? 'none'
    : isActive
      ? isDarkMode
        ? '0 0 4px 1px rgba(74,222,128,0.7)'
        : '0 0 4px 1px rgba(34,197,94,0.7)'
      : isAuto
        ? isDarkMode
          ? '0 0 4px 1px rgba(96,165,250,0.7)'
          : '0 0 4px 1px rgba(59,130,246,0.7)'
        : 'none';
  const title = disabled
    ? `${label} is not applicable for iEEG recordings`
    : isActive
      ? autoTitle
        ? `Custom: ${fileName}`
        : fileName
      : isAuto
        ? autoTitle
        : `No ${label.toLowerCase()} loaded`;
  return (
    <span
      className={cn(
        'flex items-center gap-1.5 leading-none shrink-0 whitespace-nowrap',
        disabled && (isDarkMode ? 'text-foreground/20' : 'text-foreground/40')
      )}
      title={title}
    >
      <span
        className={cn('h-2 w-2 rounded-full shrink-0', dotColor)}
        style={{ boxShadow: glow }}
        aria-hidden="true"
      />
      {label}
    </span>
  );
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
  onElecPosFile,
  onInverseSolutionFile,
  onIntracranialSnapshotChange,
  onChannelSnapshotChange,
  recordingType = 'eeg', // 'eeg' | 'ieeg' — controlled by PatientView, which shows/drives the toggle in the panel title
  onRecordingTypeChange,
  montage = 'none', // 'none' | 'average' | 'median' — controlled by PatientView, which forces 'average' when ESI needs it
  onMontageChange,
}) => {
  const { isDarkMode } = useTheme();
  const syncKey = 'eeg-sync'; // shared across all channels to link their interactions

  // the following refs do not cause re-renders when updated
  const containerRef = useRef(null); // channel plot panel — measures both plot width and available height
  const scrubberRef = useRef(null); // attached to the bar div — used to measure its pixel width
  const dragRef = useRef(null); // stores active drag state — null when not dragging
  const rafRef = useRef(null); // stores the pending requestAnimationFrame id so we can cancel it
  const resizeDebounceRef = useRef(null); // debounces ResizeObserver to avoid rebuilding charts on every resize pixel
  const hasMeasuredRef = useRef(false); // true after the first ResizeObserver measurement

  // the following states on the other hand do cause re-renders when updated
  const [plotWidth, setPlotWidth] = useState(0); // passed to uPlot options to fill the space
  const [channelAreaHeight, setChannelAreaHeight] = useState(0); // used to compute per-channel plot height

  const defaultVisibleChannelCount = 20;
  const [visibleChannelCount, setVisibleChannelCount] = useState(defaultVisibleChannelCount); // how many channels fit in view at once
  const [visibleChannelCountStr, setVisibleChannelCountStr] = useState(
    String(defaultVisibleChannelCount)
  );

  const tMax = provider.tMax; // total time span of the recording, in seconds
  // Max input lengths — prevents the boxes from accepting absurdly long strings that warp the layout.
  // Window/shift allow one decimal place so get +2 (dot + digit); range and channels are integers.
  const CHANNEL_INPUT_MAX_LENGTH = String(channelNames.length).length; // enough to display the max channel count, e.g. "128"
  const WINDOW_INPUT_MAX_LENGTH = String(Math.ceil(tMax)).length + 2; // enough to display the max window size (tMax) with a comma + 1 decimal
  const SHIFT_INPUT_MAX_LENGTH = 6; // covers up to 9999.9 s
  const Y_INPUT_MAX_LENGTH = 5; // covers 0.0001 to 99999 µV
  const Y_MAX = 10 ** Y_INPUT_MAX_LENGTH - 1; // 99999 — derived from Y_INPUT_MAX_LENGTH so both stay in sync
  const Y_MIN = 10 ** -(Y_INPUT_MAX_LENGTH - 2); // 0.001 minimum range (with Y_INPUT_MAX_LENGTH char length) to prevent uPlot from breaking with a zero or negative y-range

  // Default to showing the full recording if it's shorter than 20s, otherwise start with a
  // 20s window. For a short recording, floor tMax to 1 decimal: this keeps the window ≤ tMax
  // (a window LARGER than the recording made the scrubber thumb exceed 100% and overflow to
  // the right, dragging in a horizontal scrollbar) AND matches the 1-decimal value the input
  // snaps to on blur, so a non-integer tMax (e.g. 6.01171875s) shows a clean "6" not the full
  // float. floor (not round) so rounding can never nudge it back above tMax.
  const defaultWindowSize = tMax < 20 ? Math.floor(tMax * 10) / 10 : 20;
  const [windowSize, setWindowSize] = useState(defaultWindowSize); // seconds visible in the x-range, initialized to 20s or the full recording if shorter
  const [windowSizeStr, setWindowSizeStr] = useState(String(defaultWindowSize));

  const [startTime, setStartTime] = useState(0); // start of the visible x-range
  const defaultShiftTimeStepSize = 5;
  const [shiftTimeStepSize, setShiftTimeStepSize] = useState(defaultShiftTimeStepSize);
  const [shiftTimeStepSizeStr, setShiftTimeStepSizeStr] = useState(
    String(defaultShiftTimeStepSize)
  );

  const defaultYScale = 0.15;
  const [yScale, setYScale] = useState(defaultYScale); // y-axis half-range in µV; all channels share this
  const [yScaleStr, setYScaleStr] = useState(String(defaultYScale)); // separate state for the input string to allow temporary invalid states (e.g. empty string while editing) without breaking the numeric yScale used for plotting
  const [isDragging, setIsDragging] = useState(false); // true while the scrubber thumb is being dragged, so it stays highlighted
  // Clamp the visible channel count to a valid range whenever channelNames or the count changes
  const maxChannelsByHeight =
    channelAreaHeight > 0 ? Math.floor(channelAreaHeight / MIN_PLOT_HEIGHT) : channelNames.length;
  const clampChannelCount = (n) =>
    Math.max(1, Math.min(channelNames.length, maxChannelsByHeight, n));
  // Whenever on of the control variables changes, ensure it is still valid and update the input string to match
  const updateYScale = (newVal) => {
    const rounded_newVal =
      Math.round(newVal * 10 ** (Y_INPUT_MAX_LENGTH - 2)) / 10 ** (Y_INPUT_MAX_LENGTH - 2);
    const clamped = Math.max(Y_MIN, Math.min(Y_MAX, rounded_newVal));
    setYScale(clamped);
    setYScaleStr(String(clamped));
  };
  const updateWindowSize = (newVal) => {
    const clamped = Math.round(Math.min(tMax, Math.max(1, newVal)) * 10) / 10;
    setWindowSize(clamped);
    setWindowSizeStr(String(clamped));
    // If the new window size would push the right edge past tMax, pull startTime back
    setStartTime((prev) => Math.max(0, Math.min(prev, tMax - clamped)));
    // Shift step must never exceed window size — clamp it down if needed
    if (shiftTimeStepSize > clamped) {
      setShiftTimeStepSize(clamped);
      setShiftTimeStepSizeStr(String(clamped));
    }
  };
  const updateShiftTimeStepSize = (newVal) => {
    const clamped = Math.max(1, Math.min(windowSize, Math.round(newVal * 10) / 10));
    setShiftTimeStepSize(clamped);
    setShiftTimeStepSizeStr(String(clamped));
  };
  const updateVisibleChannelCount = (newVal) => {
    const clamped = clampChannelCount(Math.round(newVal));
    setVisibleChannelCount(clamped);
    setVisibleChannelCountStr(String(clamped));
  };
  const X_AXIS_HEIGHT = 45; // px reserved for the fixed x-axis strip below the scroll area
  const plotHeight =
    channelAreaHeight > 0 ? Math.floor(channelAreaHeight / visibleChannelCount) : 0;
  const axisColor = isDarkMode ? 'rgba(255, 255, 255, 0.8)' : 'rgba(0, 0, 0, 0.8)';

  // Buffer of EEG data around the visible window — reloads on big jumps, otherwise
  // keeps the previous buffer's data on screen until the new one arrives (no flash).
  const { timestamps, channels, isLoading } = useEegBuffer(provider, startTime, windowSize);

  // ── Topography / recording-type state ───────────────────────────────────────
  const [topoVisible, setTopoVisible] = useState(false);
  const [topoTimepoint, setTopoTimepoint] = useState(null);
  // Detection-only — always holds the standard_1005 template + its match against
  // channelNames, used purely as input to detectIsIntracranial. Never used to
  // render the topography itself (that's customElectrodes' job — see below).
  const [standard1005Electrodes, setStandard1005Electrodes] = useState([]);
  const [standard1005Matched, setStandard1005Matched] = useState([]);

  // Fetch the built-in electrode position template, match it against the recording's
  // channel names (for detection purposes only), then (re-)detect the recording type
  // and report it upward — PatientView owns recordingType and shows/drives the
  // EEG/iEEG toggle in the panel title, since this component no longer renders it
  // itself. Re-runs whenever channelNames changes (new recording loaded).
  useEffect(() => {
    fetch('electrode_positions/standard_1005.elc')
      .then((r) => r.text())
      .then((text) => {
        const { electrodes: parsedElectrodes } = parseElcElectrodePositions(text);
        setStandard1005Electrodes(parsedElectrodes);
        setStandard1005Matched(matchChannelsToPositions(channelNames, parsedElectrodes).matched);
        const detected = detectIsIntracranial(channelNames, parsedElectrodes) ? 'ieeg' : 'eeg';
        onRecordingTypeChange?.(detected);
        toast(detected === 'ieeg' ? 'iEEG recording detected' : 'EEG recording detected', {
          id: RECORDING_TYPE_TOAST_ID,
          icon: '🔍',
        });
      })
      .catch(() => {}); // silently ignore if file unavailable (e.g. in tests without the asset)
  }, [channelNames, onRecordingTypeChange]);

  const isIntracranial = recordingType === 'ieeg';

  // Channels matched against the custom electrode positions (if any) — independent
  // of mode, since intracranial recordings need this for the 3D connectome too.
  const customMatched = useMemo(
    () => matchChannelsToPositions(channelNames, customElectrodes).matched,
    [channelNames, customElectrodes]
  );

  // Render-facing electrodes/matched. Scalp mode falls back to the standard_1005
  // template when no custom file is loaded (today's behavior); intracranial mode
  // never falls back to it — standard_1005 simply doesn't apply to depth probes.
  const usingCustom = isIntracranial || customElectrodes.length > 0;
  const electrodes = usingCustom ? customElectrodes : standard1005Electrodes;
  const matched = usingCustom ? customMatched : standard1005Matched;
  const isStandardElectrodes = !isIntracranial && customElectrodes.length === 0;

  // Apply the selected montage once, shared by the channel plots and the topography snapshot
  const montagedChannels = useMemo(() => {
    if (!channels) return null;
    return applyMontage(channels, montage);
  }, [channels, montage]);

  // Sample index shared by both voltage snapshots below.
  const topoSampleIndex = useMemo(() => {
    if (topoTimepoint === null || !timestamps?.length) return null;
    return Math.max(
      0,
      Math.min(timestamps.length - 1, Math.round((topoTimepoint - timestamps[0]) * provider.fs))
    );
  }, [topoTimepoint, timestamps, provider.fs]);

  // Extract one voltage per matched channel at the clicked timepoint — drives the
  // scalp mesh and the intracranial 3D connectome (both need real x/y/z positions).
  const topoVoltages = useMemo(() => {
    if (topoSampleIndex === null || !montagedChannels || !matched.length) return [];
    return matched.map((m) => montagedChannels[m.channelIdx]?.[topoSampleIndex] ?? 0);
  }, [topoSampleIndex, montagedChannels, matched]);

  // Extract one voltage per channel (not just position-matched ones) at the same
  // timepoint — drives the intracranial matrix, which has no position-file gate.
  const topoVoltagesByChannel = useMemo(() => {
    if (topoSampleIndex === null || !montagedChannels) return [];
    return montagedChannels.map((ch) => ch?.[topoSampleIndex] ?? 0);
  }, [topoSampleIndex, montagedChannels]);

  // Lift the live electrode/voltage state up so PatientView can build the
  // intracranial connectome layer for the Neuroimaging pane — fires regardless of
  // whether the topography window itself is open, since the connectome auto-shows.
  useEffect(() => {
    onIntracranialSnapshotChange?.({ isIntracranial, matched, voltages: topoVoltages });
  }, [isIntracranial, matched, topoVoltages, onIntracranialSnapshotChange]);

  // Lift all-channel voltages for ESI — fires only when topoTimepoint changes (i.e. on
  // user clicks), NOT on every buffer refresh. Depending on topoVoltagesByChannel would
  // also fire whenever timestamps shift during buffer loads, causing rapid cascading
  // re-renders that supersede EegTopoViewer's async mesh load and leave it stuck loading.
  useEffect(() => {
    if (topoTimepoint === null || !montagedChannels || !timestamps?.length) return;
    const sampleIndex = Math.max(
      0,
      Math.min(timestamps.length - 1, Math.round((topoTimepoint - timestamps[0]) * provider.fs))
    );
    const voltages = montagedChannels.map((ch) => ch?.[sampleIndex] ?? 0);
    onChannelSnapshotChange?.({ isIntracranial, channelNames, voltages });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topoTimepoint, isIntracranial, channelNames, onChannelSnapshotChange]);

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

  // Downsample the montaged buffer for the visible window
  const displayedData = useMemo(() => {
    // If we don't have valid dimensions or data yet, return empty arrays for each channel to avoid rendering broken plots
    const empty = channelNames.map(() => [[], []]);
    if (plotWidth === 0 || !timestamps || timestamps.length === 0 || !montagedChannels)
      return empty;

    const endTime = startTime + windowSize;
    return channelNames.map((_, i) =>
      minMaxDownsample(timestamps, montagedChannels[i], startTime, endTime, plotWidth)
    );
  }, [timestamps, montagedChannels, channelNames, startTime, windowSize, plotWidth]);

  useEffect(() => {
    // ResizeObserver fires whenever the container changes size and updates plotWidth/channelAreaHeight,
    // which causes uPlot to redraw at the correct pixel dimensions
    // Single observer on containerRef gives both width (for plot sizing) and height (for plotHeight)
    const observer = new ResizeObserver(([entry]) => {
      const w = Math.floor(entry.contentRect.width);
      const h = Math.floor(entry.contentRect.height);
      if (!hasMeasuredRef.current) {
        // First measurement on mount: update immediately so charts render without delay
        hasMeasuredRef.current = true;
        setPlotWidth(w);
        setChannelAreaHeight(h);
        return;
      }
      // Subsequent changes (e.g. panel drag): debounce so charts only rebuild after resizing stops
      if (resizeDebounceRef.current) clearTimeout(resizeDebounceRef.current);
      resizeDebounceRef.current = setTimeout(() => {
        setPlotWidth(w);
        setChannelAreaHeight(h);
      }, 150);
    });
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Re-clamp channel count whenever the container height changes (e.g. window resize, split-pane drag)
  useEffect(() => {
    updateVisibleChannelCount(visibleChannelCount);
  }, [channelAreaHeight]); // eslint-disable-line react-hooks/exhaustive-deps

  // Signal onViewReady once the first measurement lands and charts have rendered
  const onViewReadyCalledRef = useRef(false);
  useEffect(() => {
    if (plotWidth > 0 && !onViewReadyCalledRef.current) {
      onViewReadyCalledRef.current = true;
      onViewReady?.();
    }
  }, [plotWidth, onViewReady]);

  useEffect(() => {
    const onMouseMove = (e) => {
      if (!dragRef.current || !scrubberRef.current) return;

      // Cancel any frame that was already queued but hasn't run yet.
      // Without this, fast mouse moves would stack up multiple pending updates
      // and they'd all fire in the same frame, doing redundant work.
      if (rafRef.current) cancelAnimationFrame(rafRef.current);

      // Capture clientX immediately — by the time the rAF callback runs,
      // the original event object may be recycled by the browser and clientX would be 0.
      const clientX = e.clientX;

      rafRef.current = requestAnimationFrame(() => {
        if (!dragRef.current || !scrubberRef.current) return;
        const barWidth = scrubberRef.current.offsetWidth;
        const dt = ((clientX - dragRef.current.startX) / barWidth) * tMax;
        const { type, startTime: st, startWindowSize: sw } = dragRef.current;

        const r10 = (v) => Math.round(v * 10) / 10;
        if (type === 'move') {
          setStartTime(r10(Math.max(0, Math.min(tMax - sw, st + dt))));
        } else if (type === 'resize-right') {
          const newSize = r10(Math.max(1, Math.min(tMax - st, sw + dt)));
          setWindowSize(newSize);
          setWindowSizeStr(String(newSize));
        } else if (type === 'resize-left') {
          const newStart = r10(Math.max(0, Math.min(st + sw - 1, st + dt)));
          const newSize = r10(st + sw - newStart);
          setStartTime(newStart);
          setWindowSize(newSize);
          setWindowSizeStr(String(newSize));
        }
      });
    };
    // On mouse up, clear the drag state to stop dragging
    const onMouseUp = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      dragRef.current = null;
      setIsDragging(false);
    };

    // Attach listeners to the window to track mouse movements instead of the scrubber,
    // this allows dragging to continue even if the cursor leaves the scrubber area
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [tMax]);

  const startDrag = (e, type) => {
    e.preventDefault(); // stops text selection during drag
    e.stopPropagation(); // stops the event bubbling up to the bar's own onMouseDown
    dragRef.current = { type, startX: e.clientX, startTime, startWindowSize: windowSize };
    setIsDragging(true);
  };

  const increaseWindowSize = () => updateWindowSize(Math.floor(windowSize) + 10);
  const decreaseWindowSize = () => updateWindowSize(Math.max(1, Math.floor(windowSize) - 10));

  const forwardshiftStartTime = () => {
    setStartTime((start) => Math.min(tMax - windowSize, start + shiftTimeStepSize));
  };
  const backwardshiftStartTime = () => {
    setStartTime((start) => Math.max(0, start - shiftTimeStepSize));
  };

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

  return (
    <>
      {/* h-full fills the flex column in PatientView; flex-col stacks the plot row above the controls */}
      {/* tabIndex + onKeyDown make the viewer keyboard-navigable once focused (see handleKeyDown) */}
      <div
        ref={viewerRef}
        data-testid="eeg-viewer-container"
        className="w-full h-full flex flex-col group/viewer relative focus:outline-solid focus:outline-2 focus:outline-secondary focus:-outline-offset-2"
        tabIndex={0}
        onMouseDown={focusViewer}
        onKeyDown={handleKeyDown}
      >
        {/* Keyboard shortcut hint — bottom-right corner of the viewer pane.
            Uses a custom hover tooltip instead of the native title attribute, since native
            tooltips have a long built-in show delay — long enough that clicking the icon (to
            focus the viewer) often fired before the tooltip ever appeared. */}
        <div className="absolute bottom-12 right-2 z-20 group/tip">
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
        <div className="flex-1 flex flex-row">
          {/* Left sidebar: Channels controls centered in the available height, Montage pinned to the bottom-left corner */}
          <div className="shrink-0 flex flex-col px-1">
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
                    onChange={(e) => {
                      if (e.target.value.length > CHANNEL_INPUT_MAX_LENGTH) return;
                      setVisibleChannelCountStr(e.target.value);
                      const val = Number(e.target.value);
                      if (e.target.value !== '' && !isNaN(val))
                        setVisibleChannelCount(clampChannelCount(Math.round(val)));
                    }}
                    onBlur={() =>
                      updateVisibleChannelCount(
                        Number(visibleChannelCountStr) || visibleChannelCount
                      )
                    }
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
            <div
              className="flex flex-col items-center gap-1 pb-1"
              title="Apply EEG reference montage"
            >
              <span className="text-xs text-foreground select-none pointer-events-none">
                Montage:
              </span>
              <select
                value={montage}
                onChange={(e) => onMontageChange?.(e.target.value)}
                aria-label="Apply EEG reference montage"
                className="bg-background border border-border rounded px-1 py-0.5 text-xs text-heading cursor-pointer"
              >
                <option value="none">None</option>
                <option value="average">Average</option>
                <option value="median">Median</option>
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
                className="absolute inset-0 overflow-y-auto themed-scrollbar"
                title={
                  matched.length > 0 && !topoVisible
                    ? 'Click any channel to view the EEG topography for that time point'
                    : undefined
                }
                style={{ scrollbarGutter: 'stable' }}
              >
                {/* Wait for first measurements before rendering — avoids zero-size flash */}
                {plotWidth > 0 &&
                  plotHeight > 0 &&
                  channelNames.map((name, i) => (
                    <div
                      key={name}
                      style={{
                        height: plotHeight,
                        overflow: 'visible',
                        borderBottom: `1px solid ${isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}`,
                      }}
                      className="relative"
                    >
                      <span
                        className="absolute left-0 top-1/2 -translate-y-1/2 text-xs text-center pointer-events-none select-none z-10 px-0.5 truncate"
                        style={{ width: Y_AXIS_WIDTH }}
                      >
                        {name}
                      </span>
                      {/* Zero-line at y=0, aligned with the plot area (not drawn by uPlot to avoid grid issues) */}
                      <div
                        className="absolute pointer-events-none"
                        style={{
                          top: '50%',
                          left: Y_AXIS_WIDTH,
                          right: PLOT_RIGHT_PAD,
                          height: 1,
                          backgroundColor: isDarkMode
                            ? 'rgba(255,255,255,0.25)'
                            : 'rgba(0,0,0,0.25)',
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
                            channelIndex: i,
                            totalChannels: channelNames.length,
                            isDarkMode,
                            syncKey,
                            width: plotWidth,
                            height: plotHeight * OVERDRAW,
                            windowSize,
                            startTime,
                            yScale,
                          })}
                          data={displayedData[i]}
                          onCreate={(u) => {
                            {
                              /* click listener that converts the click's x-position into a timestamp, sets topoTimepoint, and sets topoVisible = true */
                            }
                            u.over.addEventListener('click', () => {
                              const t = u.posToVal(u.cursor.left, 'x');
                              if (!isNaN(t)) {
                                setTopoTimepoint(t);
                                setTopoVisible(true);
                              }
                            });
                          }}
                          onDelete={() => {}}
                        />
                      </div>
                    </div>
                  ))}
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
                    axes: [{ stroke: axisColor, size: 40, grid: { show: false } }, { show: false }],
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
                    onChange={(e) => {
                      if (e.target.value.length > Y_INPUT_MAX_LENGTH) return;
                      setYScaleStr(e.target.value);
                      const val = Number(e.target.value);
                      if (e.target.value !== '' && !isNaN(val)) setYScale(Math.max(Y_MIN, val));
                    }}
                    onBlur={() => updateYScale(Number(yScaleStr) || yScale)}
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
                    onChange={(e) => {
                      if (e.target.value.length > SHIFT_INPUT_MAX_LENGTH) return;
                      setShiftTimeStepSizeStr(e.target.value);
                      const val = Number(e.target.value);
                      if (e.target.value !== '' && !isNaN(val))
                        setShiftTimeStepSize(
                          Math.max(1, Math.min(windowSize, Math.round(val * 10) / 10))
                        );
                    }}
                    onBlur={() =>
                      updateShiftTimeStepSize(Number(shiftTimeStepSizeStr) || shiftTimeStepSize)
                    }
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
                    onChange={(e) => {
                      if (e.target.value.length > WINDOW_INPUT_MAX_LENGTH) return;
                      setWindowSizeStr(e.target.value);
                      const val = Number(e.target.value);
                      if (e.target.value !== '' && !isNaN(val) && val > 0)
                        setWindowSize(Math.max(1, Math.min(tMax, val)));
                    }}
                    onBlur={() => updateWindowSize(Number(windowSizeStr) || windowSize)}
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
            currently active (standard_1005, or a file loaded via any of the other entry
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
          className="shrink-0 mb-1"
        >
          {/* Makes it clear whether a custom electrode-position/inverse-solution file is
              currently active, rather than leaving the user to guess from the dropzone alone
              (which shows no state of its own in compact mode). shrink-0 keeps this block at
              its natural size instead of being squeezed as the panel is resized narrower. */}
          <div className="flex flex-col items-start gap-1 pr-2 mr-1 border-r border-border/50 text-[10px] text-foreground/60 shrink-0">
            <StatusLed
              label="Electrode Position"
              fileName={customElecPosFileName}
              autoMatched={isStandardElectrodes && standard1005Matched.length > 0}
              autoTitle={`Using standard_1005 template (${standard1005Matched.length}/${channelNames.length} channels matched)`}
            />
            <StatusLed
              label="Inverse Solution"
              fileName={inverseSolutionFileName}
              disabled={isIntracranial}
            />
          </div>
        </FileDropZone>
      </div>

      {/* Floating topography viewer — position:fixed so it overlays the whole page */}
      {topoVisible && (
        <EegTopoViewer
          nvRef={nvRef_eegtopo}
          electrodes={electrodes}
          matched={matched}
          voltages={topoVoltages}
          channelNames={channelNames}
          voltagesByChannel={topoVoltagesByChannel}
          totalChannels={channelNames.length}
          onClose={() => setTopoVisible(false)}
          onTopoNvReady={onTopoNvReady}
          isStandardElectrodes={isStandardElectrodes}
          onElecPosFile={onElecPosFile}
          customFileName={customElecPosFileName}
          montage={montage}
          isIntracranial={isIntracranial}
        />
      )}
    </>
  );
};
