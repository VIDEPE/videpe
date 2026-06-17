import { describe, it, expect } from 'vitest';
import { parseElc } from '@/loaders/parseElc';

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

describe('parseElc', () => {
  it('returns the correct number of electrodes (fiducials excluded)', () => {
    const { electrodes } = parseElc(MINIMAL_ELC);
    expect(electrodes.length).toBe(2);
  });

  it('parses electrode labels correctly', () => {
    const { electrodes } = parseElc(MINIMAL_ELC);
    expect(electrodes[0].label).toBe('Fp1');
    expect(electrodes[1].label).toBe('Fp2');
  });

  it('parses electrode xyz coordinates correctly', () => {
    const { electrodes } = parseElc(MINIMAL_ELC);
    expect(electrodes[0].x).toBeCloseTo(-29.0);
    expect(electrodes[0].y).toBeCloseTo(84.0);
    expect(electrodes[0].z).toBeCloseTo(-7.0);
  });

  it('detects all three standard fiducials', () => {
    const { fiducials } = parseElc(MINIMAL_ELC);
    expect(fiducials.LPA).toBeDefined();
    expect(fiducials.RPA).toBeDefined();
    expect(fiducials.Nz).toBeDefined();
  });

  it('parses fiducial coordinates correctly', () => {
    const { fiducials } = parseElc(MINIMAL_ELC);
    expect(fiducials.LPA.x).toBeCloseTo(-86.0);
    expect(fiducials.LPA.y).toBeCloseTo(-20.0);
    expect(fiducials.LPA.z).toBeCloseTo(-48.0);
  });

  it('reports hasFiducials true when all three are present', () => {
    const { hasFiducials } = parseElc(MINIMAL_ELC);
    expect(hasFiducials).toBe(true);
  });

  it('reports hasFiducials false when fiducials are missing', () => {
    const noFids = MINIMAL_ELC.replace('LPA', 'Fp3').replace('RPA', 'Fp4').replace('Nz', 'Fp5');
    const { hasFiducials } = parseElc(noFids);
    expect(hasFiducials).toBe(false);
  });

  it('converts cm to mm', () => {
    const cmElc = MINIMAL_ELC.replace('UnitPosition\tmm', 'UnitPosition\tcm');
    const { electrodes } = parseElc(cmElc);
    expect(electrodes[0].x).toBeCloseTo(-290.0); // -29.0 cm × 10
  });

  it('returns empty arrays for empty input', () => {
    const { electrodes, fiducials, hasFiducials } = parseElc('');
    expect(electrodes).toEqual([]);
    expect(fiducials).toEqual({});
    expect(hasFiducials).toBe(false);
  });

  it('skips lines with missing or non-numeric coordinates', () => {
    const bad = MINIMAL_ELC.replace('-29.0 84.0 -7.0', 'n/a n/a n/a');
    const { electrodes } = parseElc(bad);
    expect(electrodes.length).toBe(1); // only Fp2 survives
  });
});
