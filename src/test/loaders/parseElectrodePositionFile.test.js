import { describe, it, expect } from 'vitest';
import { parseElectrodePositionFile } from '@/loaders/parseElectrodePositionFile';

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

const MINIMAL_TSV = `name	x	y	z
Fp1	-29.0	84.0	-7.0
Fp2	29.0	84.0	-7.0
`;

describe('parseElectrodePositionFile', () => {
  it('routes .elc files to parseElectrodePositionElc', async () => {
    const file = new File([MINIMAL_ELC], 'positions.elc');
    const { electrodes } = await parseElectrodePositionFile(file);
    expect(electrodes.map((e) => e.label)).toEqual(['Fp1', 'Fp2']);
  });

  it('routes .tsv files to parseElectrodePositionTsv', async () => {
    const file = new File([MINIMAL_TSV], 'positions.tsv');
    const { electrodes } = await parseElectrodePositionFile(file);
    expect(electrodes.map((e) => e.label)).toEqual(['Fp1', 'Fp2']);
  });

  it('is case-insensitive about the extension', async () => {
    const file = new File([MINIMAL_ELC], 'positions.ELC');
    const { electrodes } = await parseElectrodePositionFile(file);
    expect(electrodes).toHaveLength(2);
  });

  it('rejects with a descriptive error for an unsupported extension', async () => {
    const file = new File(['irrelevant'], 'positions.txt');
    await expect(parseElectrodePositionFile(file)).rejects.toThrow(/\.txt/);
  });
});
