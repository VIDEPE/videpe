import { describe, it, expect } from 'vitest';
import {
  computeReferenceSeries,
  getNeededReferenceSeries,
  applyReferenceSeries,
  buildMontageDisplayRows,
  deriveMontageRowSamples,
  compareChannelNamesNaturally,
  buildSeegBipolarReferences,
  getRowCrosshairPosition,
  filterMontageRows,
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

  it('works on Float32Array channels (the real buffer type)', () => {
    const channels = [
      Float32Array.from([1, 10]),
      Float32Array.from([2, 20]),
      Float32Array.from([6, 30]),
    ];
    const { average, median } = computeReferenceSeries(channels);
    expect(average).toEqual([3, 20]);
    expect(median).toEqual([2, 20]);
  });

  it('only computes the average when only the average is requested', () => {
    const channels = [
      [1, 2],
      [3, 4],
    ];
    expect(computeReferenceSeries(channels, { needsAverage: true, needsMedian: false })).toEqual({
      average: [2, 3],
      median: null,
    });
  });

  it('only computes the median when only the median is requested', () => {
    const channels = [[1], [2], [9]];
    expect(computeReferenceSeries(channels, { needsAverage: false, needsMedian: true })).toEqual({
      average: null,
      median: [2],
    });
  });

  it('computes neither series when neither is requested', () => {
    expect(computeReferenceSeries([[1], [2]], { needsAverage: false, needsMedian: false })).toEqual(
      {
        average: null,
        median: null,
      }
    );
  });

  // The median uses a fast method that finds the middle value without fully sorting. This
  // checks it against the slow but obviously correct way (sort, take the middle) on lots of
  // random data: odd and even channel counts, and many equal values.
  it('the fast median gives the same answer as sorting the values and taking the middle one', () => {
    const sortMedian = (values) => {
      const sorted = [...values].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    };
    // seeded generator so a failure is reproducible; small integer range so ties are common
    let seed = 1;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (const nChannels of [1, 2, 3, 7, 8, 64, 257]) {
      const nSamples = 50;
      const channels = Array.from({ length: nChannels }, () =>
        Array.from({ length: nSamples }, () => Math.floor(random() * 20) - 10)
      );
      const { median } = computeReferenceSeries(channels, {
        needsAverage: false,
        needsMedian: true,
      });
      for (let iSample = 0; iSample < nSamples; iSample++) {
        expect(median[iSample]).toBeCloseTo(sortMedian(channels.map((chan) => chan[iSample])));
      }
    }
  });
});

// ---------------------------------------------------------------------------
// getNeededReferenceSeries
// ---------------------------------------------------------------------------

describe('getNeededReferenceSeries', () => {
  const row = (referenceMode) => ({ referenceMode });

  it('needs neither series when no row uses Avg/Med and no snapshot is shown', () => {
    expect(getNeededReferenceSeries([row(null), row(null)], false)).toEqual({
      needsAverage: false,
      needsMedian: false,
    });
  });

  it('needs the average when a row uses the average reference', () => {
    expect(getNeededReferenceSeries([row(null), row('average')], false)).toEqual({
      needsAverage: true,
      needsMedian: false,
    });
  });

  it('needs the median when a row uses the median reference', () => {
    expect(getNeededReferenceSeries([row('median')], false)).toEqual({
      needsAverage: false,
      needsMedian: true,
    });
  });

  it('needs the average when a timepoint snapshot (topography/connectome/ESI) is shown', () => {
    expect(getNeededReferenceSeries([row(null)], true)).toEqual({
      needsAverage: true,
      needsMedian: false,
    });
  });

  it('needs both when rows use both references', () => {
    expect(getNeededReferenceSeries([row('average'), row('median')], false)).toEqual({
      needsAverage: true,
      needsMedian: true,
    });
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
        highPass: null,
        lowPass: null,
        notch: null,
      },
      {
        id: 'EEG2',
        name: 'EEG2',
        channelIndex: 1,
        referenceIndex: null,
        referenceMode: null,
        color: null,
        highPass: null,
        lowPass: null,
        notch: null,
      },
      {
        id: 'EEG3',
        name: 'EEG3',
        channelIndex: 2,
        referenceIndex: null,
        referenceMode: null,
        color: null,
        highPass: null,
        lowPass: null,
        notch: null,
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

  it('carries the row highPass/lowPass/notch settings through', () => {
    const montageChannels = [
      {
        id: 'row-1',
        channel: 'EEG1',
        reference: null,
        color: null,
        highPass: 19,
        lowPass: 20,
        notch: 50,
      },
    ];
    const rows = buildMontageDisplayRows(channelNames, noneBad, montageChannels);
    expect(rows[0]).toMatchObject({ highPass: 19, lowPass: 20, notch: 50 });
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
// getRowCrosshairPosition
// ---------------------------------------------------------------------------

describe('getRowCrosshairPosition', () => {
  const matched = [
    { channelIdx: 0, name: 'EEG1', pos: { x: 0, y: 0, z: 0 } },
    { channelIdx: 1, name: 'EEG2', pos: { x: 10, y: 20, z: 30 } },
  ];

  it("returns the channel's own position for a row with no reference", () => {
    const row = { channelIndex: 0, referenceIndex: null, referenceMode: null };
    expect(getRowCrosshairPosition(row, matched)).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("returns the channel's own position for an average/median-referenced row", () => {
    const row = { channelIndex: 1, referenceIndex: null, referenceMode: 'average' };
    expect(getRowCrosshairPosition(row, matched)).toEqual({ x: 10, y: 20, z: 30 });
  });

  it('returns the midpoint of the channel and its reference for a bipolar row', () => {
    const row = { channelIndex: 0, referenceIndex: 1, referenceMode: null };
    expect(getRowCrosshairPosition(row, matched)).toEqual({ x: 5, y: 10, z: 15 });
  });

  it("falls back to the channel's own position when the reference channel has no matched position", () => {
    const row = { channelIndex: 0, referenceIndex: 99, referenceMode: null };
    expect(getRowCrosshairPosition(row, matched)).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('returns null when the channel itself has no matched position', () => {
    const row = { channelIndex: 99, referenceIndex: null, referenceMode: null };
    expect(getRowCrosshairPosition(row, matched)).toBeNull();
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

// ---------------------------------------------------------------------------
// buildSeegBipolarReferences
// ---------------------------------------------------------------------------

describe('buildSeegBipolarReferences', () => {
  it('references each contact to the next-numbered contact in its own group', () => {
    const channelNames = ['B1', 'B2', 'B3'];
    const settings = { B1: { type: 'seeg' }, B2: { type: 'seeg' }, B3: { type: 'seeg' } };
    const { references, monopolar } = buildSeegBipolarReferences(channelNames, settings);
    expect(references.get('B1')).toBe('B2');
    expect(references.get('B2')).toBe('B3');
    expect(monopolar).toEqual(['B3']);
  });

  it('never skips a missing contact to find a next reference (no n+2 fallback)', () => {
    // B2 is missing, so B1 has no exact B2 to pair with — it must not fall through to B3.
    const channelNames = ['B1', 'B3'];
    const settings = { B1: { type: 'seeg' }, B3: { type: 'seeg' } };
    const { references, monopolar } = buildSeegBipolarReferences(channelNames, settings);
    expect(references.size).toBe(0);
    expect(monopolar).toEqual(['B1', 'B3']);
  });

  it('keeps electrode groups separate by prefix, so they never cross-pair', () => {
    const channelNames = ['A1', 'A2', 'B1', 'B2'];
    const settings = Object.fromEntries(channelNames.map((n) => [n, { type: 'seeg' }]));
    const { references, monopolar } = buildSeegBipolarReferences(channelNames, settings);
    expect(references.get('A1')).toBe('A2');
    expect(references.get('B1')).toBe('B2');
    expect(monopolar.sort()).toEqual(['A2', 'B2']);
  });

  it('never crosses a primed group ("B\'") with its unprimed counterpart ("B")', () => {
    const channelNames = ['B1', "B'1"];
    const settings = { B1: { type: 'seeg' }, "B'1": { type: 'seeg' } };
    const { references, monopolar } = buildSeegBipolarReferences(channelNames, settings);
    expect(references.size).toBe(0);
    // Set comparison, not a sorted array — apostrophe (0x27) vs digit (0x31) ordering under
    // plain string sort is an implementation detail this test shouldn't depend on.
    expect(new Set(monopolar)).toEqual(new Set(['B1', "B'1"]));
  });

  it('leaves EEG and Other typed channels out of both references and monopolar', () => {
    const channelNames = ['FP1', 'ECG1', 'B1', 'B2'];
    const settings = {
      FP1: { type: 'eeg' },
      ECG1: { type: 'other' },
      B1: { type: 'seeg' },
      B2: { type: 'seeg' },
    };
    const { references, monopolar } = buildSeegBipolarReferences(channelNames, settings);
    expect(references.has('FP1')).toBe(false);
    expect(references.has('ECG1')).toBe(false);
    expect(monopolar).not.toContain('FP1');
    expect(monopolar).not.toContain('ECG1');
  });

  it('treats a channel with no settings entry as EEG, not SEEG (matches the rest of the editor)', () => {
    const channelNames = ['B1', 'B2'];
    const { references, monopolar } = buildSeegBipolarReferences(channelNames, {});
    expect(references.size).toBe(0);
    expect(monopolar).toEqual([]);
  });

  it('puts a non-contact-shaped SEEG channel name in monopolar (nothing to pair on)', () => {
    const channelNames = ['GND']; // no trailing digit — parseElectrodeContactName can't parse it
    const settings = { GND: { type: 'seeg' } };
    const { references, monopolar } = buildSeegBipolarReferences(channelNames, settings);
    expect(references.size).toBe(0);
    expect(monopolar).toEqual(['GND']);
  });
});

// ---------------------------------------------------------------------------
// filterMontageRows
// ---------------------------------------------------------------------------

describe('filterMontageRows', () => {
  const FS = 100;
  // 2 channels, 5 s at 100 Hz: a slow 1 Hz wave plus a constant offset of 10
  const nSamples = 5 * FS;
  const channels = [0, 1].map(() =>
    Float32Array.from({ length: nSamples }, (_, i) => 10 + Math.sin((2 * Math.PI * i) / FS))
  );
  const makeRow = (id, channelIndex, filters = {}) => ({
    id,
    channelIndex,
    referenceIndex: null,
    referenceMode: null,
    highPass: null,
    lowPass: null,
    notch: null,
    ...filters,
  });

  it('returns each row keyed by its id, leaving rows without a filter untouched', async () => {
    const rows = [makeRow('a', 0), makeRow('b', 1)];
    const result = await filterMontageRows(channels, rows, null, FS);
    expect([...result.keys()]).toEqual(['a', 'b']);
    expect(result.get('a')).toBe(channels[0]); // same array: nothing to filter, nothing copied
    expect(result.get('b')).toBe(channels[1]);
  });

  it('filters a row that has a filter set, keeping its length', async () => {
    // a 0.5 Hz high pass removes the constant offset of 10, so the filtered middle averages ~0
    const rows = [makeRow('a', 0, { highPass: 0.5 })];
    const filtered = (await filterMontageRows(channels, rows, null, FS)).get('a');
    expect(filtered).toHaveLength(nSamples);
    const middle = Array.from(filtered).slice(FS, 4 * FS);
    const mean = middle.reduce((sum, v) => sum + v, 0) / middle.length;
    expect(Math.abs(mean)).toBeLessThan(0.5);
  });

  it('applies the row reference before filtering', async () => {
    // channel 0 minus channel 1 (identical signals) is all zeros
    const rows = [{ ...makeRow('a', 0), referenceIndex: 1 }];
    const result = (await filterMontageRows(channels, rows, null, FS)).get('a');
    expect(Array.from(result).every((v) => v === 0)).toBe(true);
  });

  it('rejects with an AbortError when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      filterMontageRows(channels, [makeRow('a', 0)], null, FS, { signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects with an AbortError when aborted during a pause between rows', async () => {
    const controller = new AbortController();
    // frameBudgetMs 0 pauses after every row, so aborting right away lands in the first pause
    const promise = filterMontageRows(channels, [makeRow('a', 0), makeRow('b', 1)], null, FS, {
      signal: controller.signal,
      frameBudgetMs: 0,
    });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });
});
