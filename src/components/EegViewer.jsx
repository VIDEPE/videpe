import { useRef, useState, useEffect, useMemo } from 'react';
import UplotReact from 'uplot-react';
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
import { parseElc } from '@/loaders/parseElc';
import { matchChannelsToPositions } from '@/utils/eegTopography';
import { EegTopoViewer } from '@/components/EegTopoViewer';

const EEG_LOADING_TOAST_ID = 'eeg-buffer-loading'; // fixed id so the loading/success toasts update in place rather than stacking
const Y_AXIS_WIDTH = 60; // px for the y-axis area (channel name + tick space) — must match x-axis strip left padding
const PLOT_RIGHT_PAD = 20; // px right padding — must match in both channel plots and x-axis strip so ticks align
const OVERDRAW = 2; // canvas height multiplier — peaks bleed ±50% into adjacent lanes instead of clipping
const MIN_PLOT_HEIGHT = 12; // minimum px per channel lane — prevents uPlot from collapsing at high channel counts
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

export const EegViewer = ({ provider, channelNames, onReady }) => {
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

  const defaultWindowSize = tMax < 20 ? Math.ceil(tMax) : 20; // default to showing the full recording if it's shorter than 20s, otherwise start with a 20s window
  const [windowSize, setWindowSize] = useState(defaultWindowSize); // seconds visible in the x-range, initialized to 20s or the full recording if shorter
  const [windowSizeStr, setWindowSizeStr] = useState(String(defaultWindowSize));

  const [startTime, setStartTime] = useState(0); // start of the visible x-range
  const defaultShiftTimeStepSize = 5;
  const [shiftTimeStepSize, setShiftTimeStepSize] = useState(defaultShiftTimeStepSize);
  const [shiftTimeStepSizeStr, setShiftTimeStepSizeStr] = useState(
    String(defaultShiftTimeStepSize)
  );

  const defaultYScale = 10;
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

  // ── Topography state ────────────────────────────────────────────────────────
  const [topoVisible, setTopoVisible] = useState(false);
  const [topoTimepoint, setTopoTimepoint] = useState(null);
  const [electrodes, setElectrodes] = useState([]);
  const [matched, setMatched] = useState([]);

  // Fetch the built-in electrode position template and match it against the recording's channel names
  useEffect(() => {
    fetch('/electrode_positions/standard_1005.elc')
      .then((r) => r.text())
      .then((text) => {
        const { electrodes: els } = parseElc(text);
        setElectrodes(els);
        setMatched(matchChannelsToPositions(channelNames, els).matched);
      })
      .catch(() => {}); // silently ignore if file unavailable (e.g. in tests without the asset)
  }, [channelNames]);

  // Extract one voltage per matched channel from the buffer at the clicked timepoint
  const topoVoltages = useMemo(() => {
    if (topoTimepoint === null || !timestamps?.length || !channels || !matched.length) return [];
    const idx = Math.max(
      0,
      Math.min(timestamps.length - 1, Math.round((topoTimepoint - timestamps[0]) * provider.fs))
    );
    return matched.map((m) => channels[m.channelIdx]?.[idx] ?? 0);
  }, [topoTimepoint, timestamps, channels, matched, provider.fs]);

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

  // Downsample each channel for the visible window.
  // Re-runs only when the window, buffer, or plot dimensions change, not on every render.
  const downSampledData = useMemo(() => {
    // If we don't have valid dimensions or data yet, return empty arrays for each channel to avoid rendering broken plots
    const empty = channelNames.map(() => [[], []]);
    if (plotWidth === 0 || !timestamps || timestamps.length === 0) return empty;

    const endTime = startTime + windowSize;
    // No overlap between the buffered chunk and the visible window — can happen mid-reload
    // after a big jump (Home/End, distant scrubber drag). Show an empty plot until the new
    // buffer (covering the new window) arrives.
    if (timestamps[timestamps.length - 1] < startTime || timestamps[0] > endTime) return empty;
    return channelNames.map((_, i) =>
      minMaxDownsample(timestamps, channels[i], startTime, endTime, plotWidth)
    );
  }, [timestamps, channels, startTime, windowSize, plotWidth, channelNames]);

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

  // Signal onReady once the first measurement lands and charts have rendered
  const onReadyCalledRef = useRef(false);
  useEffect(() => {
    if (plotWidth > 0 && !onReadyCalledRef.current) {
      onReadyCalledRef.current = true;
      onReady?.();
    }
  }, [plotWidth, onReady]);

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
        className="w-full h-full flex flex-col group relative focus:outline-solid focus:outline-2 focus:outline-secondary focus:-outline-offset-2"
        tabIndex={0}
        onMouseDown={focusViewer}
        onKeyDown={handleKeyDown}
      >
        {/* Keyboard shortcut hint — bottom-right corner of the viewer pane */}
        <div
          className="absolute bottom-2 right-2 z-20 text-foreground/40 hover:text-foreground/80 group-focus:text-secondary transition-colors"
          title={
            'Click the EEG viewer to enable keyboard navigation (blue outline when active):\n' +
            '· ↑/↓\t\tRange adjustment up/down\n' +
            '· ←/→\t     Move a time step back/forward\n' +
            '· Space\t   Jump a time window forward\n' +
            '· Page ↑/↓       Jump a time window back/forward\n' +
            '· Home/End   Jump to start/end'
          }
        >
          <Keyboard size={16} />
        </div>
        {/* Plot row: sidebar + channel plots side by side; flex-1 so controls sit below */}
        <div className="flex-1 min-h-0 flex flex-row">
          {/* Left sidebar: justify-center now centers against the channel area height only */}
          <div className="shrink-0 flex flex-row items-center gap-1 px-1">
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
                  updateVisibleChannelCount(Number(visibleChannelCountStr) || visibleChannelCount)
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

          {/* flex-col so the scroll area and fixed x-axis strip stack vertically */}
          <div className="flex-1 min-w-0 flex flex-col">
            {/* relative wrapper: sized by flex layout, never by content */}
            <div className="flex-1 min-h-0 relative">
              {/* containerRef is on the scroll div itself: absolute inset-0 fixes its size so
                content can never inflate it. scrollbar-gutter:stable always reserves the scrollbar
                lane so contentRect.width is stable and no horizontal scrollbar ever appears */}
              <div
                ref={containerRef}
                className="absolute inset-0 overflow-y-auto themed-scrollbar"
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
                          data={downSampledData[i]}
                          onCreate={(u) => {
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
                  {/* Timeline thumb */}
                  <div
                    data-testid="timeline-thumb"
                    style={{
                      left: `${(startTime / tMax) * 100}%`,
                      width: `${(windowSize / tMax) * 100}%`,
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
            {/* shrink-0 pins the controls at the bottom, never squeezed by the channel area */}
            <div className="shrink-0 flex flex-wrap justify-center gap-4 py-2">
              <div className="flex flex-col items-center gap-0.5">
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
              <div className="flex flex-col items-center gap-0.5">
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
              <div className="flex flex-col items-center gap-0.5">
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
      </div>

      {/* Floating topography viewer — position:fixed so it overlays the whole page */}
      {topoVisible && (
        <EegTopoViewer
          electrodes={electrodes}
          matched={matched}
          voltages={topoVoltages}
          totalChannels={channelNames.length}
          onClose={() => setTopoVisible(false)}
        />
      )}
    </>
  );
};
