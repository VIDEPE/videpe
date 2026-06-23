// EEG topography utilities
// Electrode position parsing lives in src/loaders/parseElc.js (and future format parsers alongside it).

import convexHull from 'convex-hull';

// Strips recording-type prefixes ("EEG ", "MEG ") and reference suffixes ("-Ref", "-A1", " Ref", etc.)
// so that "EEG Fp1-Ref" normalises to "fp1" for lookup.
function normalizeChannelName(name) {
  return name
    .replace(/^(eeg|meg)\s+/i, '') // remove leading "EEG " / "MEG " prefix
    .replace(/-.*$/, '') // remove dash suffix (e.g. -Ref, -A1)
    .split(/\s+/)[0] // take first token (handles "Fp1 Ref" after prefix removal)
    .toLowerCase();
}

/**
 * Match raw EEG channel names against a parsed electrode position list.
 *
 * @param {string[]} channelNames  - channel labels from the EEG recording
 * @param {{ label: string, x: number, y: number, z: number }[]} electrodes - from parseElc
 * @returns {{ matched: { channelIdx: number, name: string, pos: object }[], unmatchedNames: string[] }}
 */
export function matchChannelsToPositions(channelNames, electrodes) {
  // Build a lookup map from normalised electrode label → electrode object
  const lookup = new Map();
  for (const el of electrodes) {
    lookup.set(el.label.toLowerCase(), el);
  }

  const matched = [];
  const unmatchedNames = [];

  for (let i = 0; i < channelNames.length; i++) {
    const name = channelNames[i];
    const pos = lookup.get(normalizeChannelName(name));
    if (pos) {
      matched.push({ channelIdx: i, name, pos });
    } else {
      unmatchedNames.push(name);
    }
  }

  return { matched, unmatchedNames };
}

// Build a triangulated mesh from electrode positions using their convex hull.
// Vertex order in the output matches the input electrodes array, so
// electrodes[i] corresponds to vertices[i*3 .. i*3+2].
//
// @param {{ label, x, y, z }[]} electrodes
// @returns {{ vertices: Float32Array, indices: Uint32Array }}
export function buildElectrodeMesh(electrodes) {
  const points = electrodes.map((e) => [e.x, e.y, e.z]);
  const faces = convexHull(points);

  // NiiVue expects all vertex positions as a single flat Float32Array: [x0,y0,z0, x1,y1,z1, ...]
  // One electrode = one vertex = three consecutive numbers. 346 electrodes → 1038 numbers.
  const vertices = new Float32Array(electrodes.length * 3);
  for (let i = 0; i < electrodes.length; i++) {
    vertices[i * 3] = electrodes[i].x;
    vertices[i * 3 + 1] = electrodes[i].y;
    vertices[i * 3 + 2] = electrodes[i].z;
  }

  // Flattens the faces into a Uint32Array [i0,j0,k0, i1,j1,k1, ...] of indices NiiVue expects
  // Each triplet references three vertex indices that form one triangle on the mesh surface.
  const indices = new Uint32Array(faces.length * 3);
  for (let i = 0; i < faces.length; i++) {
    indices[i * 3] = faces[i][0];
    indices[i * 3 + 1] = faces[i][1];
    indices[i * 3 + 2] = faces[i][2];
  }

  return { vertices, indices };
}

// Gaussian radial basis interpolation at a single 3D query point.
// Uses Euclidean distance in MNI mm space — no unit-sphere projection needed
// since electrode positions from .elc already follow the actual head shape.
//
// @param {[number,number,number]} queryXYZ
// @param {[number,number,number][]} matchedXYZ  - positions of matched electrodes
// @param {number[]} voltages                    - voltage per matched electrode
// @param {number} sigma                         - falloff in mm (default 30mm ≈ 2 electrode spacings)
// @returns {number}
export function gaussianRBF(queryXYZ, matchedXYZ, voltages, sigma = 30) {
  let weightedSum = 0;
  let weightSum = 0;
  const twoSigmaSq = 2 * sigma * sigma;

  for (let i = 0; i < matchedXYZ.length; i++) {
    const dx = queryXYZ[0] - matchedXYZ[i][0];
    const dy = queryXYZ[1] - matchedXYZ[i][1];
    const dz = queryXYZ[2] - matchedXYZ[i][2];
    const w = Math.exp(-(dx * dx + dy * dy + dz * dz) / twoSigmaSq);
    weightedSum += w * voltages[i];
    weightSum += w;
  }

  return weightSum > 0 ? weightedSum / weightSum : 0;
}

// Compute a per-vertex scalar (voltage) for every vertex in the electrode mesh.
// Vertices that sit at a matched electrode get a weight-dominated value from that
// electrode; all other vertices are filled by Gaussian RBF from the matched set.
//
// @param {{ label, x, y, z }[]} electrodes  - full electrode list (determines vertex order)
// @param {{ pos: { x, y, z } }[]} matched   - matched channel entries from matchChannelsToPositions
// @param {number[]} voltages                 - voltage per matched entry (same order as matched)
// @param {number} sigma                      - Gaussian falloff in mm
// @returns {Float32Array}
export function interpolateMeshVoltages(electrodes, matched, voltages, sigma = 30) {
  const matchedXYZ = matched.map((m) => [m.pos.x, m.pos.y, m.pos.z]);
  const scalars = new Float32Array(electrodes.length);

  for (let i = 0; i < electrodes.length; i++) {
    scalars[i] = gaussianRBF(
      [electrodes[i].x, electrodes[i].y, electrodes[i].z],
      matchedXYZ,
      voltages,
      sigma
    );
  }

  return scalars;
}

// Assemble the full mesh data for a single EEG timepoint.
// Returns raw arrays rather than an ArrayBuffer so this function stays
// framework-free and testable — the caller (EegTopoWindow) passes the result
// to NVMeshUtilities.createMZ3() to get the buffer NiiVue loads.
//
// @param {{ label, x, y, z }[]} electrodes  - full electrode list from parseElc
// @param {{ pos: { x, y, z } }[]} matched   - matched channels from matchChannelsToPositions
// @param {number[]} voltages                 - re-referenced voltage per matched channel
// @param {number} sigma                      - Gaussian falloff in mm (default 30)
// @returns {{ vertices: Float32Array, indices: Uint32Array, scalars: Float32Array }}
export function buildEegMesh(electrodes, matched, voltages, sigma = 30) {
  const { vertices, indices } = buildElectrodeMesh(electrodes);
  const scalars = interpolateMeshVoltages(electrodes, matched, voltages, sigma);
  return { vertices, indices, scalars };
}
