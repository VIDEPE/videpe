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

// Parse an .tsv file text into electrode positions and fiducials.
//
// Returns:
//   electrodes  – [{ label, x, y, z }] in mm, fiducials excluded
//   fiducials   – { LPA?, RPA?, Nz? } each { x, y, z } in mm
//   hasFiducials – true only when all three of LPA, RPA, Nz were found
export function parseTsvElectrodePositions(text) {
  const result = { electrodes: [], fiducials: {}, hasFiducials: false };
  // Guard close if text is empty => returns default (empty) electrodes, fiducials and hasFiducial=false
  if (!text || !text.trim()) return result;

  const lines = text.split('\n').map((l) => l.trim());

  const header = lines[0].split('\t');
  const elecLines = lines.splice(1);

  const nameIndex = header.findIndex((element) => element === 'name');
  const xIndex = header.findIndex((element) => element === 'x');
  const yIndex = header.findIndex((element) => element === 'y');
  const zIndex = header.findIndex((element) => element === 'z');

  for (let i = 0; i < elecLines.length; i++) {
    const elec = elecLines[i].split('\t')

    const label = elec[nameIndex];

    // units should be in [mm]
    const x = parseFloat(elec[xIndex]);
    const y = parseFloat(elec[yIndex]);
    const z = parseFloat(elec[zIndex]);

    // Check if all coordinates are found
    if (isNaN(x) || isNaN(y) || isNaN(z)) continue;

    // Check if the label is a fiducial point, if so, add to fiducials instead of electrodes
    const fidKey = classifyFiducial(label);
    if (fidKey) {
      result.fiducials[fidKey] = { x, y, z };
    } else {
      result.electrodes.push({ label, x, y, z });
    }

  }

  // Check if all 3 fiducial points are present => hasFiducials === true
  result.hasFiducials = ['LPA', 'RPA', 'Nz'].every((k) => k in result.fiducials);
  return result;
}
