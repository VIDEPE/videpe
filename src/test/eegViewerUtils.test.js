import { describe, it, expect } from 'vitest';
import { averageReference, medianReference, applyMontage } from '@/utils/eegViewerUtils';

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
      [3, 30],
    ];
    const out = medianReference(channels);
    expect(out[0]).toEqual([-1, -10]);
    expect(out[1]).toEqual([0, 0]);
    expect(out[2]).toEqual([1, 10]);
  });

  it('subtracts the per-sample cross-channel median (even channel count)', () => {
    // 4 channels, 1 sample. Median of [1,2,3,4] = 2.5.
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
