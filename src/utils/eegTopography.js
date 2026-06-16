import { ELECTRODE_POSITIONS } from './eeg10_20_positions.js';

// ─── Channel matching ─────────────────────────────────────────────────────────

// Normalize a raw channel label to a plain electrode name for lookup.
// Handles common suffixes from BrainVision and other recording systems:
//   "Fp1-Ref" → "Fp1",  "EEG Fp1-Ref" → "Fp1",  "FP1" → "fp1" (case-insensitive)
function normalizeLabel(raw) {
  return raw
    .split(/\s+/)
    .pop() // take the last word if space-separated (e.g. "EEG Fp1-Ref" → "Fp1-Ref")
    .replace(/[-_](ref|avg|avr|le|re|a1|a2|eeg|car|lm|rm)$/i, '') // strip reference suffixes
    .toLowerCase();
}

// Find a matching key in the positions map for a given raw channel name.
// Returns the matched key (preserving its original casing) or null.
function resolveLabel(rawName, positions) {
  const normalized = normalizeLabel(rawName);
  for (const key of Object.keys(positions)) {
    if (key.toLowerCase() === normalized) return key;
  }
  return null;
}

// Match an array of channelNames to electrode positions.
// Returns:
//   matched      – [{channelIdx, name, pos}] for every channel that resolved to a position
//   unmatchedNames – raw names of channels with no position mapping
// An optional extraPositions map (from a loaded electrodes.tsv) is merged in before matching.
export function matchChannelsToPositions(channelNames, extraPositions = {}) {
  const positions = { ...ELECTRODE_POSITIONS, ...extraPositions };
  const matched = [];
  const unmatchedNames = [];

  channelNames.forEach((name, channelIdx) => {
    const key = resolveLabel(name, positions);
    if (key) {
      matched.push({ channelIdx, name, pos: positions[key] });
    } else {
      unmatchedNames.push(name);
    }
  });

  return { matched, unmatchedNames };
}

// Parse a BIDS-format electrodes.tsv file into a name → {x, y, z} map.
// TSV must have a header row with at least "name", "x", "y", "z" columns.
// Positions are assumed to be in mm in head space; we normalize to unit sphere.
export function parseElectrodesTsv(tsvText) {
  const lines = tsvText.trim().split('\n');
  if (lines.length < 2) return {};

  const headers = lines[0].split('\t').map((h) => h.trim().toLowerCase());
  const nameIdx = headers.indexOf('name');
  const xIdx = headers.indexOf('x');
  const yIdx = headers.indexOf('y');
  const zIdx = headers.indexOf('z');

  if (nameIdx < 0 || xIdx < 0 || yIdx < 0 || zIdx < 0) return {};

  const result = {};
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t');
    const name = cols[nameIdx]?.trim();
    const x = parseFloat(cols[xIdx]);
    const y = parseFloat(cols[yIdx]);
    const z = parseFloat(cols[zIdx]);
    if (!name || isNaN(x) || isNaN(y) || isNaN(z)) continue;

    // Normalize to unit sphere
    const r = Math.sqrt(x * x + y * y + z * z);
    if (r < 1e-6) continue; // skip degenerate positions
    result[name] = { x: x / r, y: y / r, z: z / r };
  }
  return result;
}

// ─── Voltage processing ───────────────────────────────────────────────────────

// Subtract the cross-channel mean at this timepoint to remove the reference
// electrode offset. Returns a new array (does not mutate the input).
export function averageReference(voltages) {
  if (voltages.length === 0) return [];
  const mean = voltages.reduce((s, v) => s + v, 0) / voltages.length;
  return voltages.map((v) => v - mean);
}

// ─── Spatial interpolation ────────────────────────────────────────────────────

// Gaussian weighted average of electrode voltages at a point on the unit sphere.
// electrodes: [{pos: {x,y,z}, voltage: number}]
// sigma: smoothing radius in radians. 0.4 rad ≈ 23°, spans roughly one inter-
//   electrode step in the 10-10 system — smooth enough to cover gaps, sharp
//   enough to preserve local structure.
function gaussianRBF(px, py, pz, electrodes, sigma) {
  const twoSigmaSq = 2 * sigma * sigma;
  let weightedSum = 0;
  let weightSum = 0;

  for (const { pos, voltage } of electrodes) {
    // Arc-distance via dot product (clamped to [-1,1] for numerical safety near ±180°)
    const dot = Math.max(-1, Math.min(1, px * pos.x + py * pos.y + pz * pos.z));
    const arcDist = Math.acos(dot);
    const weight = Math.exp(-(arcDist * arcDist) / twoSigmaSq);
    weightedSum += voltage * weight;
    weightSum += weight;
  }

  return weightSum > 1e-10 ? weightedSum / weightSum : 0;
}

// ─── 3-D volume builder ───────────────────────────────────────────────────────

// Build a dim×dim×dim Float32 volume with interpolated EEG voltage values.
// Voxels outside the unit sphere are set to 0 (they will appear as neutral /
// white in the diverging colormap, visually identical to the sphere edge).
// The sphere represents a 200 mm diameter head (voxel size = 200/dim mm).
//
// electrodes: [{pos: {x,y,z}, voltage: number}]
// dim: grid resolution (default 64, giving 3.125 mm/voxel)
// sigma: Gaussian smoothing radius in radians (default 0.4)
export function buildEegVolume(electrodes, dim = 64, sigma = 0.4) {
  const half = dim / 2;
  const data = new Float32Array(dim * dim * dim);

  if (electrodes.length === 0) return data; // no matched channels → blank volume

  for (let iz = 0; iz < dim; iz++) {
    for (let iy = 0; iy < dim; iy++) {
      for (let ix = 0; ix < dim; ix++) {
        // Map voxel index to unit-sphere coordinates.
        // ix = half  →  px = 0 (center); ix = 0  →  px = -1 (left edge).
        const px = (ix - half) / half;
        const py = (iy - half) / half;
        const pz = (iz - half) / half;
        const r = Math.sqrt(px * px + py * py + pz * pz);

        if (r >= 1.0) {
          // Outside sphere — leave as 0 (masked by neutral colormap value)
          continue;
        }

        // Project the interior point outward to the sphere surface so that
        // the interpolation uses only surface-level electrode distances.
        // Interior voxels get the same color as the nearest surface point
        // directly above them, giving the sphere a solid filled appearance.
        const scale = r > 1e-6 ? 1 / r : 0;
        const voxelIdx = iz * dim * dim + iy * dim + ix; // NIfTI: x fastest
        data[voxelIdx] = gaussianRBF(px * scale, py * scale, pz * scale, electrodes, sigma);
      }
    }
  }

  return data;
}

// ─── NIfTI-1 serialiser ───────────────────────────────────────────────────────

// Serialise a Float32 voxel array into a minimal NIfTI-1 single-file (.nii)
// ArrayBuffer ready to load via a blob URL into NiiVue.
//
// The volume is centred at world-space origin with a 200 mm diameter sphere:
//   voxelMm = 200 / dim   (3.125 mm for dim = 64)
//   origin  = −(dim/2) × voxelMm  (= −100 mm for dim = 64)
// sform/qform matrices encode this so NiiVue knows the physical extent.
export function buildNiftiBuffer(float32Data, dim) {
  const voxelMm = 200 / dim;
  const origin = -(dim / 2) * voxelMm; // world coordinate of voxel 0 centre

  const HEADER_BYTES = 348;
  const EXTENSION_BYTES = 4; // required zero-padded extension block for n+1 format
  const buffer = new ArrayBuffer(HEADER_BYTES + EXTENSION_BYTES + float32Data.byteLength);
  const dv = new DataView(buffer);

  const writeStr = (offset, str, maxLen) => {
    for (let i = 0; i < maxLen; i++) {
      dv.setUint8(offset + i, i < str.length ? str.charCodeAt(i) : 0);
    }
  };

  // sizeof_hdr — must be 348 for NIfTI-1
  dv.setInt32(0, 348, true);
  // regular — must be 'r' (0x72)
  dv.setUint8(38, 0x72);

  // dim[0] = number of dimensions, dim[1..3] = x/y/z sizes, rest = 1
  dv.setInt16(40, 3, true); // ndim
  dv.setInt16(42, dim, true); // x
  dv.setInt16(44, dim, true); // y
  dv.setInt16(46, dim, true); // z
  dv.setInt16(48, 1, true);
  dv.setInt16(50, 1, true);
  dv.setInt16(52, 1, true);
  dv.setInt16(54, 1, true);

  // datatype = 16 (DT_FLOAT32), bitpix = 32
  dv.setInt16(70, 16, true);
  dv.setInt16(72, 32, true);

  // pixdim[0] = qfac (1 = no flip), [1..3] = voxel size in mm
  dv.setFloat32(76, 1, true);
  dv.setFloat32(80, voxelMm, true);
  dv.setFloat32(84, voxelMm, true);
  dv.setFloat32(88, voxelMm, true);

  // vox_offset: data starts at byte 352 (header + extension block)
  dv.setFloat32(108, 352, true);

  // xyzt_units = 2 → NIFTI_UNITS_MM for spatial, no temporal units
  dv.setUint8(123, 2);

  // descrip — human-readable label (up to 80 chars)
  writeStr(148, 'EEG Topography', 80);

  // qform_code = 1 (scanner coords), sform_code = 1
  dv.setInt16(252, 1, true);
  dv.setInt16(254, 1, true);

  // qoffset — origin of voxel (0,0,0) in mm
  dv.setFloat32(268, origin, true); // qoffset_x
  dv.setFloat32(272, origin, true); // qoffset_y
  dv.setFloat32(276, origin, true); // qoffset_z

  // srow_x: world_x = voxelMm × ix + origin
  dv.setFloat32(280, voxelMm, true);
  dv.setFloat32(284, 0, true);
  dv.setFloat32(288, 0, true);
  dv.setFloat32(292, origin, true);
  // srow_y
  dv.setFloat32(296, 0, true);
  dv.setFloat32(300, voxelMm, true);
  dv.setFloat32(304, 0, true);
  dv.setFloat32(308, origin, true);
  // srow_z
  dv.setFloat32(312, 0, true);
  dv.setFloat32(316, 0, true);
  dv.setFloat32(320, voxelMm, true);
  dv.setFloat32(324, origin, true);

  // magic — "n+1\0" for a single-file NIfTI
  writeStr(344, 'n+1\0', 4);

  // Extension block (4 bytes of zeros — no extensions used)
  // (ArrayBuffer is zero-initialised by spec, so nothing to write here)

  // Copy voxel data starting at byte 352
  new Float32Array(buffer, HEADER_BYTES + EXTENSION_BYTES).set(float32Data);

  return buffer;
}
