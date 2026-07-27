// EEG topography utilities
// Electrode position parsing lives in src/loaders/parseElcElectrodePositions.js (and future format parsers alongside it).

import convexHull from 'convex-hull';
import { parseElectrodeContactName } from './intracranialDetection';
import { INTRACRANIAL_CONNECTOME_URL } from '@/utils/NiiViewer.utils';

// Strips recording-type prefixes ("EEG ", "MEG ") and reference suffixes ("-Ref", "-A1", " Ref", etc.)
// so that "EEG Fp1-Ref" normalises to "fp1" for lookup.
export function normalizeChannelName(name) {
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
 * @param {{ label: string, x: number, y: number, z: number }[]} electrodes - from parseElcElectrodePositions
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

/**
 * Build a triangulated mesh from electrode positions using their convex hull.
 * Vertex order in the output matches the input electrodes array, so
 * electrodes[i] corresponds to vertices[i*3 .. i*3+2].
 *
 * @param {{ label, x, y, z }[]} electrodes
 * @returns {{ vertices: Float32Array, indices: Uint32Array }}
*/
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

/**
 * Gaussian radial basis interpolation at a single 3D query point.
 * Uses Euclidean distance in MNI mm space — no unit-sphere projection needed
 * since electrode positions from .elc already follow the actual head shape.
 *
 * @param {[number,number,number]} queryXYZ
 * @param {[number,number,number][]} matchedXYZ  - positions of matched electrodes
 * @param {number[]} voltages                    - voltage per matched electrode
 * @param {number} sigma                         - falloff in mm (default 30mm ≈ 2 electrode spacings)
 * @returns {number}
*/
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

/**
 * Compute a per-vertex scalar (voltage) for every vertex in the electrode mesh.
 * Vertices that sit at a matched electrode get a weight-dominated value from that
 * electrode; all other vertices are filled by Gaussian RBF from the matched set.
 *
 * @param {{ label, x, y, z }[]} electrodes  - full electrode list (determines vertex order)
 * @param {{ pos: { x, y, z } }[]} matched   - matched channel entries from matchChannelsToPositions
 * @param {number[]} voltages                 - voltage per matched entry (same order as matched)
 * @param {number} sigma                      - Gaussian falloff in mm
 * @returns {Float32Array}
*/
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

/**
 * Build one marker per template electrode for rendering individual electrode
 * positions alongside the interpolated mesh surface. Matched electrodes carry
 * their real, signed voltage so they can be highlighted distinctly from the
 * rest of the template grid, which has no recorded data to show.
 *
 * @param {{ label, x, y, z }[]} electrodes  - full electrode list from the template
 * @param {{ pos: { label, x, y, z } }[]} matched - matched channels from matchChannelsToPositions
 * @param {number[]} voltages                 - voltage per matched entry (same order as matched)
 * @returns {{ label, x, y, z, isMatched, value }[]}
*/
export function buildElectrodeMarkers(electrodes, matched, voltages) {
  const voltageByLabel = new Map();
  matched.forEach((m, i) => voltageByLabel.set(m.pos.label, voltages[i] ?? 0));

  return electrodes.map((e) => {
    const isMatched = voltageByLabel.has(e.label);
    return {
      label: e.label,
      x: e.x,
      y: e.y,
      z: e.z,
      isMatched,
      value: isMatched ? voltageByLabel.get(e.label) : 0,
    };
  });
}

/**
 * Assemble the full mesh data for a single EEG timepoint.
 * Returns raw arrays rather than an ArrayBuffer so this function stays
 * framework-free and testable — the caller (EegTopoWindow) passes the result
 * to NVMeshUtilities.createMZ3() to get the buffer NiiVue loads.
 *
 * @param {{ label, x, y, z }[]} electrodes  - full electrode list from parseElcElectrodePositions
 * @param {{ pos: { x, y, z } }[]} matched   - matched channels from matchChannelsToPositions
 * @param {number[]} voltages                 - re-referenced voltage per matched channel
 * @param {number} sigma                      - Gaussian falloff in mm (default 30)
 * @returns {{ vertices: Float32Array, indices: Uint32Array, scalars: Float32Array }}
*/
export function buildEegMesh(electrodes, matched, voltages, sigma = 30) {
  const { vertices, indices } = buildElectrodeMesh(electrodes);
  const scalars = interpolateMeshVoltages(electrodes, matched, voltages, sigma);
  return { vertices, indices, scalars };
}

/**
 * Groups intracranial channel names by parsed electrode group and contact number,
 * sorted ascending within each group — the row/column structure the intracranial
 * topography matrix renders. Needs only channel names + a voltage per channel
 * index, no electrode positions, since this view has no position-file gate.
 * Channels that don't fit the group+contact shape (e.g. "ECG") aren't dropped —
 * they're returned separately in `unparsed` so the caller can still surface them,
 * just not as a matrix row/column.
 *
 * @param {string[]} channelNames
 * @param {number[]} voltages  - one per channelNames index
 * @returns {{
 *   groups: { group: string, contacts: { contact: number, channelIdx: number, voltage: number }[] }[],
 *   unparsed: { channelIdx: number, name: string }[]
*/
export function buildIntracranialMatrix(channelNames, voltages) {
  const groupMap = new Map(); // electrode group -> its contacts, accumulated in channel order
  const unparsed = [];

  channelNames.forEach((name, channelIdx) => {
    const parsed = parseElectrodeContactName(name);
    if (!parsed) {
      unparsed.push({ channelIdx, name }); // doesn't fit the group+contact shape — not a row
      return;
    }
    const { group, contact } = parsed;
    if (!groupMap.has(group)) groupMap.set(group, []);
    groupMap.get(group).push({ contact, channelIdx, voltage: voltages[channelIdx] ?? 0 });
  });

  const groups = Array.from(groupMap.entries())
    .sort(([a], [b]) => a.localeCompare(b)) // alphabetical row order, e.g. "b" before "b'"
    .map(([group, contacts]) => ({
      group,
      contacts: contacts.slice().sort((a, b) => a.contact - b.contact), // ascending column order
    }));

  return { groups, unparsed };
}

/**
 * Builds connectome nodes (one per matched intracranial electrode contact, colored
 * by voltage) and edges connecting consecutive *existing* contacts within the same
 * electrode group — one polyline per physical probe shaft. Contacts are connected
 * in sorted-contact-number order among the matched set, so a missing contact (e.g.
 * no channel for B3) is skipped rather than breaking the shaft into two pieces.
 *
 * @param {{ channelIdx, name, pos: { x, y, z } }[]} matched - from matchChannelsToPositions
 * @param {number[]} voltages  - one per matched entry (same order as matched)
 * @returns {{
 *   nodes: { name, x, y, z, colorValue, sizeValue }[],
 *   edges: { first: number, second: number, colorValue: number }[]
*/
export function buildIntracranialConnectome(matched, voltages) {
  // One node per matched contact — node index i corresponds to matched[i]/voltages[i].
  const nodes = matched.map((m, i) => ({
    name: m.name,
    x: m.pos.x,
    y: m.pos.y,
    z: m.pos.z,
    colorValue: voltages[i] ?? 0,
    sizeValue: 1,
  }));

  const groupMap = new Map(); // electrode group -> { contact, nodeIndex, voltage }[]
  matched.forEach((m, nodeIndex) => {
    const parsed = parseElectrodeContactName(m.name);
    if (!parsed) return; // not on a probe shaft — no edge to draw for this contact
    if (!groupMap.has(parsed.group)) groupMap.set(parsed.group, []);
    groupMap
      .get(parsed.group)
      .push({ contact: parsed.contact, nodeIndex, voltage: voltages[nodeIndex] ?? 0 });
  });

  const edges = [];
  for (const contacts of groupMap.values()) {
    const sorted = contacts.slice().sort((a, b) => a.contact - b.contact); // shaft order, gaps just absent
    for (let i = 0; i < sorted.length - 1; i++) {
      edges.push({
        first: sorted[i].nodeIndex,
        second: sorted[i + 1].nodeIndex,
        colorValue: (sorted[i].voltage + sorted[i + 1].voltage) / 2, // edges carry no real data — just shade by their endpoints
      });
    }
  }

  return { nodes, edges };
}

/**
 * Pure derivation of the Neuroimaging pane's "connectome volume" layer entry from
 * the EEG state lifted out of EegViewer. Returns null when there's nothing to show
 * yet (not an intracranial recording, or no position-matched channels), so
 * PatientView.jsx can stay a thin orchestrator with no electrode-specific logic
 * of its own.
 *
 * @param {{ isIntracranial: boolean, matched: object[], voltages: number[] }} args
 * @returns {object | null}
*/
export function buildIntracranialLayer({ isIntracranial, matched, voltages }) {
  if (!isIntracranial || !matched?.length) return null; // nothing to render yet

  const { nodes, edges } = buildIntracranialConnectome(matched, voltages);
  const calMax = Math.max(1e-6, ...voltages.map((v) => Math.abs(v))); // symmetric colour range; floor avoids div-by-zero downstream

  return {
    url: INTRACRANIAL_CONNECTOME_URL,
    name: 'Intracranial Electrodes',
    type: 'Intracranial',
    subtype: 'Electrodes',
    kind: 'connectome',
    nodes,
    edges,
    calMax,
  };
}
