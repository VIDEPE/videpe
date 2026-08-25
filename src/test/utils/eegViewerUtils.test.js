import { describe, it, expect } from 'vitest';
import {
  computeReferenceSeries,
  applyReferenceSeries,
  buildMontageDisplayRows,
  deriveMontageRowSamples,
  compareChannelNamesNaturally,
} from '@/utils/eegViewerUtils';

// ---------------------------------------------------------------------------
// computeReferenceSeries
// ---------------------------------------------------------------------------

describe('computeReferenceSeries', () => {
  it('computes the per-sample cross-channel mean as the average series', () => {
    // 3 channels, 3 samples. Per sample, mean across channels is [3, 4, 5].
    const channels = [
      [1, 2, 3],
      [3, 4, 5],
      [5, 6, 7],
    ];
    const { average } = computeReferenceSeries(channels);
    expect(average).toEqual([3, 4, 5]);
  });

  it('computes the per-sample cross-channel median as the median series (odd channel count)', () => {
    // 3 channels, 2 samples. Sample 0 values: [1,2,3] → median 2. Sample 1: [10,20,30] → median 20.
    const channels = [
      [1, 10],
      [2, 20],
      [3, 30],
    ];
    const { median } = computeReferenceSeries(channels);
    expect(median).toEqual([2, 20]);
  });

  it('computes the median as the average of the two middle values (even channel count)', () => {
    // 4 channels, 1 sample. Median of [1, 2, 3, 4] = 2.5.
    const channels = [[1], [2], [3], [4]];
    const { median } = computeReferenceSeries(channels);
    expect(median[0]).toBeCloseTo(2.5);
  });

  it('the median series is robust to an outlier channel', () => {
    // Without the outlier, median of [1,2,3] = 2. Median of [1,2,3,1000] = 2.5, not pulled to 1000.
    const channels = [[1], [2], [3], [1000]];
    const { median } = computeReferenceSeries(channels);
    expect(median[0]).toBeCloseTo(2.5);
  });

  it('handles a single channel (average and median both equal that channel)', () => {
    const { average, median } = computeReferenceSeries([[42, 7]]);
    expect(average).toEqual([42, 7]);
    expect(median).toEqual([42, 7]);
  });

  it('returns null for both series when there are no channels to reference against', () => {
    expect(computeReferenceSeries([])).toEqual({ average: null, median: null });
  });

  it('does not mutate the input', () => {
    const channels = [
      [1, 2],
      [3, 4],
    ];
    computeReferenceSeries(channels);
    expect(channels).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });
});

// ---------------------------------------------------------------------------
// applyReferenceSeries
// ---------------------------------------------------------------------------

describe('applyReferenceSeries', () => {
  it('subtracts the series from every channel elementwise', () => {
    const channels = [
      [1, 2, 3],
      [3, 4, 5],
      [5, 6, 7],
    ];
    const series = [3, 4, 5]; // the average series for the channels above
    const out = applyReferenceSeries(channels, series);
    expect(out[0]).toEqual([-2, -2, -2]);
    expect(out[1]).toEqual([0, 0, 0]);
    expect(out[2]).toEqual([2, 2, 2]);
  });

  it('each sample sums to (approximately) zero across channels when the series is their own average', () => {
    const channels = [
      [1, 2, 3],
      [4, 5, 6],
      [10, 1, 8],
    ];
    const { average } = computeReferenceSeries(channels);
    const out = applyReferenceSeries(channels, average);
    for (let iSamp = 0; iSamp < 3; iSamp++) {
      const sum = out.reduce((acc, chan) => acc + chan[iSamp], 0);
      expect(sum).toBeCloseTo(0);
    }
  });

  it('returns the channels unchanged when the series is null (nothing to reference against)', () => {
    const channels = [
      [1, 2],
      [3, 4],
    ];
    expect(applyReferenceSeries(channels, null)).toBe(channels);
  });

  it('does not mutate the input', () => {
    const channels = [
      [1, 2],
      [3, 4],
    ];
    applyReferenceSeries(channels, [1, 1]);
    expect(channels).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });
});

// ---------------------------------------------------------------------------
// buildMontageDisplayRows
// ---------------------------------------------------------------------------

describe('buildMontageDisplayRows', () => {
  const channelNames = ['EEG1', 'EEG2', 'EEG3'];
  const noneBad = { EEG1: { bad: false }, EEG2: { bad: false }, EEG3: { bad: false } };

  it('falls back to one row per non-bad channel, in order, when there are no montage rows', () => {
    const rows = buildMontageDisplayRows(channelNames, noneBad, []);
    expect(rows).toEqual([
      {
        id: 'EEG1',
        name: 'EEG1',
        channelIndex: 0,
        referenceIndex: null,
        referenceMode: null,
        color: null,
      },
      {
        id: 'EEG2',
        name: 'EEG2',
        channelIndex: 1,
        referenceIndex: null,
        referenceMode: null,
        color: null,
      },
      {
        id: 'EEG3',
        name: 'EEG3',
        channelIndex: 2,
        referenceIndex: null,
        referenceMode: null,
        color: null,
      },
    ]);
  });

  it('excludes bad channels from the fallback row list', () => {
    const settings = { ...noneBad, EEG2: { bad: true } };
    const rows = buildMontageDisplayRows(channelNames, settings, []);
    expect(rows.map((r) => r.name)).toEqual(['EEG1', 'EEG3']);
  });

  it('uses the montage rows instead of the fallback once any are configured', () => {
    const montageChannels = [{ id: 'row-1', channel: 'EEG1', reference: null, color: null }];
    const rows = buildMontageDisplayRows(channelNames, noneBad, montageChannels);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'row-1',
      name: 'EEG1',
      channelIndex: 0,
      referenceIndex: null,
      referenceMode: null,
    });
  });

  it('names a referential row (no reference) after just the channel', () => {
    const montageChannels = [{ id: 'row-1', channel: 'EEG2', reference: null, color: null }];
    const rows = buildMontageDisplayRows(channelNames, noneBad, montageChannels);
    expect(rows[0].name).toBe('EEG2');
  });

  it('names a bipolar row "channel - reference" and resolves both indices', () => {
    const montageChannels = [{ id: 'row-1', channel: 'EEG1', reference: 'EEG2', color: null }];
    const rows = buildMontageDisplayRows(channelNames, noneBad, montageChannels);
    expect(rows[0]).toMatchObject({
      name: 'EEG1 - EEG2',
      channelIndex: 0,
      referenceIndex: 1,
      referenceMode: null,
    });
  });

  it('treats an empty-string reference ("— n/a —") the same as no reference', () => {
    const montageChannels = [{ id: 'row-1', channel: 'EEG1', reference: '', color: null }];
    const rows = buildMontageDisplayRows(channelNames, noneBad, montageChannels);
    expect(rows[0]).toMatchObject({ name: 'EEG1', referenceIndex: null, referenceMode: null });
  });

  it('names an "average" reference row "channel - Avg" and sets referenceMode instead of referenceIndex', () => {
    const montageChannels = [{ id: 'row-1', channel: 'EEG1', reference: 'average', color: null }];
    const rows = buildMontageDisplayRows(channelNames, noneBad, montageChannels);
    expect(rows[0]).toMatchObject({
      name: 'EEG1 - Avg',
      channelIndex: 0,
      referenceIndex: null,
      referenceMode: 'average',
    });
  });

  it('names a "median" reference row "channel - Med" and sets referenceMode instead of referenceIndex', () => {
    const montageChannels = [{ id: 'row-1', channel: 'EEG1', reference: 'median', color: null }];
    const rows = buildMontageDisplayRows(channelNames, noneBad, montageChannels);
    expect(rows[0]).toMatchObject({
      name: 'EEG1 - Med',
      channelIndex: 0,
      referenceIndex: null,
      referenceMode: 'median',
    });
  });

  it('keeps an "average"/"median" reference row instead of dropping it as an unknown channel', () => {
    const montageChannels = [
      { id: 'row-1', channel: 'EEG1', reference: 'average', color: null },
      { id: 'row-2', channel: 'EEG2', reference: 'median', color: null },
    ];
    const rows = buildMontageDisplayRows(channelNames, noneBad, montageChannels);
    expect(rows.map((r) => r.id)).toEqual(['row-1', 'row-2']);
  });

  it('drops a montage row whose source channel is bad', () => {
    const settings = { ...noneBad, EEG1: { bad: true } };
    const montageChannels = [{ id: 'row-1', channel: 'EEG1', reference: null, color: null }];
    expect(buildMontageDisplayRows(channelNames, settings, montageChannels)).toEqual([]);
  });

  it('drops a montage row whose reference channel is bad', () => {
    const settings = { ...noneBad, EEG2: { bad: true } };
    const montageChannels = [{ id: 'row-1', channel: 'EEG1', reference: 'EEG2', color: null }];
    expect(buildMontageDisplayRows(channelNames, settings, montageChannels)).toEqual([]);
  });

  it('keeps a montage row whose source channel is bad but preserves other rows', () => {
    const settings = { ...noneBad, EEG1: { bad: true } };
    const montageChannels = [
      { id: 'row-1', channel: 'EEG1', reference: null, color: null },
      { id: 'row-2', channel: 'EEG3', reference: null, color: null },
    ];
    const rows = buildMontageDisplayRows(channelNames, settings, montageChannels);
    expect(rows.map((r) => r.id)).toEqual(['row-2']);
  });

  it('carries the row color through', () => {
    const montageChannels = [{ id: 'row-1', channel: 'EEG1', reference: null, color: 'red' }];
    const rows = buildMontageDisplayRows(channelNames, noneBad, montageChannels);
    expect(rows[0].color).toBe('red');
  });

  it('drops a montage row whose channel is not present in this recording (e.g. an imported montage file naming an unknown channel) instead of producing a -1 index', () => {
    const montageChannels = [
      { id: 'row-1', channel: 'NOT_A_REAL_CHANNEL', reference: null, color: null },
    ];
    expect(buildMontageDisplayRows(channelNames, noneBad, montageChannels)).toEqual([]);
  });

  it('drops a montage row whose reference is not present in this recording', () => {
    const montageChannels = [
      { id: 'row-1', channel: 'EEG1', reference: 'NOT_A_REAL_CHANNEL', color: null },
    ];
    expect(buildMontageDisplayRows(channelNames, noneBad, montageChannels)).toEqual([]);
  });

  it('keeps other rows when only one row references an unknown channel', () => {
    const montageChannels = [
      { id: 'row-1', channel: 'NOT_A_REAL_CHANNEL', reference: null, color: null },
      { id: 'row-2', channel: 'EEG3', reference: null, color: null },
    ];
    const rows = buildMontageDisplayRows(channelNames, noneBad, montageChannels);
    expect(rows.map((r) => r.id)).toEqual(['row-2']);
  });
});

// ---------------------------------------------------------------------------
// deriveMontageRowSamples
// ---------------------------------------------------------------------------

describe('deriveMontageRowSamples', () => {
  const channels = [
    [1, 2, 3], // EEG1
    [4, 5, 6], // EEG2
  ];

  it('returns the channel samples unchanged when the row has no reference', () => {
    const row = { channelIndex: 0, referenceIndex: null, referenceMode: null };
    expect(deriveMontageRowSamples(channels, row)).toEqual([1, 2, 3]);
  });

  it('subtracts the reference samples elementwise for a bipolar row', () => {
    const row = { channelIndex: 1, referenceIndex: 0, referenceMode: null };
    expect(deriveMontageRowSamples(channels, row)).toEqual([3, 3, 3]);
  });

  it('subtracts the average reference series when the row is in average mode', () => {
    const row = { channelIndex: 0, referenceIndex: null, referenceMode: 'average' };
    const referenceSeries = { average: [1, 1, 1], median: null };
    expect(deriveMontageRowSamples(channels, row, referenceSeries)).toEqual([0, 1, 2]);
  });

  it('subtracts the median reference series when the row is in median mode', () => {
    const row = { channelIndex: 1, referenceIndex: null, referenceMode: 'median' };
    const referenceSeries = { average: null, median: [4, 4, 4] };
    expect(deriveMontageRowSamples(channels, row, referenceSeries)).toEqual([0, 1, 2]);
  });

  it("falls back to the raw channel when the row's reference mode has no series available", () => {
    // e.g. every channel is currently marked bad, so computeReferenceSeries returned nulls.
    const row = { channelIndex: 0, referenceIndex: null, referenceMode: 'average' };
    const referenceSeries = { average: null, median: null };
    expect(deriveMontageRowSamples(channels, row, referenceSeries)).toEqual([1, 2, 3]);
  });

  it('falls back to the raw channel when no referenceSeries is given at all', () => {
    const row = { channelIndex: 0, referenceIndex: null, referenceMode: 'average' };
    expect(deriveMontageRowSamples(channels, row)).toEqual([1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
// compareChannelNamesNaturally
// ---------------------------------------------------------------------------

describe('compareChannelNamesNaturally', () => {
  it('sorts contact numbers numerically, not lexicographically', () => {
    const names = ['E100', 'E1', 'E99', 'E9'];
    expect([...names].sort(compareChannelNamesNaturally)).toEqual(['E1', 'E9', 'E99', 'E100']);
  });

  it('groups by prefix before comparing numbers, so different electrodes never interleave', () => {
    const names = ['B2', 'A10', 'B1', 'A2'];
    expect([...names].sort(compareChannelNamesNaturally)).toEqual(['A2', 'A10', 'B1', 'B2']);
  });

  it('sorts a primed group ("B\'") separately from its unprimed counterpart ("B")', () => {
    const names = ["B'2", 'B1', "B'1", 'B2'];
    expect([...names].sort(compareChannelNamesNaturally)).toEqual(['B1', 'B2', "B'1", "B'2"]);
  });

  it('falls back to plain string comparison when either name is not contact-shaped', () => {
    expect(compareChannelNamesNaturally('ECG', 'EOG')).toBeLessThan(0);
    expect(compareChannelNamesNaturally('E1', 'ECG')).toBe('E1'.localeCompare('ECG'));
  });
});
