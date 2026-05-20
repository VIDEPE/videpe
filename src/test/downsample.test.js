import { describe, it, expect } from 'vitest';
import { minMaxDownsample } from '@/utils/downsample';

// 10 evenly-spaced samples covering t=[0, 0.9]
const TS   = new Float32Array([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]);
const VALS = new Float32Array([1,   5,   2,   8,   3,   7,   4,   6,   0,   9]);
// Global min = 0 (index 8), global max = 9 (index 9)

describe('minMaxDownsample — no downsampling needed', () => {
  it('returns the full slice when sample count is within targetPoints', () => {
    const [outTs, outVals] = minMaxDownsample(TS, VALS, 0, 0.9, 20);
    expect(outTs.length).toBe(10);
    expect(outVals.length).toBe(10);
  });

  it('slice values match the original data', () => {
    const [, outVals] = minMaxDownsample(TS, VALS, 0, 0.9, 20);
    expect(Array.from(outVals)).toEqual(Array.from(VALS));
  });

  it('returns an empty result for empty input', () => {
    const [outTs, outVals] = minMaxDownsample(
      new Float32Array(0), new Float32Array(0), 0, 1, 100
    );
    expect(outTs.length).toBe(0);
    expect(outVals.length).toBe(0);
  });
});

describe('minMaxDownsample — downsampling', () => {
  it('output has at most targetPoints points', () => {
    const [outTs, outVals] = minMaxDownsample(TS, VALS, 0, 0.9, 4);
    expect(outTs.length).toBeLessThanOrEqual(4);
    expect(outVals.length).toBeLessThanOrEqual(4);
  });

  it('preserves the global minimum value', () => {
    const [, outVals] = minMaxDownsample(TS, VALS, 0, 0.9, 4);
    expect(Math.min(...outVals)).toBe(Math.min(...VALS));
  });

  it('preserves the global maximum value', () => {
    const [, outVals] = minMaxDownsample(TS, VALS, 0, 0.9, 4);
    expect(Math.max(...outVals)).toBe(Math.max(...VALS));
  });

  it('output timestamps are monotonically non-decreasing', () => {
    const [outTs] = minMaxDownsample(TS, VALS, 0, 0.9, 4);
    for (let i = 1; i < outTs.length; i++) {
      expect(outTs[i]).toBeGreaterThanOrEqual(outTs[i - 1]);
    }
  });
});

describe('minMaxDownsample — window filtering', () => {
  // Use integer timestamps so index arithmetic is exact and free of float32 drift
  const TS_INT   = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const VALS_INT = new Float32Array([1, 5, 2, 8, 3, 7, 4, 6, 0, 9]);

  it('only returns samples within the requested time window', () => {
    const [outTs] = minMaxDownsample(TS_INT, VALS_INT, 2, 6, 20);
    outTs.forEach((t) => {
      expect(t).toBeGreaterThanOrEqual(2);
      expect(t).toBeLessThanOrEqual(6);
    });
  });

  it('fewer points are returned for a narrower window', () => {
    const [fullTs]   = minMaxDownsample(TS_INT, VALS_INT, 0, 9, 20);
    const [narrowTs] = minMaxDownsample(TS_INT, VALS_INT, 3, 6, 20);
    expect(narrowTs.length).toBeLessThan(fullTs.length);
  });
});

describe('minMaxDownsample — array type compatibility', () => {
  it('works with regular arrays as well as Float32Arrays', () => {
    const regularTs   = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
    const regularVals = [1,   5,   2,   8,   3,   7,   4,   6,   0,   9];
    expect(() => minMaxDownsample(regularTs, regularVals, 0, 0.9, 4)).not.toThrow();
  });

  it('produces the same min/max values for regular arrays as for TypedArrays', () => {
    const regularTs   = Array.from(TS);
    const regularVals = Array.from(VALS);
    const [, typedOut]   = minMaxDownsample(TS, VALS, 0, 0.9, 4);
    const [, regularOut] = minMaxDownsample(regularTs, regularVals, 0, 0.9, 4);
    expect(Math.min(...regularOut)).toBe(Math.min(...typedOut));
    expect(Math.max(...regularOut)).toBe(Math.max(...typedOut));
  });
});