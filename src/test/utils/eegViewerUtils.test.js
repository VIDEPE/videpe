import { describe, it, expect } from 'vitest';
import {
  averageReference,
  medianReference,
  applyMontage,
  buildMontageDisplayRows,
  deriveMontageRowSamples,
} from '@/utils/eegViewerUtils';

// ---------------------------------------------------------------------------
// averageReference
// ---------------------------------------------------------------------------

describe('averageReference', () => {
  it('subtracts the per-sample cross-channel mean', () => {
    // 3 channels, 3 samples. Per sample, mean across channels is [3, 4, 5].
    const channels = [
      [1, 2, 3],
      [3, 4, 5],
      [5, 6, 7],
    ];
    const out = averageReference(channels);
    expect(out[0]).toEqual([-2, -2, -2]);
    expect(out[1]).toEqual([0, 0, 0]);
    expect(out[2]).toEqual([2, 2, 2]);
  });

  it('each sample sums to (approximately) zero across channels', () => {
    const channels = [
      [1, 2, 3],
      [4, 5, 6],
      [10, 1, 8],
    ];
    const out = averageReference(channels);
    for (let iSamp = 0; iSamp < 3; iSamp++) {
      const sum = out.reduce((acc, chan) => acc + chan[iSamp], 0);
      expect(sum).toBeCloseTo(0);
    }
  });

  it('handles a single channel (output is zero)', () => {
    const out = averageReference([[42, 7]]);
    expect(out[0]).toEqual([0, 0]);
  });

  it('does not mutate the input', () => {
    const channels = [
      [1, 2],
      [3, 4],
    ];
    averageReference(channels);
    expect(channels).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });
});

// ---------------------------------------------------------------------------
// medianReference
// ---------------------------------------------------------------------------

describe('medianReference', () => {
  it('subtracts the per-sample cross-channel median (odd channel count)', () => {
    // 3 channels, 2 samples. Sample 0 values across channels: [1,2,3] → median 2.
    // Sample 1 values across channels: [10,20,30] → median 20.
    const channels = [
      [1, 10],
      [2, 20],
      [2, 20],
      [3, 30],
      [4, 40],
    ];
    const out = medianReference(channels);
    expect(out[0]).toEqual([-1, -10]);
    expect(out[1]).toEqual([0, 0]);
    expect(out[2]).toEqual([0, 0]);
    expect(out[3]).toEqual([1, 10]);
    expect(out[4]).toEqual([2, 20]);
  });

  it('subtracts the per-sample cross-channel median (even channel count => takes the average between the middle two samples)', () => {
    // 4 channels, 1 sample. Median of [1,2,2,4] = 2.5.
    const channels = [[1], [2], [3], [4]];
    const out = medianReference(channels);
    expect(out[0][0]).toBeCloseTo(-1.5);
    expect(out[1][0]).toBeCloseTo(-0.5);
    expect(out[2][0]).toBeCloseTo(0.5);
    expect(out[3][0]).toBeCloseTo(1.5);
  });

  it('is robust to an outlier channel', () => {
    // Without the outlier, median of [1,2,3] = 2. Median of [1,2,3,1000] = 2.5.
    const channels = [[1], [2], [3], [1000]];
    const out = medianReference(channels);
    expect(out[3][0]).toBeCloseTo(1000 - 2.5);
    // the three normal channels stay close to zero, not pulled toward 1000
    expect(Math.abs(out[0][0])).toBeLessThan(5);
  });

  it('does not mutate the input', () => {
    const channels = [[3], [1], [2]];
    medianReference(channels);
    expect(channels).toEqual([[3], [1], [2]]);
  });
});

// ---------------------------------------------------------------------------
// applyMontage
// ---------------------------------------------------------------------------

describe('applyMontage', () => {
  const channels = [
    [1, 2],
    [3, 4],
    [5, 6],
  ];

  it('returns the raw channels unchanged for "none"', () => {
    expect(applyMontage(channels, 'none')).toBe(channels);
  });

  it('applies averageReference for "average"', () => {
    expect(applyMontage(channels, 'average')).toEqual(averageReference(channels));
  });

  it('applies medianReference for "median"', () => {
    expect(applyMontage(channels, 'median')).toEqual(medianReference(channels));
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
      { id: 'EEG1', name: 'EEG1', channelIndex: 0, referenceIndex: null, color: null },
      { id: 'EEG2', name: 'EEG2', channelIndex: 1, referenceIndex: null, color: null },
      { id: 'EEG3', name: 'EEG3', channelIndex: 2, referenceIndex: null, color: null },
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
    });
  });

  it('treats an empty-string reference ("— n/a —") the same as no reference', () => {
    const montageChannels = [{ id: 'row-1', channel: 'EEG1', reference: '', color: null }];
    const rows = buildMontageDisplayRows(channelNames, noneBad, montageChannels);
    expect(rows[0]).toMatchObject({ name: 'EEG1', referenceIndex: null });
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
  const montagedChannels = [
    [1, 2, 3], // EEG1
    [4, 5, 6], // EEG2
  ];

  it('returns the channel samples unchanged when the row has no reference', () => {
    const row = { channelIndex: 0, referenceIndex: null };
    expect(deriveMontageRowSamples(montagedChannels, row)).toEqual([1, 2, 3]);
  });

  it('subtracts the reference samples elementwise for a bipolar row', () => {
    const row = { channelIndex: 1, referenceIndex: 0 };
    expect(deriveMontageRowSamples(montagedChannels, row)).toEqual([3, 3, 3]);
  });
});
