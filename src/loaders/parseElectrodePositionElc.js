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

// Unit multipliers to convert any .elc unit to mm.
const TO_MM = { mm: 1, cm: 10, m: 1000 };

// Parse an ASA .elc file text into electrode positions and fiducials.
//
// Returns:
//   electrodes  – [{ label, x, y, z }] in mm, fiducials excluded
//   fiducials   – { LPA?, RPA?, Nz? } each { x, y, z } in mm
//   hasFiducials – true only when all three of LPA, RPA, Nz were found
export function parseElectrodePositionElc(text) {
  const result = { electrodes: [], fiducials: {}, hasFiducials: false };
  // Guard close if text is empty => returns default (empty) electrodes, fiducials and hasFiducial=false
  if (!text || !text.trim()) return result;

  const lines = text.split('\n').map((l) => l.trim());

  // Read unit from header (default mm if not specified)
  const unitLine = lines.find((l) => l.toLowerCase().startsWith('unitposition'));
  const unitKey = unitLine ? unitLine.split(/\s+/)[1]?.toLowerCase() : 'mm';
  const scale = TO_MM[unitKey] ?? 1;

  // Find section boundaries
  const posStart = lines.findIndex((l) => l.toLowerCase() === 'positions');
  const labelStart = lines.findIndex((l) => l.toLowerCase() === 'labels');
  if (posStart < 0 || labelStart < 0) return result;

  const posLines = lines.slice(posStart + 1, labelStart);
  const labelLines = lines.slice(labelStart + 1).filter((l) => l.length > 0); // the filter drops any blank lines

  // Match labels with electrode positions x,y,z
  for (let i = 0; i < labelLines.length; i++) {
    const label = labelLines[i];
    const parts = posLines[i]?.split(/\s+/);
    if (!parts || parts.length < 3) continue;

    const x = parseFloat(parts[0]) * scale;
    const y = parseFloat(parts[1]) * scale;
    const z = parseFloat(parts[2]) * scale;
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
