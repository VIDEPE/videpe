import { describe, it, expect } from 'vitest';
import {
  calculateSourcePower,
  electricalSourceImaging,
} from '@/utils/electricalSourceImagingUtils';

// ─── Fixtures ────────────────────────────────────────────────────────────────
//
// SINGLE_SOURCE_FILTERS: 1 inside source, 2 channels.
// Filter rows: x=[1,2], y=[3,4], z=[5,6] — small integers so expected powers are
// easy to verify by hand. channelVoltages is intentionally excluded so each test
// can pass its own without repeating the rest.
const SINGLE_SOURCE_FILTERS = {
  flatSourceFilters: new Float64Array([1, 2, 3, 4, 5, 6]),
  nInsideSources: 1,
  nChannels: 2,
};

// TWO_SOURCE_FILTERS: 2 inside sources, 2 channels.
// source 0: x=[1,0], y=[0,1], z=[0,0]  — responds to ch0 in x, ch1 in y
// source 1: x=[0,0], y=[0,0], z=[1,1]  — responds to both channels in z only
// With channelVoltages=[2,3]: source 0 power=13, source 1 power=25 (verified below).
const TWO_SOURCE_FILTERS = {
  flatSourceFilters: new Float64Array([
    1,
    0,
    0,
    1,
    0,
    0, // source 0 (x-row, y-row, z-row)
    0,
    0,
    0,
    0,
    1,
    1, // source 1 (x-row, y-row, z-row)
  ]),
  nInsideSources: 2,
  nChannels: 2,
};

// ─── calculateSourcePower ────────────────────────────────────────────────────
//
// Power at each source = momentX² + momentY² + momentZ²
// where moment = filter_row · channelVoltages (dot product).

describe('calculateSourcePower', () => {
  it('returns a Float64Array of length nInsideSources', () => {
    const result = calculateSourcePower({ ...SINGLE_SOURCE_FILTERS, channelVoltages: [1, 0] });

    expect(result).toBeInstanceOf(Float64Array);
    expect(result).toHaveLength(SINGLE_SOURCE_FILTERS.nInsideSources);
  });

  it('computes the correct power for a single source with one active channel', () => {
    // channelVoltages = [1, 0] — only channel 0 contributes
    // momentX = 1×1 + 2×0 = 1,  momentY = 3×1 + 4×0 = 3,  momentZ = 5×1 + 6×0 = 5
    // power = 1² + 3² + 5² = 35
    const result = calculateSourcePower({ ...SINGLE_SOURCE_FILTERS, channelVoltages: [1, 0] });

    expect(result[0]).toBe(35);
  });

  it('computes the correct power when all channels contribute', () => {
    // channelVoltages = [1, 1] — both channels active
    // momentX = 1+2 = 3,  momentY = 3+4 = 7,  momentZ = 5+6 = 11
    // power = 9 + 49 + 121 = 179
    const result = calculateSourcePower({ ...SINGLE_SOURCE_FILTERS, channelVoltages: [1, 1] });

    expect(result[0]).toBe(179);
  });

  it('computes independent powers for multiple sources and verifies row-major indexing', () => {
    // channelVoltages = [2, 3]
    // source 0: momentX=2×1+3×0=2, momentY=2×0+3×1=3, momentZ=0  → power = 4+9+0 = 13
    // source 1: momentX=0,         momentY=0,           momentZ=2×1+3×1=5 → power = 25
    const result = calculateSourcePower({ ...TWO_SOURCE_FILTERS, channelVoltages: [2, 3] });

    expect(result[0]).toBe(13);
    expect(result[1]).toBe(25);
  });

  it('returns all zeros when channel voltages are all zero', () => {
    const result = calculateSourcePower({ ...SINGLE_SOURCE_FILTERS, channelVoltages: [0, 0] });

    expect(Array.from(result)).toEqual([0]);
  });
});

// ─── electricalSourceImaging ─────────────────────────────────────────────────
//
// Minimal model matching parseInverseFiltersFieldtrip's return shape.
// Uses the same 2-source, 2-channel setup as TWO_SOURCE_FILTERS above
// so expected powers are already verified: source 0 → 13, source 1 → 25.

const MINIMAL_MODEL = {
  format: 'FieldTrip',
  ...TWO_SOURCE_FILTERS,
  insideSourcePositions: [
    [-5, 15, 10],
    [0, 10, 15],
  ],
  channelLabels: ['1', '2'],
};

describe('electricalSourceImaging', () => {
  it('returns [] when flatSourceFilters is empty', () => {
    const inverseFilters = { ...MINIMAL_MODEL, flatSourceFilters: new Float64Array(0) };
    const channelVoltages = [2, 3];

    expect(electricalSourceImaging(inverseFilters, channelVoltages)).toEqual([]);
  });

  it('throws a descriptive error for an unknown format', () => {
    const inverseFilters = { ...MINIMAL_MODEL, format: 'Unknown' };
    const channelVoltages = [2, 3];

    expect(() => electricalSourceImaging(inverseFilters, channelVoltages)).toThrow(/format/);
  });

  it('runs without error and returns the convertSourcePowersToVolume result', () => {
    // convertSourcePowersToVolume is a stub that returns null — this test will need
    // updating once it is implemented, but verifies the happy path does not throw.
    const inverseFilters = MINIMAL_MODEL;
    const channelVoltages = [2, 3];

    const result = electricalSourceImaging(inverseFilters, channelVoltages);

    expect(result).toBeNull();
  });
});
