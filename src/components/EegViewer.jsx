import { useMemo, useRef, useState, useEffect } from 'react';
import UplotReact from 'uplot-react';
import 'uplot/dist/uPlot.min.css';
import { useTheme } from '@/components/ThemeContext';

const PLOT_HEIGHT = 90; // px per channel row

// Builds uPlot options for a single channel. Called once per channel on each render.
const buildChannelOptions = ({
  channelName,
  channelIndex,
  totalChannels,
  isDarkMode,
  syncKey,
  width,
  isLastChannel,
}) => {
  const axisColor = isDarkMode ? 'rgba(255, 255, 255, 0.8)' : 'rgba(0, 0, 0, 0.8)';
  const gridColor = isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';
  // Spread hues evenly across channels so each has a distinct colour
  const stroke = `hsl(${(channelIndex * 360) / totalChannels}, 70%, 55%)`;

  return {
    width,
    height: PLOT_HEIGHT,
    // All plots share the same syncKey — panning/zooming one moves all others
    cursor: { sync: { key: syncKey } },
    scales: { x: { time: false } },
    axes: [
      // x-axis label and ticks only shown on the bottom plot to save space
      {
        show: isLastChannel,
        stroke: axisColor,
        label: isLastChannel ? 'Time (s)' : undefined,
        grid: { stroke: gridColor },
      },
      { label: channelName, stroke: axisColor, size: 60, grid: { stroke: gridColor } },
    ],
    series: [{}, { stroke, width: 1 }],
    legend: { show: false },
  };
};

export const EegViewer = ({ data, channelNames }) => {
  const { isDarkMode } = useTheme();
  const syncKey = 'eeg-sync'; // shared across all channels to link their interactions
  const containerRef = useRef(null); // used to measure available width for responsive resizing
  const [plotWidth, setPlotWidth] = useState(0); // passed to uPlot options to fill the space

  useEffect(() => {
    if (!containerRef.current) return;
    // ResizeObserver fires whenever the container changes size and updates plotWidth,
    // which causes uPlot to redraw at the correct pixel width
    const observer = new ResizeObserver((entries) => {
      setPlotWidth(Math.floor(entries[0].contentRect.width)); // floor avoids sub-pixel artefacts
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    // w-full fills the grid column; px-4 adds side margins; ref lets ResizeObserver measure it
    <div ref={containerRef} className="w-full px-4">
      {/* Wait for the first measurement before rendering — avoids zero-width flash */}
      {plotWidth > 0 &&
        channelNames.map((name, i) => (
          <UplotReact
            key={name}
            options={buildChannelOptions({
              channelName: name,
              channelIndex: i,
              totalChannels: channelNames.length,
              isDarkMode,
              syncKey,
              width: plotWidth,
              isLastChannel: i === channelNames.length - 1,
            })}
            data={[data[0], data[i + 1]]}
            onCreate={() => {}}
            onDelete={() => {}}
          />
        ))}
    </div>
  );
};
