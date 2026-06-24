import { describe, it, expect } from 'vitest';
import { parseElcElectrodePositions } from '@/loaders/parseElcElectrodePositions';
import { matchChannelsToPositions } from '@/utils/eegTopographyUtils';

// Minimal valid .elc with 3 fiducials + 2 electrodes
const MINIMAL_ELC = `# ASA electrode file
ReferenceLabel	avg
UnitPosition	mm
NumberPositions=	5
Positions
-86.0 -20.0 -48.0
86.0 -20.0 -48.0
0.0 87.0 -40.0
-29.0 84.0 -7.0
29.0 84.0 -7.0
Labels
LPA
RPA
Nz
Fp1
Fp2
`;

describe('parseElcElectrodePositions', () => {
  it('returns the correct number of electrodes (fiducials excluded)', () => {
    const { electrodes } = parseElcElectrodePositions(MINIMAL_ELC);
    expect(electrodes.length).toBe(2);
  });

  it('parses electrode labels correctly', () => {
    const { electrodes } = parseElcElectrodePositions(MINIMAL_ELC);
    expect(electrodes[0].label).toBe('Fp1');
    expect(electrodes[1].label).toBe('Fp2');
  });

  it('parses electrode xyz coordinates correctly', () => {
    const { electrodes } = parseElcElectrodePositions(MINIMAL_ELC);
    expect(electrodes[0].x).toBeCloseTo(-29.0);
    expect(electrodes[0].y).toBeCloseTo(84.0);
    expect(electrodes[0].z).toBeCloseTo(-7.0);
  });

  it('detects all three standard fiducials', () => {
    const { fiducials } = parseElcElectrodePositions(MINIMAL_ELC);
    expect(fiducials.LPA).toBeDefined();
    expect(fiducials.RPA).toBeDefined();
    expect(fiducials.Nz).toBeDefined();
  });

  it('parses fiducial coordinates correctly', () => {
    const { fiducials } = parseElcElectrodePositions(MINIMAL_ELC);
    expect(fiducials.LPA.x).toBeCloseTo(-86.0);
    expect(fiducials.LPA.y).toBeCloseTo(-20.0);
    expect(fiducials.LPA.z).toBeCloseTo(-48.0);
  });

  it('reports hasFiducials true when all three are present', () => {
    const { hasFiducials } = parseElcElectrodePositions(MINIMAL_ELC);
    expect(hasFiducials).toBe(true);
  });

  it('reports hasFiducials false when fiducials are missing', () => {
    const noFids = MINIMAL_ELC.replace('LPA', 'Fp3').replace('RPA', 'Fp4').replace('Nz', 'Fp5');
    const { hasFiducials } = parseElcElectrodePositions(noFids);
    expect(hasFiducials).toBe(false);
  });

  it('converts cm to mm', () => {
    const cmElc = MINIMAL_ELC.replace('UnitPosition\tmm', 'UnitPosition\tcm');
    const { electrodes } = parseElcElectrodePositions(cmElc);
    expect(electrodes[0].x).toBeCloseTo(-290.0); // -29.0 cm × 10
  });

  it('returns empty arrays for empty input', () => {
    const { electrodes, fiducials, hasFiducials } = parseElcElectrodePositions('');
    expect(electrodes).toEqual([]);
    expect(fiducials).toEqual({});
    expect(hasFiducials).toBe(false);
  });

  it('skips lines with missing or non-numeric coordinates', () => {
    const bad = MINIMAL_ELC.replace('-29.0 84.0 -7.0', 'n/a n/a n/a');
    const { electrodes } = parseElcElectrodePositions(bad);
    expect(electrodes.length).toBe(1); // only Fp2 survives
  });
});

// ---------------------------------------------------------------------------
// matchChannelsToPositions
// ---------------------------------------------------------------------------

const ELECTRODES = [
  { label: 'Fp1', x: -29, y: 84, z: -7 },
  { label: 'Fp2', x: 29, y: 84, z: -7 },
  { label: 'Cz', x: 0, y: 0, z: 88 },
];

describe('matchChannelsToPositions', () => {
  it('matches exact labels (case-insensitive)', () => {
    const { matched } = matchChannelsToPositions(['fp1', 'FP2', 'CZ'], ELECTRODES);
    expect(matched).toHaveLength(3);
  });

  it('strips "EEG " prefix before matching', () => {
    const { matched } = matchChannelsToPositions(['EEG Fp1'], ELECTRODES);
    expect(matched).toHaveLength(1);
    expect(matched[0].pos.label).toBe('Fp1');
  });

  it('strips "-Ref" suffix before matching', () => {
    const { matched } = matchChannelsToPositions(['Fp1-Ref', 'Fp2-Ref'], ELECTRODES);
    expect(matched).toHaveLength(2);
  });

  it('strips "-A1" style suffix before matching', () => {
    const { matched } = matchChannelsToPositions(['Cz-A1'], ELECTRODES);
    expect(matched).toHaveLength(1);
  });

  it('preserves channelIdx from the input array', () => {
    const { matched } = matchChannelsToPositions(['noise', 'Cz', 'Fp2'], ELECTRODES);
    const czMatch = matched.find((m) => m.name === 'Cz');
    expect(czMatch.channelIdx).toBe(1);
  });

  it('puts unmatched channel names in unmatchedNames', () => {
    const { unmatchedNames } = matchChannelsToPositions(['1', '3', 'Fp1'], ELECTRODES);
    expect(unmatchedNames).toContain('1');
    expect(unmatchedNames).toContain('3');
    expect(unmatchedNames).not.toContain('Fp1');
  });

  it('returns empty matched array when no channels match', () => {
    const { matched } = matchChannelsToPositions(['1', '2', '3'], ELECTRODES);
    expect(matched).toHaveLength(0);
  });

  it('matched entries carry the original channel name', () => {
    const { matched } = matchChannelsToPositions(['EEG Fp1'], ELECTRODES);
    expect(matched[0].name).toBe('EEG Fp1');
  });
});

// ---------------------------------------------------------------------------
// buildElectrodeMesh / gaussianRBF / interpolateMeshVoltages
// ---------------------------------------------------------------------------

import {
  buildElectrodeMesh,
  gaussianRBF,
  interpolateMeshVoltages,
  buildEegMesh,
} from '@/utils/eegTopographyUtils';

// 8 corners of a cube — guaranteed non-coplanar, convex hull gives 12 triangles
const CUBE_ELECTRODES = [
  { label: 'A', x: 1, y: 1, z: 1 },
  { label: 'B', x: -1, y: 1, z: 1 },
  { label: 'C', x: 1, y: -1, z: 1 },
  { label: 'D', x: -1, y: -1, z: 1 },
  { label: 'E', x: 1, y: 1, z: -1 },
  { label: 'F', x: -1, y: 1, z: -1 },
  { label: 'G', x: 1, y: -1, z: -1 },
  { label: 'H', x: -1, y: -1, z: -1 },
];

describe('buildElectrodeMesh', () => {
  it('returns a Float32Array with 3 floats per electrode', () => {
    const { vertices } = buildElectrodeMesh(CUBE_ELECTRODES);
    expect(vertices).toBeInstanceOf(Float32Array);
    expect(vertices.length).toBe(CUBE_ELECTRODES.length * 3);
  });

  it('returns a Uint32Array for indices with length divisible by 3', () => {
    const { indices } = buildElectrodeMesh(CUBE_ELECTRODES);
    expect(indices).toBeInstanceOf(Uint32Array);
    expect(indices.length % 3).toBe(0);
  });

  it('all face indices are within the valid vertex range', () => {
    const { indices } = buildElectrodeMesh(CUBE_ELECTRODES);
    for (const idx of indices) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(CUBE_ELECTRODES.length);
    }
  });

  it('vertex coordinates match the input electrode positions', () => {
    const { vertices } = buildElectrodeMesh(CUBE_ELECTRODES);
    expect(vertices[0]).toBeCloseTo(CUBE_ELECTRODES[0].x);
    expect(vertices[1]).toBeCloseTo(CUBE_ELECTRODES[0].y);
    expect(vertices[2]).toBeCloseTo(CUBE_ELECTRODES[0].z);
  });
});

describe('gaussianRBF', () => {
  it('returns the electrode voltage when query point coincides with it', () => {
    const val = gaussianRBF([10, 0, 0], [[10, 0, 0]], [5.0], 30);
    expect(val).toBeCloseTo(5.0);
  });

  it('returns the average for two equidistant electrodes', () => {
    const val = gaussianRBF(
      [0, 0, 0],
      [
        [-1, 0, 0],
        [1, 0, 0],
      ],
      [2, 4],
      30
    );
    expect(val).toBeCloseTo(3.0);
  });

  it('nearby electrode dominates over a far one', () => {
    // close electrode has voltage +10, far electrode has voltage -10
    const val = gaussianRBF(
      [0, 0, 0],
      [
        [1, 0, 0],
        [200, 0, 0],
      ],
      [10, -10],
      30
    );
    expect(val).toBeGreaterThan(0);
  });

  it('returns 0 for an empty electrode list', () => {
    const val = gaussianRBF([0, 0, 0], [], [], 30);
    expect(val).toBe(0);
  });
});

describe('interpolateMeshVoltages', () => {
  it('returns a Float32Array with one value per electrode', () => {
    const matched = [{ pos: CUBE_ELECTRODES[0] }];
    const out = interpolateMeshVoltages(CUBE_ELECTRODES, matched, [1.0]);
    expect(out).toBeInstanceOf(Float32Array);
    expect(out.length).toBe(CUBE_ELECTRODES.length);
  });

  it('vertex at a matched electrode position gets approximately that voltage', () => {
    const matched = [{ pos: CUBE_ELECTRODES[0] }];
    const out = interpolateMeshVoltages(CUBE_ELECTRODES, matched, [10]);
    // Vertex 0 is exactly at CUBE_ELECTRODES[0] → distance 0 → weight dominates
    expect(out[0]).toBeCloseTo(10);
  });

  it('returns all zeros when no channels are matched', () => {
    const out = interpolateMeshVoltages(CUBE_ELECTRODES, [], []);
    expect(Array.from(out).every((v) => v === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildEegMesh
// ---------------------------------------------------------------------------

describe('buildEegMesh', () => {
  const matched = CUBE_ELECTRODES.slice(0, 3).map((el) => ({ pos: el }));
  const voltages = [10, -5, 3];

  it('returns vertices, indices, and scalars', () => {
    const result = buildEegMesh(CUBE_ELECTRODES, matched, voltages);
    expect(result).toHaveProperty('vertices');
    expect(result).toHaveProperty('indices');
    expect(result).toHaveProperty('scalars');
  });

  it('vertices is a Float32Array with 3 values per electrode', () => {
    const { vertices } = buildEegMesh(CUBE_ELECTRODES, matched, voltages);
    expect(vertices).toBeInstanceOf(Float32Array);
    expect(vertices.length).toBe(CUBE_ELECTRODES.length * 3);
  });

  it('scalars has one value per electrode', () => {
    const { scalars } = buildEegMesh(CUBE_ELECTRODES, matched, voltages);
    expect(scalars).toBeInstanceOf(Float32Array);
    expect(scalars.length).toBe(CUBE_ELECTRODES.length);
  });

  it('indices length is a multiple of 3', () => {
    const { indices } = buildEegMesh(CUBE_ELECTRODES, matched, voltages);
    expect(indices.length % 3).toBe(0);
  });
});
