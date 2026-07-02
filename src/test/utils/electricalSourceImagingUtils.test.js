import { describe, it, expect } from 'vitest';
import {
  calculateSourcePower,
  convertSourcePowersToConnectome,
  electricalSourceImaging,
} from '@/utils/electricalSourceImagingUtils';
import { ESI_CONNECTOME_URL } from '@/components/NiiViewer.utils';

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

// ─── convertSourcePowersToConnectome ─────────────────────────────────────────

// Two inside-brain source positions and pre-verified power values
// (same as the TWO_SOURCE_FILTERS + channelVoltages=[2,3] case above).
const CONNECTOME_POSITIONS = [
  [-5, 15, 10],
  [0, 10, 15],
];
const CONNECTOME_POWERS = new Float64Array([13, 25]);

describe('convertSourcePowersToConnectome', () => {
  it('returns an object with the correct NiiVue connectome layer shape', () => {
    const result = convertSourcePowersToConnectome(CONNECTOME_POSITIONS, CONNECTOME_POWERS);

    expect(result.url).toBe(ESI_CONNECTOME_URL);
    expect(result.kind).toBe('connectome');
    expect(result.type).toBe('ESI');
    expect(result.name).toBe('ESI Source Power');
    expect(result.edges).toEqual([]);
    expect(result.nodes).toBeDefined();
    expect(result.calMax).toBeDefined();
  });

  it('creates one node per inside-brain source', () => {
    const result = convertSourcePowersToConnectome(CONNECTOME_POSITIONS, CONNECTOME_POWERS);

    expect(result.nodes).toHaveLength(CONNECTOME_POSITIONS.length);
  });

  it('sets node x/y/z from insideSourcePositions', () => {
    const result = convertSourcePowersToConnectome(CONNECTOME_POSITIONS, CONNECTOME_POWERS);

    expect(result.nodes[0]).toMatchObject({ x: -5, y: 15, z: 10 });
    expect(result.nodes[1]).toMatchObject({ x: 0, y: 10, z: 15 });
  });

  it('sets node colorValue from sourcePowers', () => {
    const result = convertSourcePowersToConnectome(CONNECTOME_POSITIONS, CONNECTOME_POWERS);

    expect(result.nodes[0].colorValue).toBe(13);
    expect(result.nodes[1].colorValue).toBe(25);
  });

  it('sets calMax to the maximum source power', () => {
    const result = convertSourcePowersToConnectome(CONNECTOME_POSITIONS, CONNECTOME_POWERS);

    expect(result.calMax).toBe(25);
  });

  it('floors calMax at 1e-9 when all powers are zero to prevent NiiVue color-scale division-by-zero', () => {
    const result = convertSourcePowersToConnectome(CONNECTOME_POSITIONS, new Float64Array([0, 0]));

    expect(result.calMax).toBe(1e-9);
  });
});

// ─── electricalSourceImaging ─────────────────────────────────────────────────
//
// Minimal model matching parseInverseSolutionFieldtrip's return shape.
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

// channelSnapshot fixtures — the per-click EEG state lifted from EegViewer
const SCALP_SNAPSHOT = { isIntracranial: false, channelNames: ['1', '2'], voltages: [2, 3] };
const IEEG_SNAPSHOT = { isIntracranial: true, channelNames: ['B1', 'B2'], voltages: [2, 3] };

describe('electricalSourceImaging', () => {
  it('returns null when inverseSolution is null (not yet loaded)', () => {
    expect(electricalSourceImaging(null, SCALP_SNAPSHOT)).toBeNull();
  });

  it('returns null when channelSnapshot is null (no EEG click yet)', () => {
    expect(electricalSourceImaging(MINIMAL_MODEL, null)).toBeNull();
  });

  it('returns null when channelSnapshot voltages are empty (pre-click state)', () => {
    expect(electricalSourceImaging(MINIMAL_MODEL, { ...SCALP_SNAPSHOT, voltages: [] })).toBeNull();
  });

  it('returns null for iEEG recordings — ESI inverse filters require scalp EEG', () => {
    expect(electricalSourceImaging(MINIMAL_MODEL, IEEG_SNAPSHOT)).toBeNull();
  });

  it('returns [] when flatSourceFilters is empty', () => {
    const inverseSolution = { ...MINIMAL_MODEL, flatSourceFilters: new Float64Array(0) };

    expect(electricalSourceImaging(inverseSolution, SCALP_SNAPSHOT)).toEqual([]);
  });

  it('throws a descriptive error for an unknown format', () => {
    const inverseSolution = { ...MINIMAL_MODEL, format: 'Unknown' };

    expect(() => electricalSourceImaging(inverseSolution, SCALP_SNAPSHOT)).toThrow(/format/);
  });

  it('runs end-to-end and returns a connectome layer for NiiViewer', () => {
    const result = electricalSourceImaging(MINIMAL_MODEL, SCALP_SNAPSHOT);

    // Powers from this model are already verified: source 0 → 13, source 1 → 25
    expect(result.kind).toBe('connectome');
    expect(result.url).toBe(ESI_CONNECTOME_URL);
    expect(result.nodes).toHaveLength(2);
    expect(result.calMax).toBe(25);
  });
});
