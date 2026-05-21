import { useRef, useState, useEffect, useMemo } from 'react';
import UplotReact from 'uplot-react';
import 'uplot/dist/uPlot.min.css';
import { useTheme } from '@/components/ThemeContext';
import { minMaxDownsample } from '@/utils/downsample';

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
  const stroke = `hsl(${(channelIndex * 360) / totalChannels}, 70%, 55%)`;

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
        size: 60,
        grid: { stroke: gridColor },
        filter: () => [],
      },
    ],
    series: [{}, { stroke, width: 1 }],
    legend: { show: false },
    padding: [4, 0, 4, 0],
  };
};

export const EegViewer = ({ data, channelNames }) => {
  const { isDarkMode } = useTheme();
  const syncKey = 'eeg-sync'; // shared across all channels to link their interactions
  const containerRef = useRef(null); // channel plot panel — measures both plot width and available height
  const [plotWidth, setPlotWidth] = useState(0); // passed to uPlot options to fill the space
  const [channelAreaHeight, setChannelAreaHeight] = useState(0); // used to compute per-channel plot height
  const [visibleChannelCount, setVisibleChannelCount] = useState(20); // how many channels fit in view at once
  const tMax = data[0][data[0].length - 1]; // total time span of the recording, from the time values in the first row
  const [windowSize, setWindowSize] = useState(tMax < 20 ? Math.ceil(tMax) : 20); // seconds visible in the x-range, initialized to 20s or the full recording if shorter
  const [startTime, setStartTime] = useState(0); // start of the visible x-range
  const [shiftTimeStepSize, setShiftTimeStepSize] = useState(5);
  const [yScale, setYScale] = useState(100); // y-axis half-range in µV; all channels share this

  const clampChannelCount = (n) => Math.max(1, Math.min(channelNames.length, n));
  const X_AXIS_HEIGHT = 55; // px reserved for the fixed x-axis strip below the scroll area
  const plotHeight =
    channelAreaHeight > 0 ? Math.floor(channelAreaHeight / visibleChannelCount) : 0;
  const axisColor = isDarkMode ? 'rgba(255, 255, 255, 0.8)' : 'rgba(0, 0, 0, 0.8)';

  // Downsample each channel to 2×plotWidth points for the visible window.
  // Re-runs only when the window or plot dimensions change, not on every render.
  const sampledData = useMemo(() => {
    if (plotWidth === 0) return null;
    const endTime = startTime + windowSize;
    const target = plotWidth * 2;
    return channelNames.map((_, i) =>
      minMaxDownsample(data[0], data[i + 1], startTime, endTime, target)
    );
  }, [data, startTime, windowSize, plotWidth, channelNames]);

  useEffect(() => {
    // ResizeObserver fires whenever the container changes size and updates plotWidth/channelAreaHeight,
    // which causes uPlot to redraw at the correct pixel dimensions
    // Single observer on containerRef gives both width (for plot sizing) and height (for plotHeight)
    const observer = new ResizeObserver(([entry]) => {
      setPlotWidth(Math.floor(entry.contentRect.width)); // floor avoids sub-pixel artefacts
      setChannelAreaHeight(Math.floor(entry.contentRect.height));
    });
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const increaseWindowSize = () => {
    setWindowSize((size) => size + 1);
  };
  const decreaseWindowSize = () => {
    setWindowSize((size) => Math.max(1, size - 1));
  };

  const forwardshiftStartTime = () => {
    setStartTime((start) => start + shiftTimeStepSize);
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
          <span className="text-xs">Ch.</span>
          <button
            type="button"
            className="thin-button"
            onClick={() => setVisibleChannelCount((n) => clampChannelCount(n - 1))}
          >
            −
          </button>
          <input
            type="number"
            value={visibleChannelCount}
            min={1}
            max={channelNames.length}
            onChange={(e) => setVisibleChannelCount(clampChannelCount(Number(e.target.value)))}
            className="w-12 text-center border border-border rounded px-1 py-0.5 text-sm bg-background text-foreground"
            aria-label="Number of channels displayed"
          />
          <button
            type="button"
            className="thin-button"
            onClick={() => setVisibleChannelCount((n) => clampChannelCount(n + 1))}
          >
            +
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
              className="absolute inset-0 overflow-y-auto"
              style={{ scrollbarGutter: 'stable' }}
            >
              {/* Wait for first measurements before rendering — avoids zero-size flash */}
              {plotWidth > 0 &&
                plotHeight > 0 &&
                channelNames.map((name, i) => (
                  <div key={name} style={{ height: plotHeight, overflow: 'hidden' }} className="relative">
                    <span
                      className="absolute left-0 top-1/2 -translate-y-1/2 text-xs text-center pointer-events-none z-10 px-0.5 truncate"
                      style={{ width: 60 }}
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
                    { stroke: axisColor, label: 'Time (s)', size: 50, grid: { show: false } },
                    { show: false },
                  ],
                  series: [{}],
                  legend: { show: false },
                  padding: [0, 0, 0, 60],
                }}
                data={[data[0]]}
                onCreate={() => {}}
                onDelete={() => {}}
              />
            </div>
          )}
        </div>
      </div>

      {/* shrink-0 pins the controls at the bottom, never squeezed by the channel area */}
      <div className="shrink-0 flex flex-wrap justify-center gap-4 py-2">
        {/* Zoom: shrink/expand the shared y-range (all channels) */}
        <div className="flex items-center gap-1">
          <button type="button" className="thin-button" onClick={() => setYScale((s) => s * 1.5)}>
            −
          </button>
          <span className="text-sm px-1">Zoom</span>
          <button type="button" className="thin-button" onClick={() => setYScale((s) => s / 1.5)}>
            +
          </button>
        </div>

        {/* Shift: move the x-range forward/backward by a user-defined step */}
        <div className="flex items-center gap-1">
          <button type="button" className="thin-button" onClick={() => setStartTime(0)}>
            {'|<'}
          </button>
          <button type="button" className="thin-button" onClick={backwardshiftStartTime}>
            {'<'}
          </button>
          <input
            type="number"
            value={shiftTimeStepSize}
            onChange={(e) => setShiftTimeStepSize(Math.max(1, Number(e.target.value)))}
            className="w-16 text-center border border-border rounded px-1 py-0.5 text-sm bg-background text-foreground"
            aria-label="Shift step (s)"
          />
          <button type="button" className="thin-button" onClick={forwardshiftStartTime}>
            {'>'}
          </button>
          <button
            type="button"
            className="thin-button"
            onClick={() => setStartTime(data[0][data[0].length - 1] - windowSize)}
          >
            {'>|'}
          </button>
        </div>

        {/* Window: increase/decrease the total visible x-range */}
        <div className="flex items-center gap-1">
          <button type="button" className="thin-button " onClick={decreaseWindowSize}>
            −
          </button>
          <input
            type="number"
            value={windowSize}
            min={1}
            onChange={(e) => setWindowSize(Math.max(1, Number(e.target.value)))}
            className="w-16 text-center border border-border rounded px-1 py-0.5 text-sm bg-background text-foreground"
            aria-label="Window size (s)"
          />
          <button type="button" className="thin-button" onClick={increaseWindowSize}>
            +
          </button>
        </div>
      </div>
    </div>
  );
};
