import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useTimepointSnapshot } from '@/hooks/useTimepointSnapshot';
import { computeReferenceSeries } from '@/utils/eegViewerUtils';

// Two channels, 4 samples each, fs=1 so timestamps double as sample indices. Deliberately
// not simple linear ramps — a constant-offset pair like [1,2,3,4]/[5,6,7,8] average-
// references to the SAME result at every sample index, which would let an index-selection
// bug (e.g. clamping to the wrong sample) slip through undetected.
const timestamps = [0, 1, 2, 3];
const channels = [
  [1, 3, 6, 10], // channel 0
  [2, 8, 5, 40], // channel 1
];
// Per-sample cross-channel mean: [1.5, 5.5, 5.5, 25]. montagedChannels (channel - mean):
//   channel 0: [-0.5, -2.5, 0.5, -15]
//   channel 1: [ 0.5,  2.5, -0.5, 15]
// The caller (EegViewer.jsx) computes this once from non-bad channels and passes it in —
// this hook no longer computes its own average, so tests need a real series.
const referenceSeries = computeReferenceSeries(channels);
const matched = [{ channelIdx: 0 }, { channelIdx: 1 }];
const channelNames = ['CH1', 'CH2'];
const channelTypes = ['eeg', 'eeg'];

const setup = (overrides = {}) =>
  renderHook((props) => useTimepointSnapshot(props), {
    initialProps: {
      channels,
      referenceSeries,
      topoTimepoint: null,
      timestamps,
      fs: 1,
      matched,
      channelNames,
      channelTypes,
      isIntracranial: false,
      onElectrodeSnapshotChange: vi.fn(),
      onChannelSnapshotChange: vi.fn(),
      ...overrides,
    },
  });

describe('useTimepointSnapshot — montagedChannels', () => {
  it('is null before channels load', () => {
    const { result } = setup({ channels: null });
    expect(result.current.montagedChannels).toBeNull();
  });

  it('always applies average referencing, unconditionally', () => {
    const { result } = setup();
    expect(result.current.montagedChannels[0]).toEqual([-0.5, -2.5, 0.5, -15]);
    expect(result.current.montagedChannels[1]).toEqual([0.5, 2.5, -0.5, 15]);
  });

  it('returns the raw channels unchanged when referenceSeries has no average (e.g. every channel is bad)', () => {
    const { result } = setup({ referenceSeries: { average: null, median: null } });
    expect(result.current.montagedChannels).toEqual(channels);
  });
});

describe('useTimepointSnapshot — voltage snapshots', () => {
  it('topoVoltages/topoVoltagesByChannel are empty before any timepoint is clicked', () => {
    const { result } = setup({ topoTimepoint: null });
    expect(result.current.topoVoltages).toEqual([]);
    expect(result.current.topoVoltagesByChannel).toEqual([]);
  });

  it('extracts one voltage per matched electrode at the clicked timepoint', () => {
    const { result } = setup({ topoTimepoint: 2 }); // sample index 2
    expect(result.current.topoVoltages).toEqual([0.5, -0.5]); // montagedChannels[.][2]
  });

  it('extracts one voltage per channel (not position-gated) at the same timepoint', () => {
    const { result } = setup({ topoTimepoint: 1, matched: [] }); // no position matches
    expect(result.current.topoVoltagesByChannel).toEqual([-2.5, 2.5]); // still populated
    expect(result.current.topoVoltages).toEqual([]); // gated by matched.length
  });

  it('clamps the sample index to the last timestamp for an out-of-range timepoint', () => {
    const { result } = setup({ topoTimepoint: 999 });
    expect(result.current.topoVoltages).toEqual([-15, 15]); // last sample (index 3)
  });
});

describe('useTimepointSnapshot — lifted snapshots', () => {
  it('calls onElectrodeSnapshotChange on mount, regardless of topoTimepoint', () => {
    const onElectrodeSnapshotChange = vi.fn();
    setup({ onElectrodeSnapshotChange, topoTimepoint: null });
    expect(onElectrodeSnapshotChange).toHaveBeenCalledWith({
      isIntracranial: false,
      matched,
      voltages: [],
    });
  });

  it('re-calls onElectrodeSnapshotChange when the voltage snapshot changes', () => {
    const onElectrodeSnapshotChange = vi.fn();
    const { rerender } = setup({ onElectrodeSnapshotChange, topoTimepoint: null });
    onElectrodeSnapshotChange.mockClear();

    rerender({
      channels,
      referenceSeries,
      topoTimepoint: 2,
      timestamps,
      fs: 1,
      matched,
      channelNames,
      channelTypes,
      isIntracranial: false,
      onElectrodeSnapshotChange,
      onChannelSnapshotChange: vi.fn(),
    });

    expect(onElectrodeSnapshotChange).toHaveBeenCalledWith({
      isIntracranial: false,
      matched,
      voltages: [0.5, -0.5],
    });
  });

  it('does not call onChannelSnapshotChange before any topoTimepoint click', () => {
    const onChannelSnapshotChange = vi.fn();
    setup({ onChannelSnapshotChange, topoTimepoint: null });
    expect(onChannelSnapshotChange).not.toHaveBeenCalled();
  });

  it('calls onChannelSnapshotChange with the full per-channel snapshot when topoTimepoint is set', () => {
    const onChannelSnapshotChange = vi.fn();
    setup({ onChannelSnapshotChange, topoTimepoint: 2 });
    expect(onChannelSnapshotChange).toHaveBeenCalledWith({
      isIntracranial: false,
      channelNames,
      channelTypes,
      voltages: [0.5, -0.5],
    });
  });

  it('re-fires onChannelSnapshotChange when channelTypes changes (e.g. a montage-editor edit), even with topoTimepoint unchanged', () => {
    const onChannelSnapshotChange = vi.fn();
    const { rerender } = setup({ onChannelSnapshotChange, topoTimepoint: 2 });
    expect(onChannelSnapshotChange).toHaveBeenCalledTimes(1);

    rerender({
      channels,
      referenceSeries,
      topoTimepoint: 2, // unchanged
      timestamps,
      fs: 1,
      matched,
      channelNames,
      channelTypes: ['seeg', 'eeg'], // channel 0's type flipped
      isIntracranial: false,
      onElectrodeSnapshotChange: vi.fn(),
      onChannelSnapshotChange,
    });

    expect(onChannelSnapshotChange).toHaveBeenCalledTimes(2);
    expect(onChannelSnapshotChange).toHaveBeenLastCalledWith({
      isIntracranial: false,
      channelNames,
      channelTypes: ['seeg', 'eeg'],
      voltages: [0.5, -0.5],
    });
  });

  it('does NOT re-fire onChannelSnapshotChange on a buffer refresh alone (deliberately not a dependency)', () => {
    // Documented behavior: refiring on every buffer refresh would cause cascading
    // re-renders that interrupt EegTopoViewer's async mesh load — it only fires on clicks.
    const onChannelSnapshotChange = vi.fn();
    const { rerender } = setup({ onChannelSnapshotChange, topoTimepoint: 2 });
    expect(onChannelSnapshotChange).toHaveBeenCalledTimes(1);

    // A new channels buffer (e.g. panning/zooming the plot) with a freshly computed
    // referenceSeries — same shape of change useTimepointSnapshot sees on every buffer
    // reload, but topoTimepoint itself is unchanged.
    const refreshedChannels = [
      [10, 20, 30, 40],
      [50, 60, 70, 80],
    ];
    rerender({
      channels: refreshedChannels,
      referenceSeries: computeReferenceSeries(refreshedChannels),
      topoTimepoint: 2, // unchanged
      timestamps,
      fs: 1,
      matched,
      channelNames,
      channelTypes,
      isIntracranial: false,
      onElectrodeSnapshotChange: vi.fn(),
      onChannelSnapshotChange,
    });

    expect(onChannelSnapshotChange).toHaveBeenCalledTimes(1); // still just the one call
  });
});
