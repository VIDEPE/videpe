import { describe, it, expect } from 'vitest';

import {
  getHighPassCoeff,
  getLowPassCoeff,
  getBandStopCoeff,
  buildFilterSections,
  applyFilterSections,
  getTukeyWindow,
} from '@/utils/eegFilters';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const fs = 256;
const n = 1024;
const time = Array.from({ length: n }, (_, i) => i / fs);
const sine = (freq) => time.map((t) => Math.sin(2 * Math.PI * freq * t));

// RMS-based amplitude estimate over the middle half of the signal, so edge transients (fili's
// filtfilt has no padding of its own — see applyFilterSections's docstring) don't skew the reading.
const middleAmplitude = (samples) => {
  const mid = samples.slice(Math.floor(n * 0.25), Math.floor(n * 0.75));
  return Math.sqrt(mid.reduce((sum, v) => sum + v * v, 0) / mid.length) * Math.SQRT2;
};

// ─── getHighPassCoeff / getLowPassCoeff ─────────────────────────────────────────────

describe.each([
  ['getHighPassCoeff', getHighPassCoeff],
  ['getLowPassCoeff', getLowPassCoeff],
])('%s', (_name, filterCoefFunction) => {
  it('returns one section per cascade order (default order = 4)', () => {
    expect(filterCoefFunction(fs, 10)).toHaveLength(4);
  });

  it('respects an explicit order', () => {
    expect(filterCoefFunction(fs, 10, 2)).toHaveLength(2);
  });

  it('returns finite, well-formed biquad coefficients', () => {
    const [section] = filterCoefFunction(fs, 10);
    expect(section.b).toHaveLength(3);
    expect(section.a).toHaveLength(2);
    expect(section.b.every(Number.isFinite)).toBe(true);
    expect(section.a.every(Number.isFinite)).toBe(true);
    expect(Number.isFinite(section.a0)).toBe(true);
    expect(Number.isFinite(section.k)).toBe(true);
  });
});

// ─── getBandStopCoeff ────────────────────────────────────────────────────────────────

describe('getBandStopCoeff', () => {
  it('defaults to a single narrow section, not order=4 like highpass/lowpass', () => {
    // fili's cascade `order` widens a bandstop's stopband rather than steepening it, so
    // stacking several sections (as highpass/lowpass do) would blow the notch out far past a
    // usable mains-noise width — see the function's own docstring.
    expect(getBandStopCoeff(fs, 50)).toHaveLength(1);
  });

  it('respects an explicit order', () => {
    expect(getBandStopCoeff(fs, 50, 2)).toHaveLength(2);
  });

  it('returns finite, well-formed biquad coefficients', () => {
    const [section] = getBandStopCoeff(fs, 50);
    expect(section.b).toHaveLength(3);
    expect(section.a).toHaveLength(2);
    expect(section.b.every(Number.isFinite)).toBe(true);
    expect(section.a.every(Number.isFinite)).toBe(true);
  });
});

// ─── buildFilterSections ─────────────────────────────────────────────────────────────

describe('buildFilterSections', () => {
  it('returns an empty cascade when nothing is set', () => {
    expect(buildFilterSections(fs, null, null, null)).toEqual([]);
  });

  it('returns 4 sections for a highpass-only row (default order)', () => {
    expect(buildFilterSections(fs, 1, null, null)).toHaveLength(4);
  });

  it('returns 4 sections for a lowpass-only row', () => {
    expect(buildFilterSections(fs, null, 40, null)).toHaveLength(4);
  });

  it('returns 1 section for a notch-only row', () => {
    expect(buildFilterSections(fs, null, null, 50)).toHaveLength(1);
  });

  it('concatenates all three cascades when all are set', () => {
    expect(buildFilterSections(fs, 1, 40, 50)).toHaveLength(9); // 4 + 4 + 1
  });
});

// ─── applyFilterSections ──────────────────────────────────────────────────────────────────

describe('applyFilterSections', () => {
  it('returns the input unchanged (same reference, no copy) when no filter is set', () => {
    const samples = sine(10);
    expect(applyFilterSections(samples, [])).toBe(samples);
  });

  it('strongly attenuates a tone well below a lowpass cutoff... below the cutoff, above the tone', () => {
    const samples = sine(30);
    const sections = buildFilterSections(fs, null, 5, null); // cutoff well below the 30Hz tone
    expect(middleAmplitude(applyFilterSections(samples, sections))).toBeLessThan(0.01);
  });

  it('passes a tone well below a lowpass cutoff close to unchanged', () => {
    const samples = sine(30);
    const sections = buildFilterSections(fs, null, 100, null); // cutoff well above the 30Hz tone
    expect(middleAmplitude(applyFilterSections(samples, sections))).toBeGreaterThan(0.95);
  });

  it('strongly attenuates a tone well below a highpass cutoff', () => {
    const samples = sine(30);
    const sections = buildFilterSections(fs, 60, null, null); // cutoff well above the 30Hz tone
    expect(middleAmplitude(applyFilterSections(samples, sections))).toBeLessThan(0.01);
  });

  it('passes a tone well above a highpass cutoff close to unchanged', () => {
    const samples = sine(30);
    const sections = buildFilterSections(fs, 2, null, null); // cutoff well below the 30Hz tone
    expect(middleAmplitude(applyFilterSections(samples, sections))).toBeGreaterThan(0.95);
  });

  it('strongly attenuates a tone at the notch frequency', () => {
    const samples = sine(50);
    const sections = buildFilterSections(fs, null, null, 50);
    expect(middleAmplitude(applyFilterSections(samples, sections))).toBeLessThan(0.01);
  });

  it('passes a tone well away from the notch frequency close to unchanged', () => {
    const samples = sine(50);
    const sections = buildFilterSections(fs, null, null, 80);
    expect(middleAmplitude(applyFilterSections(samples, sections))).toBeGreaterThan(0.95);
  });

  it('throws when the window is shorter than the signal', () => {
    const samples = sine(10);
    const sections = buildFilterSections(fs, null, 40, null);
    expect(() =>
      applyFilterSections(samples, sections, new Array(samples.length - 1).fill(1))
    ).toThrow(/window must be at least as long as samples/);
  });

  it('returns a signal the same length as the input, with or without a window', () => {
    const samples = sine(10);
    const sections = buildFilterSections(fs, null, 40, null);
    const window = getTukeyWindow(samples.length + 200, 0.1);
    expect(applyFilterSections(samples, sections)).toHaveLength(samples.length);
    expect(applyFilterSections(samples, sections, window)).toHaveLength(samples.length);
  });
});

// ─── getTukeyWindow ──────────────────────────────────────────────────────────────────

describe('getTukeyWindow', () => {
  it('returns the correct tukey window for M=10, alpha=0.5', () => {
    const correct = [0, 0.41317591, 0.96984631, 1, 1, 1, 1, 0.96984631, 0.41317591, 0]; // taken from scipi: print(scipy.signal.windows.tukey(M=10, alpha=0.5)
    const actual = getTukeyWindow(10, 0.5);
    expect(actual).toHaveLength(correct.length);
    correct.forEach((value, i) => expect(actual[i]).toBeCloseTo(value, 6));
  });

  it('returns an all-ones window when alpha <= 0 (no taper)', () => {
    expect(getTukeyWindow(8, 0)).toEqual(new Array(8).fill(1));
  });

  it('throws when M is not positive', () => {
    expect(() => getTukeyWindow(0)).toThrow(/M must be bigger than 0/);
  });

  it('throws when alpha is not below 1', () => {
    expect(() => getTukeyWindow(8, 1)).toThrow(/alpha must be within the range/);
  });

  it('is symmetric and starts/ends at 0 for any M/alpha in range', () => {
    const window = getTukeyWindow(21, 0.3);
    expect(window[0]).toBeCloseTo(0, 6);
    expect(window[window.length - 1]).toBeCloseTo(0, 6);
    window.forEach((value, i) => expect(value).toBeCloseTo(window[window.length - 1 - i], 6));
  });
});
