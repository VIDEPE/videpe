import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useTimepointSnapshot } from '@/hooks/useTimepointSnapshot';
import { computeReferenceSeries } from '@/utils/eegViewerUtils';

// Two channels, 4 samples each, fs=1 so timestamps double as sample indices.
const timestamps = [0, 1, 2, 3];
const channels = [
  [1, 2, 3, 4], // channel 0
  [5, 6, 7, 8], // channel 1
];
// The caller (EegViewer.jsx) computes this once from non-bad channels and passes it in —
// this hook no longer computes its own average/median, so tests need a real series to
// exercise the 'average'/'median' montage cases.
const referenceSeries = computeReferenceSeries(channels);
const matched = [{ channelIdx: 0 }, { channelIdx: 1 }];
const channelNames = ['CH1', 'CH2'];

const setup = (overrides = {}) =>
  renderHook((props) => useTimepointSnapshot(props), {
    initialProps: {
      channels,
      montage: 'none',
      referenceSeries,
      topoTimepoint: null,
      timestamps,
      fs: 1,
      matched,
      channelNames,
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

  it('passes raw values through under the none montage', () => {
    const { result } = setup({ montage: 'none' });
    expect(result.current.montagedChannels).toEqual(channels);
  });

  it('applies average referencing under the average montage', () => {
    // Per-sample cross-channel mean: [3,4,5,6] → CH1 becomes [1-3,2-4,3-5,4-6] = [-2,-2,-2,-2]
    const { result } = setup({ montage: 'average' });
    expect(result.current.montagedChannels[0]).toEqual([-2, -2, -2, -2]);
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
    expect(result.current.topoVoltages).toEqual([3, 7]); // CH1[2]=3, CH2[2]=7
  });

  it('extracts one voltage per channel (not position-gated) at the same timepoint', () => {
    const { result } = setup({ topoTimepoint: 1, matched: [] }); // no position matches
    expect(result.current.topoVoltagesByChannel).toEqual([2, 6]); // still populated
    expect(result.current.topoVoltages).toEqual([]); // gated by matched.length
  });

  it('clamps the sample index to the last timestamp for an out-of-range timepoint', () => {
    const { result } = setup({ topoTimepoint: 999 });
    expect(result.current.topoVoltages).toEqual([4, 8]); // last sample (index 3)
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
      montage: 'none',
      referenceSeries,
      topoTimepoint: 2,
      timestamps,
      fs: 1,
      matched,
      channelNames,
      isIntracranial: false,
      onElectrodeSnapshotChange,
      onChannelSnapshotChange: vi.fn(),
    });

    expect(onElectrodeSnapshotChange).toHaveBeenCalledWith({
      isIntracranial: false,
      matched,
      voltages: [3, 7],
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
      voltages: [3, 7],
    });
  });

  it('does NOT re-fire onChannelSnapshotChange when only the montage changes (deliberately not a dependency)', () => {
    // Documented behavior: refiring on every buffer/montage change would cause cascading
    // re-renders that interrupt EegTopoViewer's async mesh load — it only fires on clicks.
    const onChannelSnapshotChange = vi.fn();
    const { rerender } = setup({ onChannelSnapshotChange, topoTimepoint: 2, montage: 'none' });
    expect(onChannelSnapshotChange).toHaveBeenCalledTimes(1);

    rerender({
      channels,
      montage: 'average', // changed
      referenceSeries,
      topoTimepoint: 2, // unchanged
      timestamps,
      fs: 1,
      matched,
      channelNames,
      isIntracranial: false,
      onElectrodeSnapshotChange: vi.fn(),
      onChannelSnapshotChange,
    });

    expect(onChannelSnapshotChange).toHaveBeenCalledTimes(1); // still just the one call
  });
});
