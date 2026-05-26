import { useRef, useState, useEffect, useMemo } from 'react';
import UplotReact from 'uplot-react';
import 'uplot/dist/uPlot.min.css';
import { useTheme } from '@/components/ThemeContext';
import { ZoomIn, ZoomOut, ChevronRight, ChevronLeft, ChevronLast, ChevronFirst, Plus, Minus, ListChevronsUpDown , ListChevronsDownUp  } from 'lucide-react';
import { minMaxDownsample } from '@/utils/downsample';

const Y_AXIS_WIDTH = 60; // px for the y-axis area (channel name + tick space) — must match x-axis strip left padding
const PLOT_RIGHT_PAD = 20; // px right padding — must match in both channel plots and x-axis strip so ticks align

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
  const axisColor = isDarkMode ? 'rgba(255, 255, 255, 0.8)' : 'rgba(0, 0, 0, 0.8)';
  const gridColor = isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';
  const stroke =  isDarkMode ? 'rgb(255, 255, 255)' : 'rgba(0, 0, 0, 0.8)';

  return {
    width,
    height,
    // All plots share the same syncKey — panning/zooming one moves all others
    cursor: { sync: { key: syncKey } },
    scales: {
      x: { time: false, range: [startTime, startTime + windowSize] },
      y: { range: [-yScale, yScale] },
    },
    axes: [
      { show: false },
      {
        stroke: axisColor,
        size: Y_AXIS_WIDTH,
        grid: { stroke: gridColor },
        filter: () => [],
      },
    ],
    series: [{}, { stroke, width: 1 }],
    legend: { show: false },
    padding: [4, PLOT_RIGHT_PAD, 4, 0],
  };
};

export const EegViewer = ({ data, channelNames }) => {
  const { isDarkMode } = useTheme();
  const syncKey = 'eeg-sync'; // shared across all channels to link their interactions
  // the following refs do not cause re-renders when updated
  const containerRef = useRef(null); // channel plot panel — measures both plot width and available height
  const scrubberRef = useRef(null);  // attached to the bar div — used to measure its pixel width
  const dragRef = useRef(null);      // stores active drag state — null when not dragging
  const rafRef = useRef(null);       // stores the pending requestAnimationFrame id so we can cancel it
  const resizeDebounceRef = useRef(null); // debounces ResizeObserver to avoid rebuilding charts on every resize pixel
  const hasMeasuredRef = useRef(false);   // true after the first ResizeObserver measurement
  // the following states on the other hand do cause re-renders when updated
  const [plotWidth, setPlotWidth] = useState(0); // passed to uPlot options to fill the space
  const [channelAreaHeight, setChannelAreaHeight] = useState(0); // used to compute per-channel plot height
  const [visibleChannelCount, setVisibleChannelCount] = useState(20); // how many channels fit in view at once
  const [visibleChannelCountStr, setVisibleChannelCountStr] = useState('20');
  const tMax = data[0][data[0].length - 1]; // total time span of the recording, from the time values in the first row
  const [windowSize, setWindowSize] = useState(tMax < 20 ? Math.ceil(tMax) : 20); // seconds visible in the x-range, initialized to 20s or the full recording if shorter
  const [windowSizeStr, setWindowSizeStr] = useState(String(tMax < 20 ? Math.ceil(tMax) : 20));
  const [startTime, setStartTime] = useState(0); // start of the visible x-range
  const [shiftTimeStepSize, setShiftTimeStepSize] = useState(5);
  const [shiftTimeStepSizeStr, setShiftTimeStepSizeStr] = useState('5');
  const [yScale, setYScale] = useState(10); // y-axis half-range in µV; all channels share this
  const [yScaleStr, setYScaleStr] = useState('10'); // separate state for the input string to allow temporary invalid states (e.g. empty string while editing) without breaking the numeric yScale used for plotting
  const [isDragging, setIsDragging] = useState(false); // true while the scrubber thumb is being dragged, so it stays highlighted
  // Clamp the visible channel count to a valid range whenever channelNames or the count changes
  const clampChannelCount = (n) => Math.max(1, Math.min(channelNames.length, n));
  // Whenever on of the control variables changes, ensure it is still valid and update the input string to match
  const updateYScale = (newVal) => {
    const clamped = Math.max(1, Math.round(newVal));
    setYScale(clamped);
    setYScaleStr(String(clamped));
  };
  const updateWindowSize = (newVal) => {
    const clamped = Math.max(1, Math.round(newVal * 10) / 10);
    setWindowSize(clamped);
    setWindowSizeStr(String(clamped));
  };
  const updateShiftTimeStepSize = (newVal) => {
    const clamped = Math.max(1, Math.round(newVal));
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

  // Downsample each channel for the visible window.
  // Re-runs only when the window or plot dimensions change, not on every render.
  const sampledData = useMemo(() => {
    if (plotWidth === 0) return null;
    const endTime = startTime + windowSize;
    return channelNames.map((_, i) =>
      minMaxDownsample(data[0], data[i + 1], startTime, endTime, plotWidth)
    );
  }, [data, startTime, windowSize, plotWidth, channelNames]);

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
          setWindowSize(r10(Math.max(1, Math.min(tMax - st, sw + dt))));
        } else if (type === 'resize-left') {
          const newStart = r10(Math.max(0, Math.min(st + sw - 1, st + dt)));
          setStartTime(newStart);
          setWindowSize(r10(st + sw - newStart));
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
    e.preventDefault();   // stops text selection during drag
    e.stopPropagation();  // stops the event bubbling up to the bar's own onMouseDown
    dragRef.current = { type, startX: e.clientX, startTime, startWindowSize: windowSize };
    setIsDragging(true);
  };

  const increaseWindowSize = () => updateWindowSize(Math.floor(windowSize) + 1);
  const decreaseWindowSize = () => updateWindowSize(Math.max(1, Math.floor(windowSize) - 1));

  const forwardshiftStartTime = () => {
    setStartTime((start) => Math.min(tMax - windowSize, start + shiftTimeStepSize));
  };
  const backwardshiftStartTime = () => {
    setStartTime((start) => Math.max(0, start - shiftTimeStepSize));
  };

  return (
    // h-full fills the flex column in PatientView; flex-col stacks the plot row above the controls
    <div className="w-full h-full flex flex-col">
      {/* Plot row: sidebar + channel plots side by side; flex-1 so controls sit below */}
      <div className="flex-1 min-h-0 flex flex-row">
        {/* Left sidebar: justify-center now centers against the channel area height only */}
        <div className="shrink-0 flex flex-col items-center justify-center gap-1 px-1">
          <button
            type="button"
            className="thin-button"
            onClick={() => updateVisibleChannelCount(visibleChannelCount - 1)}
          >
            <ListChevronsDownUp size={22} />
          </button>
          <input
            type="number"
            value={visibleChannelCountStr}
            min={1}
            max={channelNames.length}
            style={{ width: `calc(${Math.max(3, visibleChannelCountStr.length + 2)}ch + 0.5rem)` }}
            onChange={(e) => {
              setVisibleChannelCountStr(e.target.value);
              const val = Number(e.target.value);
              if (e.target.value !== '' && !isNaN(val)) setVisibleChannelCount(clampChannelCount(Math.round(val)));
            }}
            onBlur={() => updateVisibleChannelCount(Number(visibleChannelCountStr) || visibleChannelCount)}
            className="text-center border border-border rounded px-1 py-0.5 text-sm bg-background text-foreground [appearance:textfield]"
            aria-label="Number of channels displayed"
          />
          <button
            type="button"
            className="thin-button"
            onClick={() => updateVisibleChannelCount(visibleChannelCount + 1)}
          >
            <ListChevronsUpDown  size={22} />
          </button>
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
                  <div key={name} style={{ height: plotHeight, overflow: 'hidden' }} className="relative">
                    <span
                      className="absolute left-0 top-1/2 -translate-y-1/2 text-xs text-center pointer-events-none z-10 px-0.5 truncate"
                      style={{ width: Y_AXIS_WIDTH }}
                    >
                      {name}
                    </span>
                    <UplotReact
                      options={buildChannelOptions({
                        channelIndex: i,
                        totalChannels: channelNames.length,
                        isDarkMode,
                        syncKey,
                        width: plotWidth,
                        height: plotHeight,
                        windowSize,
                        startTime,
                        yScale,
                      })}
                      data={sampledData ? sampledData[i] : [data[0], data[i + 1]]}
                      onCreate={() => {}}
                      onDelete={() => {}}
                    />
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
                  axes: [
                    { stroke: axisColor, size: 40, grid: { show: false } },
                    { show: false },
                  ],
                  series: [{}],
                  legend: { show: false },
                  padding: [0, PLOT_RIGHT_PAD, 0, Y_AXIS_WIDTH],
                }}
                data={[data[0]]}
                onCreate={() => {}}
                onDelete={() => {}}
              />
            </div>
          )}

          {/* Timeline scrubber: thumb position = startTime, thumb width = windowSize */}
          {plotWidth > 0 && (
            <div className="shrink-0 py-2" style={{ width: plotWidth, paddingLeft: Y_AXIS_WIDTH, paddingRight: PLOT_RIGHT_PAD }}>
              <div
                ref={scrubberRef}
                data-testid="timeline-scrubber"
                className="relative h-3 bg-surface cursor-pointer"
                onMouseDown={(e) => {
                  const bar = scrubberRef.current.getBoundingClientRect();
                  const ratio = (e.clientX - bar.left) / bar.width;
                  setStartTime(Math.max(0, Math.min(tMax - windowSize, ratio * tMax - windowSize / 2)));
                }}
              >
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
                    className="absolute left-0 w-0.5 cursor-ew-resize"
                    style={{ top: '-4px', bottom: '-4px', backgroundColor: 'var(--c-secondary)' }}
                    onMouseDown={(e) => startDrag(e, 'resize-left')}
                  />
                  {/* Right resize handle */}
                  <div
                    data-testid="timeline-resize-right"
                    className="absolute right-0 w-0.5 cursor-ew-resize"
                    style={{ top: '-4px', bottom: '-4px', backgroundColor: 'var(--c-secondary)' }}
                    onMouseDown={(e) => startDrag(e, 'resize-right')}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Gain: shrink/expand the shared y-range (all channels) */}    
      {/* shrink-0 pins the controls at the bottom, never squeezed by the channel area */}
      <div className="shrink-0 flex flex-wrap justify-center gap-4 py-2">
        <div className="flex flex-col items-center gap-0.5">
          <label htmlFor="eeg-gain"
          className="text-xs text-foreground/60">Gain (µV)</label>
          <div className="flex items-center gap-1">
            <button type="button" className="thin-button" onClick={() => updateYScale(yScale * 2)}>
              <ZoomOut size={22} />
            </button>
            <input
              id="eeg-gain"
              type="number"
              value={yScaleStr}
              min={1}
              style={{ width: `calc(${Math.max(3, yScaleStr.length + 2)}ch + 0.5rem)` }}
              onChange={(e) => {
                setYScaleStr(e.target.value);
                const val = Number(e.target.value);
                if (e.target.value !== '' && !isNaN(val)) setYScale(Math.max(1, val));
              }}
              onBlur={() => updateYScale(Number(yScaleStr) || yScale)}
              className="text-center border border-border rounded px-1 py-0.5 text-sm bg-background text-foreground [appearance:textfield]"
              aria-label="Gain (µV)"
            />
            <button type="button" className="thin-button" onClick={() => updateYScale(yScale / 2)}>
              <ZoomIn size={22} />
            </button>
          </div>
        </div>

        {/* Time Shift: move the x-range forward/backward by a user-defined step */}
        <div className="flex flex-col items-center gap-0.5">
          <label htmlFor="eeg-time-shift-step" className="text-xs text-foreground/60">Time Shift (s)</label>
          <div className="flex items-center gap-1">
            <button type="button" className="thin-button" onClick={() => setStartTime(0)}>
              <ChevronFirst size={16} />
            </button>
            <button type="button" className="thin-button" onClick={backwardshiftStartTime}>
              <ChevronLeft size={22} />
            </button>
            <input
              id="eeg-time-shift-step"
              type="number"
              value={shiftTimeStepSizeStr}
              style={{ width: `calc(${Math.max(3, shiftTimeStepSizeStr.length + 2)}ch + 0.5rem)` }}
              onChange={(e) => {
                setShiftTimeStepSizeStr(e.target.value);
                const val = Number(e.target.value);
                if (e.target.value !== '' && !isNaN(val)) setShiftTimeStepSize(Math.max(1, Math.round(val)));
              }}
              onBlur={() => updateShiftTimeStepSize(Number(shiftTimeStepSizeStr) || shiftTimeStepSize)}
              className="text-center border border-border rounded px-1 py-0.5 text-sm bg-background text-foreground [appearance:textfield]"
              aria-label="Time shift step (s)"
            />
            <button type="button" className="thin-button" onClick={forwardshiftStartTime}>
              <ChevronRight size={22} />
            </button>
            <button
              type="button"
              className="thin-button"
              onClick={() => setStartTime(data[0][data[0].length - 1] - windowSize)}
            >
              <ChevronLast size={16} />
            </button>
          </div>
        </div>

        {/* Window Size: increase/decrease the total visible x-range */}
        <div className="flex flex-col items-center gap-0.5">
          <label htmlFor="eeg-window-size" className="text-xs text-foreground/60">Window Size (s)</label>
          <div className="flex items-center gap-1">
            <button type="button" className="thin-button" onClick={decreaseWindowSize}>
              <Minus size={22} />
            </button>
            <input
              id="eeg-window-size"
              type="number"
              value={windowSizeStr}
              min={1}
              style={{ width: `calc(${Math.max(3, windowSizeStr.length + 2)}ch + 0.5rem)` }}
              onChange={(e) => {
                setWindowSizeStr(e.target.value);
                const val = Number(e.target.value);
                if (e.target.value !== '' && !isNaN(val) && val > 0) setWindowSize(Math.max(1, val));
              }}
              onBlur={() => updateWindowSize(Number(windowSizeStr) || windowSize)}
              className="text-center border border-border rounded px-1 py-0.5 text-sm bg-background text-foreground [appearance:textfield]"
              aria-label="Window size (s)"
            />
            <button type="button" className="thin-button" onClick={increaseWindowSize}>
              <Plus size={22} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
