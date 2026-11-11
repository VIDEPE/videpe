import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useTimepointSnapshot } from '@/hooks/useTimepointSnapshot';
import { filterChannelsAtSample } from '@/utils/eegFilters';

// Two channels, 4 samples each, fs=1 so timestamps double as sample indices. Deliberately
// not simple linear ramps — a constant-offset pair like [1,2,3,4]/[5,6,7,8] average-
// references to the SAME result at every sample index, which would let an index-selection
// bug (e.g. clamping to the wrong sample) slip through undetected.
const timestamps = [0, 1, 2, 3];
const channels = [
  [1, 3, 6, 10], // channel 0
  [2, 8, 5, 40], // channel 1
];
// Per-sample cross-channel mean: [1.5, 5.5, 5.5, 25]. Average-referenced (channel - mean):
//   channel 0: [-0.5, -2.5, 0.5, -15]
//   channel 1: [ 0.5,  2.5, -0.5, 15]
// The hook takes the average from these values itself (after filtering), over the non-bad channels.
const matched = [{ channelIdx: 0 }, { channelIdx: 1 }];
const channelNames = ['CH1', 'CH2'];
const channelTypes = ['eeg', 'eeg'];
const badChannelFlags = [false, false];

// All filters off, so the tests above the 'filtering' describe see the plain referenced values
const OFF = { highPass: null, lowPass: null, notch: null };
const NO_FILTERS = { eeg: OFF, seeg: OFF, other: OFF };

const setup = (overrides = {}) =>
  renderHook((props) => useTimepointSnapshot(props), {
    initialProps: {
      channels,
      badChannelFlags,
      globalFilters: NO_FILTERS,
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

describe('useTimepointSnapshot — average referencing', () => {
  it('has no voltages before channels load, even with a clicked timepoint', () => {
    const { result } = setup({ channels: null, topoTimepoint: 2 });
    expect(result.current.topoVoltages).toEqual([]);
    expect(result.current.topoVoltagesByChannel).toEqual([]);
  });

  it('always applies average referencing, unconditionally', () => {
    for (const [timepoint, expected] of [
      [0, [-0.5, 0.5]],
      [1, [-2.5, 2.5]],
      [2, [0.5, -0.5]],
      [3, [-15, 15]],
    ]) {
      const { result } = setup({ topoTimepoint: timepoint });
      expect(result.current.topoVoltagesByChannel).toEqual(expected);
    }
  });

  it('leaves bad channels out of the average', () => {
    // channel 1 is bad, so the average is channel 0 alone: [6, 5] - 6
    const { result } = setup({ badChannelFlags: [false, true], topoTimepoint: 2 });
    expect(result.current.topoVoltagesByChannel).toEqual([0, -1]);
  });

  it('uses the raw voltages when every channel is bad (there is no average)', () => {
    const { result } = setup({ badChannelFlags: [true, true], topoTimepoint: 2 });
    expect(result.current.topoVoltagesByChannel).toEqual([6, 5]);
  });
});

describe('useTimepointSnapshot — filtering', () => {
  // 20 s at 256 Hz, with large and different DC offsets per channel, like real EEG
  const fs = 256;
  const n = 20 * fs;
  const longTimestamps = Array.from({ length: n }, (_, i) => i / fs);
  const longChannels = [
    Array.from({ length: n }, (_, i) => 1000 + Math.sin((2 * Math.PI * 10 * i) / fs)),
    Array.from({ length: n }, (_, i) => -500 + 2 * Math.sin((2 * Math.PI * 7 * i) / fs)),
  ];
  const filters = { ...NO_FILTERS, eeg: { highPass: 0.5, lowPass: 40, notch: 50 } };
  const timepoint = 10; // seconds → sample index 2560
  const sampleIndex = timepoint * fs;

  // filtered per channel, then referenced to the average of the (non-bad) filtered values
  const expectedVoltages = (types) => {
    const filtered = filterChannelsAtSample(longChannels, sampleIndex, types, filters, fs);
    const average = (filtered[0] + filtered[1]) / 2;
    return filtered.map((value) => value - average);
  };

  const setupLong = (overrides = {}) =>
    setup({
      channels: longChannels,
      timestamps: longTimestamps,
      fs,
      globalFilters: filters,
      topoTimepoint: timepoint,
      ...overrides,
    });

  it('filters each channel with the global filters of its type before referencing', () => {
    const { result } = setupLong();
    const expected = expectedVoltages(['eeg', 'eeg']);
    result.current.topoVoltagesByChannel.forEach((value, index) =>
      expect(value).toBeCloseTo(expected[index], 10)
    );
    // the DC offsets are filtered out, so the values stay small (raw CAR would give ±750)
    result.current.topoVoltagesByChannel.forEach((value) =>
      expect(Math.abs(value)).toBeLessThan(5)
    );
  });

  it('leaves a channel of a type without filters raw before referencing', () => {
    const { result } = setupLong({ channelTypes: ['eeg', 'seeg'] });
    const expected = expectedVoltages(['eeg', 'seeg']);
    result.current.topoVoltagesByChannel.forEach((value, index) =>
      expect(value).toBeCloseTo(expected[index], 10)
    );
  });

  it('passes the filtered voltages to onChannelSnapshotChange', () => {
    const onChannelSnapshotChange = vi.fn();
    setupLong({ onChannelSnapshotChange });
    const expected = expectedVoltages(['eeg', 'eeg']);
    const { voltages } = onChannelSnapshotChange.mock.calls.at(-1)[0];
    voltages.forEach((value, index) => expect(value).toBeCloseTo(expected[index], 10));
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
      badChannelFlags,
      globalFilters: NO_FILTERS,
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
      badChannelFlags,
      globalFilters: NO_FILTERS,
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

  it('re-fires onChannelSnapshotChange when globalFilters changes (e.g. Apply in the filter window), even with topoTimepoint unchanged', () => {
    const onChannelSnapshotChange = vi.fn();
    const { rerender } = setup({ onChannelSnapshotChange, topoTimepoint: 2 });
    expect(onChannelSnapshotChange).toHaveBeenCalledTimes(1);

    rerender({
      channels,
      badChannelFlags,
      globalFilters: { ...NO_FILTERS, eeg: { ...OFF, lowPass: 0.4 } }, // new filter settings
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

    expect(onChannelSnapshotChange).toHaveBeenCalledTimes(2);
  });

  it('re-fires onChannelSnapshotChange when badChannelFlags changes, even with topoTimepoint unchanged', () => {
    const onChannelSnapshotChange = vi.fn();
    const { rerender } = setup({ onChannelSnapshotChange, topoTimepoint: 2 });
    expect(onChannelSnapshotChange).toHaveBeenCalledTimes(1);

    rerender({
      channels,
      badChannelFlags: [false, true], // channel 1 marked bad
      globalFilters: NO_FILTERS,
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

    expect(onChannelSnapshotChange).toHaveBeenCalledTimes(2);
    expect(onChannelSnapshotChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ voltages: [0, -1] }) // average of channel 0 alone
    );
  });

  it('does NOT re-fire onChannelSnapshotChange on a buffer refresh alone (deliberately not a dependency)', () => {
    // Documented behavior: refiring on every buffer refresh would cause cascading
    // re-renders that interrupt EegTopoViewer's async mesh load — it only fires on clicks.
    const onChannelSnapshotChange = vi.fn();
    const { rerender } = setup({ onChannelSnapshotChange, topoTimepoint: 2 });
    expect(onChannelSnapshotChange).toHaveBeenCalledTimes(1);

    // A new channels buffer (e.g. panning/zooming the plot) — same shape of change
    // useTimepointSnapshot sees on every buffer reload, but topoTimepoint itself is unchanged.
    const refreshedChannels = [
      [10, 20, 30, 40],
      [50, 60, 70, 80],
    ];
    rerender({
      channels: refreshedChannels,
      badChannelFlags,
      globalFilters: NO_FILTERS,
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
