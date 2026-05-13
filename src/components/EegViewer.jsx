import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

const CHANNEL_SPACING = 150; // vertical distance between channels in µV units

function buildSeries(channelNames) {
  return [
    { label: 'Time' },
    ...channelNames.map((name, i) => ({
      label: name,
      stroke: `hsl(${(i * 360) / channelNames.length}, 70%, 55%)`,
      width: 1,
    })),
  ];
}

function offsetChannels(data) {
  // data[0] = timestamps, data[1..n] = channel signals
  // offset each channel so they appear stacked vertically
  return [
    data[0],
    ...data.slice(1).map((ch, i) => ch.map((v) => v - i * CHANNEL_SPACING)),
  ];
}

export const EegViewer = ({ data, channelNames, width = 800 }) => {
  const containerRef = useRef(null);
  const plotRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !data || data.length < 2) return;

    const opts = {
      width,
      height: channelNames.length * 80 + 40,
      series: buildSeries(channelNames),
      scales: {
        x: { time: false },
        y: { auto: true },
      },
      axes: [
        { label: 'Time (s)' },
        { label: 'Amplitude (µV)', size: 60 },
      ],
      cursor: { drag: { x: true, y: false } },
      legend: { show: true },
    };

    plotRef.current = new uPlot(opts, offsetChannels(data), containerRef.current);

    return () => {
      plotRef.current?.destroy();
      plotRef.current = null;
    };
  }, [data, channelNames, width]);

  return <div ref={containerRef} />;
};
