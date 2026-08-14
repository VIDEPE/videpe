import { inferMmScaleFromRange } from '@/utils/inferElectrodePositionUnitScale';

// Labels used by different recording systems for the three standard fiducials.
const FIDUCIAL_LABELS = {
  LPA: ['lpa', 'fidt9', 'las', 'left'],
  RPA: ['rpa', 'fidt10', 'ras', 'right'],
  Nz: ['nz', 'fidnz', 'nas', 'nasion'],
};

function classifyFiducial(label) {
  const lower = label.toLowerCase();
  for (const [key, aliases] of Object.entries(FIDUCIAL_LABELS)) {
    if (aliases.includes(lower)) return key;
  }
  return null;
}

// Parse a .tsv file text into electrode positions and fiducials.
//
// Returns:
//   electrodes  – [{ label, x, y, z }] in mm, fiducials excluded
//   fiducials   – { LPA?, RPA?, Nz? } each { x, y, z } in mm
//   hasFiducials – true only when all three of LPA, RPA, Nz were found
export function parseElectrodePositionTsv(text) {
  const result = { electrodes: [], fiducials: {}, hasFiducials: false };
  // Guard close if text is empty => returns default (empty) electrodes, fiducials and hasFiducial=false
  if (!text || !text.trim()) return result;

  const lines = text.split('\n').map((l) => l.trim());

  const header = lines[0].split('\t');
  const elecLines = lines.slice(1).filter((l) => l.length > 0);

  // "label" is MNE-Python's tsv montage export header; "name" is this app's own
  // convention for user-supplied files (see parseElectrodePositionFile.test.js).
  const nameIndex = header.findIndex((element) => element === 'name' || element === 'label');
  const xIndex = header.findIndex((element) => element === 'x');
  const yIndex = header.findIndex((element) => element === 'y');
  const zIndex = header.findIndex((element) => element === 'z');

  const rows = [];
  for (let i = 0; i < elecLines.length; i++) {
    const elec = elecLines[i].split('\t');

    const label = elec[nameIndex];
    const x = parseFloat(elec[xIndex]);
    const y = parseFloat(elec[yIndex]);
    const z = parseFloat(elec[zIndex]);

    // Check if the label and all coordinates are found
    if (!label || isNaN(x) || isNaN(y) || isNaN(z)) continue;
    rows.push({ label, x, y, z });
  }
  if (rows.length === 0) return result;

  // No unit header in this format, so units are inferred from coordinate magnitude.
  const scale = inferMmScaleFromRange(rows.flatMap((r) => [r.x, r.y, r.z]));

  for (const { label, x, y, z } of rows) {
    const scaled = { x: x * scale, y: y * scale, z: z * scale };
    // Check if the label is a fiducial point, if so, add to fiducials instead of electrodes
    const fidKey = classifyFiducial(label);
    if (fidKey) {
      result.fiducials[fidKey] = scaled;
    } else {
      result.electrodes.push({ label, ...scaled });
    }
  }

  // Check if all 3 fiducial points are present => hasFiducials === true
  result.hasFiducials = ['LPA', 'RPA', 'Nz'].every((k) => k in result.fiducials);
  return result;
}
