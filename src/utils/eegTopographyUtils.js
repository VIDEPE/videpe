// EEG topography utilities
// Electrode position parsing lives in src/loaders/parseElectrodePositionElc.js (and future format parsers alongside it).

import convexHull from 'convex-hull';
import { parseElectrodeContactName } from './intracranialDetection';
import { ELECTRODE_LAYER_URL } from '@/utils/NiiViewer.utils';

// ─── Channel matching ───────────────────────────────────────────────────────
// Maps raw EEG channel names onto parsed electrode template positions.

// Strips recording-type prefixes ("EEG ", "MEG ") and dash reference suffixes ("-Ref", "-A1", etc.)
// so that "EEG Fp1-Ref" normalises to "fp1" for lookup. Does not touch spaces within the
// remaining name — some formats (e.g. sEEG contact labels like "R latOrbG1") use a space
// as part of the label itself, not as a suffix separator.
export function normalizeChannelName(name) {
  return name
    .replace(/^(eeg|meg)\s+/i, '') // remove leading "EEG " / "MEG " prefix
    .replace(/-.*$/, '') // remove dash suffix (e.g. -Ref, -A1)
    .toLowerCase();
}

/**
 * Finds channel names that occur more than once (after normalizeChannelName) — used to
 * reject a recording outright at load time rather than silently mishandle it downstream.
 * A duplicate name is more than a cosmetic problem: channelSettings keys its per-channel
 * type/bad state by name, so two channels sharing a name already collapse into one shared
 * entry today; ESI's channel matching likewise can't tell which physical channel a model's
 * channel name refers to and has to refuse to compute for it (see
 * electricalSourceImagingUtils.js's buildChannelNameIndex).
 *
 * @param {string[]} channelNames
 * @returns {string[]} the (normalized) names that occur more than once, deduplicated —
 *   empty when every name is unique
 */
export function findDuplicateChannelNames(channelNames) {
  const seen = new Set();
  const duplicates = new Set();
  for (const name of channelNames) {
    const normalized = normalizeChannelName(name);
    if (seen.has(normalized)) duplicates.add(normalized);
    seen.add(normalized);
  }
  return [...duplicates];
}

/**
 * Match raw EEG channel names against a parsed electrode position list.
 *
 * @param {string[]} channelNames  - channel labels from the EEG recording
 * @param {{ label: string, x: number, y: number, z: number }[]} electrodes - from parseElectrodePositionElc
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

// ─── Scalp mesh geometry & voltage interpolation ───────────────────────────
// Builds the triangulated scalp surface and colours it (and per-electrode
// markers) from matched channel voltages.

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
 * Vertices that sit at a matched electrode take that electrode's recorded voltage
 * directly, so the mesh surface matches the electrode marker colour exactly there —
 * gaussianRBF is a weighted average, not a true interpolant, so running a matched
 * vertex through it would blend its own voltage with its neighbours' and mute any
 * spike. All other (unmatched) vertices are still filled in by Gaussian RBF.
 *
 * @param {{ label, x, y, z }[]} electrodes  - full electrode list (determines vertex order)
 * @param {{ pos: { label, x, y, z } }[]} matched - matched channel entries from matchChannelsToPositions
 * @param {number[]} voltages                 - voltage per matched entry (same order as matched)
 * @param {number} sigma                      - Gaussian falloff in mm
 * @returns {Float32Array}
 */
export function interpolateMeshVoltages(electrodes, matched, voltages, sigma = 30) {
  const matchedXYZ = matched.map((m) => [m.pos.x, m.pos.y, m.pos.z]);
  const scalars = new Float32Array(electrodes.length);

  for (let i = 0; i < electrodes.length; i++) {
    const electrode = electrodes[i];
    // check if the current electrode has been matched to a electrode position
    // returns an index when found and -1 when no match is found
    const matchedIndex = matched.findIndex((m) => m.pos.label === electrode.label);

    scalars[i] =
      matchedIndex === -1 // if no match => interpolate, if there is a match => take voltage
        ? gaussianRBF([electrode.x, electrode.y, electrode.z], matchedXYZ, voltages, sigma)
        : voltages[matchedIndex];
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

// ─── Electrode matrix & intracranial connectome ────────────────────────────
// Groups contacts into probe/group shafts for the matrix view (any channel type —
// EEG or SEEG) and the 3D connectome layer (SEEG-specific, see below).

/**
 * Groups channel names by parsed electrode group and number-within-group, sorted ascending
 * within each group — the row/column structure the topography matrix renders. Works for
 * any channel type (EEG or SEEG) whose names fit the group+number shape, e.g. "B1"/"B2"
 * or a high-density EEG net's "E1".."E208". Needs only channel names + a voltage per
 * channel index, no electrode positions, since this view has no position-file gate.
 * Channels that don't fit the group+number shape (e.g. "ECG") aren't dropped — they're
 * returned separately in `ungrouped`, named-column entries rather than a numbered
 * group+number row. (Named `ungrouped`, not `other`, to avoid confusion with the
 * channelSettings 'other' channel *type*, a separate concept.)
 *
 * @param {string[]} channelNames
 * @param {number[]} voltages  - one per channelNames index
 * @returns {{
 *   groups: { group: string, contacts: { numberInGroup: number, channelIdx: number, voltage: number }[] }[],
 *   ungrouped: { channelIdx: number, name: string, voltage: number }[]
 */
export function buildElectrodeMatrix(channelNames, voltages) {
  // Keyed by the lowercased group so casing differences never split one physical probe into
  // two rows; the display label itself (e.g. "E", not "e") comes from the first channel seen
  // for that group, via parseElectrodeContactName's groupLabel.
  const groupMap = new Map(); // lowercased group -> { label, contacts }
  const ungrouped = [];

  channelNames.forEach((name, channelIdx) => {
    const parsed = parseElectrodeContactName(name);
    if (!parsed) {
      ungrouped.push({ channelIdx, name, voltage: voltages[channelIdx] ?? 0 }); // doesn't fit the group+number shape
      return;
    }
    const { group, groupLabel, numberInGroup } = parsed;
    if (!groupMap.has(group)) groupMap.set(group, { label: groupLabel, contacts: [] });
    groupMap.get(group).contacts.push({
      numberInGroup,
      channelIdx,
      voltage: voltages[channelIdx] ?? 0,
    });
  });

  const groups = Array.from(groupMap.entries())
    .sort(([a], [b]) => a.localeCompare(b)) // alphabetical row order, e.g. "b" before "b'"
    .map(([, { label, contacts }]) => ({
      group: label,
      contacts: contacts.slice().sort((a, b) => a.numberInGroup - b.numberInGroup), // ascending column order
    }));

  return { groups, ungrouped };
}

// ─── Matrix rendering helpers ───────────────────────────────────────────────
// Pure layout helpers for EegMatrixViewer — splitting channels by type and wrapping a wide
// electrode group's contacts onto multiple lines are both plain array transforms, easier to
// unit-test here than inside the component.

/**
 * Splits channel names/voltages into per-type buckets so the matrix can render EEG and
 * SEEG contacts as separate sections (a recording can mix both, since channel type is now
 * user-editable per channel in the Montage Editor). Each bucket keeps its entries in
 * original channel order, with voltages aligned 1:1 to names.
 *
 * @param {string[]} channelNames
 * @param {number[]} voltages - one per channelNames index
 * @param {(string|undefined)[]} channelTypes - one channelSettings type ('eeg'|'seeg'|'other'
 *   |undefined) per channelNames index
 * @returns {{
 *   eeg: { names: string[], voltages: number[] },
 *   seeg: { names: string[], voltages: number[] },
 *   other: { names: string[], voltages: number[] }
 * }}
 */
export function splitChannelsByType(channelNames, voltages, channelTypes) {
  const buckets = {
    eeg: { names: [], voltages: [] },
    seeg: { names: [], voltages: [] },
    other: { names: [], voltages: [] },
  };

  channelNames.forEach((name, i) => {
    const type = channelTypes?.[i];
    const bucket = type === 'eeg' || type === 'seeg' ? buckets[type] : buckets.other;
    bucket.names.push(name);
    bucket.voltages.push(voltages[i] ?? 0);
  });

  return buckets;
}

// Contacts per wrapped line in the matrix view — a high-density EEG net (e.g. EGI's E1-E208
// under one group letter) would otherwise render as one absurdly wide row.
export const MATRIX_LINE_WIDTH = 16;

/**
 * Splits one group's sorted contacts into fixed-width "lines" for rendering, using absolute
 * numberInGroup windows (1-16, 17-32, ...) shared across every group in the same section —
 * not just this group's own contacts — so number N stays in the same window (and under the
 * same header) for every probe/group in the section, matching the existing no-gap-collapsing
 * column convention (a group missing a number still gets an empty cell at that position).
 *
 * @param {{numberInGroup:number, channelIdx:number, voltage:number}[]} contacts - this group's contacts
 * @param {number} maxNumberInGroup - the section-wide maximum numberInGroup (shared across groups)
 * @param {number} lineWidth - contacts per line, default MATRIX_LINE_WIDTH
 * @returns {{start:number, end:number, contacts:object[]}[]} - one entry per line, `start`/`end`
 *   are the true (1-based) numberInGroup values that line's columns represent
 */
export function chunkContactsIntoLines(contacts, maxNumberInGroup, lineWidth = MATRIX_LINE_WIDTH) {
  const lines = [];
  for (let start = 1; start <= maxNumberInGroup; start += lineWidth) {
    const end = Math.min(start + lineWidth - 1, maxNumberInGroup);
    lines.push({
      start,
      end,
      contacts: contacts.filter((c) => c.numberInGroup >= start && c.numberInGroup <= end),
    });
  }
  return lines;
}

/**
 * Splits a flat array into fixed-size chunks, in order — used for the matrix view's "Other"
 * section (channels that don't fit a group+contact row), whose entries are named individually
 * rather than positioned by contact number, so there's no gap-window logic to preserve.
 *
 * @param {T[]} items
 * @param {number} lineWidth - items per line, default MATRIX_LINE_WIDTH
 * @returns {T[][]}
 */
export function chunkArrayIntoLines(items, lineWidth = MATRIX_LINE_WIDTH) {
  const lines = [];
  for (let i = 0; i < items.length; i += lineWidth) {
    lines.push(items.slice(i, i + lineWidth));
  }
  return lines;
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

  const groupMap = new Map(); // electrode group -> { numberInGroup, nodeIndex, voltage }[]
  matched.forEach((m, nodeIndex) => {
    const parsed = parseElectrodeContactName(m.name);
    if (!parsed) return; // not on a probe shaft — no edge to draw for this contact
    if (!groupMap.has(parsed.group)) groupMap.set(parsed.group, []);
    groupMap
      .get(parsed.group)
      .push({ numberInGroup: parsed.numberInGroup, nodeIndex, voltage: voltages[nodeIndex] ?? 0 });
  });

  const edges = [];
  for (const contacts of groupMap.values()) {
    const sorted = contacts.slice().sort((a, b) => a.numberInGroup - b.numberInGroup); // shaft order, gaps just absent
    for (let i = 0; i < sorted.length - 1; i++) {
      edges.push({
        first: sorted[i].nodeIndex,
        second: sorted[i + 1].nodeIndex,
        colorValue: 1, // fix colorvalue of edges to have them fixed size and color (still scalable with sliders edgeScale)
      });
    }
  }

  return { nodes, edges };
}

/**
 * Builds connectome nodes (one per matched electrode contact, colored by voltage)
 *
 * @param {{ channelIdx, name, pos: { x, y, z } }[]} matched - from matchChannelsToPositions
 * @param {number[]} voltages  - one per matched entry (same order as matched)
 * @returns {{
 *   nodes: { name, x, y, z, colorValue, sizeValue }[],
 *   edges: { first: number, second: number, colorValue: number }[]
 */
export function buildSurfaceEegConnectome(matched, voltages) {
  // One node per matched contact — node index i corresponds to matched[i]/voltages[i].
  const nodes = matched.map((m, i) => ({
    name: m.name,
    x: m.pos.x,
    y: m.pos.y,
    z: m.pos.z,
    colorValue: voltages[i] ?? 0,
    sizeValue: 1,
  }));

  // Surface EEG doesn't need edges connecting the nodes
  const edges = [];

  return { nodes, edges };
}

/**
 * Pure derivation of the Neuroimaging pane's "connectome volume" layer entry from
 * the EEG state lifted out of EegViewer. Returns null when there's nothing to show
 * yet (not an intracranial recording, or no position-matched channels), so
 * PatientView.jsx can stay a thin orchestrator with no electrode-specific logic
 * of its own.
 *
 * @param {{ matched: object[], voltages: number[] }} args
 * @returns {object | null}
 */
export function buildElectrodeLayer({ matched, voltages }) {
  if (!matched?.length) return null; // nothing to render yet

  // split matched up in seeg and eeg
  // first get the indices for each
  const seegIdx = [];
  const eegIdx = [];
  matched.forEach((m, i) => {
    if (m.type === 'seeg') seegIdx.push(i);
    else if (m.type === 'eeg') eegIdx.push(i);
  });

  // helper function to split matched
  const pick = (idx, matched, voltages) => ({
    matched: idx.map((i) => matched[i]),
    voltages: idx.map((i) => voltages[i]),
  });

  const seeg = pick(seegIdx, matched, voltages);
  const eeg = pick(eegIdx, matched, voltages);

  const { nodes: seegNodes, edges } = buildIntracranialConnectome(seeg.matched, seeg.voltages);
  const { nodes: eegNodes } = buildSurfaceEegConnectome(eeg.matched, eeg.voltages);

  // seeg nodes MUST come first, otherwise the edges wouldn't be assigned to the right nodes
  const nodes = [...seegNodes, ...eegNodes];
  // subtypes determines the layer sub label after the 'Electrodes' type label in the draggable settings panel
  const subtype =
    seegIdx.length && eegIdx.length
      ? 'Intracranial & Surface EEG'
      : seegIdx.length
        ? 'Intracranial EEG'
        : 'Surface EEG';

  const calMax = Math.max(1e-6, ...voltages.map((v) => Math.abs(v))); // symmetric colour range; floor avoids div-by-zero downstream

  return {
    url: ELECTRODE_LAYER_URL,
    name: `${subtype} Electrodes`,
    type: 'Electrodes',
    subtype: subtype,
    kind: 'connectome',
    nodes,
    edges,
    calMax,
  };
}
