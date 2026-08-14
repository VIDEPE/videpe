import { describe, it, expect } from 'vitest';
import { parseElectrodePositionTsv } from '@/loaders/parseElectrodePositionTsv';

describe('parseElectrodePositionTsv', () => {
  it('parses electrodes from a "name"-headered file already in mm', () => {
    const text = `name\tx\ty\tz
Fp1\t-29.0\t84.0\t-7.0
Fp2\t29.0\t84.0\t-7.0
`;
    const { electrodes } = parseElectrodePositionTsv(text);
    expect(electrodes).toEqual([
      { label: 'Fp1', x: -29.0, y: 84.0, z: -7.0 },
      { label: 'Fp2', x: 29.0, y: 84.0, z: -7.0 },
    ]);
  });

  it('accepts "label" as an alias for the "name" header column (MNE tsv exports)', () => {
    const text = `label\tx\ty\tz
Fp1\t-29.0\t84.0\t-7.0
Fp2\t29.0\t84.0\t-7.0
`;
    const { electrodes } = parseElectrodePositionTsv(text);
    expect(electrodes.map((e) => e.label)).toEqual(['Fp1', 'Fp2']);
  });

  it('leaves already-mm-scale coordinates unchanged', () => {
    const text = `name\tx\ty\tz
Fp1\t-29.0\t84.0\t-7.0
Fp2\t29.0\t84.0\t-7.0
`;
    const { electrodes } = parseElectrodePositionTsv(text);
    expect(electrodes[0]).toEqual({ label: 'Fp1', x: -29.0, y: 84.0, z: -7.0 });
  });

  // fsaverage_1005.tsv (MNE-Python) ships coordinates in meters with no unit header.
  // Typical human brain: 10-30 cm (estimation) =>
  // Meter-scale files: range ≈ 0.1-0.3 → always way below 10.
  // Mm-scale files (old .elc-style / typical head coordinates): range ≈ 150-300 → always way above 10.
  it('auto-detects meter-scale coordinates (small range, no unit header) and converts to mm', () => {
    const text = `label\tx\ty\tz
LPA\t-0.0820787224767085\t-0.0293041925438933\t-0.0411245510037724
RPA\t0.0834811119150642\t-0.0285034070849422\t-0.0407909563372145
Fp1\t-0.0292811604883705\t0.0839923366306848\t0.00271669935250412
`;
    const { electrodes, fiducials } = parseElectrodePositionTsv(text);
    expect(fiducials.LPA.x).toBeCloseTo(-82.0787224767085, 5);
    expect(fiducials.RPA.y).toBeCloseTo(-28.5034070849422, 5);
    expect(electrodes[0]).toMatchObject({ label: 'Fp1' });
    expect(electrodes[0].x).toBeCloseTo(-29.2811604883705, 5);
  });

  it('auto-detects centimeter-scale coordinates and converts to mm', () => {
    const text = `label\tx\ty\tz
LPA\t-8.20787224767085\t-2.93041925438933\t-4.11245510037724
RPA\t8.34811119150642\t-2.85034070849422\t-4.07909563372145
Fp1\t-2.92811604883705\t8.39923366306848\t0.271669935250412
`;
    const { electrodes, fiducials } = parseElectrodePositionTsv(text);
    expect(fiducials.LPA.x).toBeCloseTo(-82.0787224767085, 5);
    expect(electrodes[0]).toMatchObject({ label: 'Fp1' });
    expect(electrodes[0].x).toBeCloseTo(-29.2811604883705, 5);
  });

  it('classifies fiducials from a meter-scale file after conversion', () => {
    const text = `label\tx\ty\tz
LPA\t-0.082\t-0.029\t-0.041
RPA\t0.083\t-0.029\t-0.041
NAS\t0.002\t0.086\t-0.035
Fp1\t-0.029\t0.084\t0.003
`;
    const { fiducials, hasFiducials, electrodes } = parseElectrodePositionTsv(text);
    expect(hasFiducials).toBe(true);
    expect(fiducials.LPA).toBeDefined();
    expect(fiducials.RPA).toBeDefined();
    expect(fiducials.Nz).toBeDefined(); // "NAS" is a recognized alias for Nz
    expect(electrodes.map((e) => e.label)).toEqual(['Fp1']);
  });

  it('returns the empty default for empty input', () => {
    expect(parseElectrodePositionTsv('')).toEqual({
      electrodes: [],
      fiducials: {},
      hasFiducials: false,
    });
  });
});
