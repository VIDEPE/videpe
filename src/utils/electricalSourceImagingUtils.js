import { NVImage } from '@niivue/niivue';
import { ESI_LAYER_URL } from '@/utils/NiiViewer.utils';
import {
  median,
  euclideanDistance,
  vectorSubtract,
  vectorAdd,
  dotProduct,
  crossProduct,
  vectorLength,
  matrixLinSolve,
  matrixTrans,
  matrixInverse,
  matrixMul,
} from '@/utils/arrayAndMatrixMathUtils';

// Placeholder threshold for the ESI volume's cal_min (see convertSourcePowersToVolume) until
// it becomes a user-adjustable slider.
const VOLUME_CAL_MIN_FRACTION = 0.01;

// ─── Grid structure ───────────────────────────────────────────────────────────
//
// Computed once, at parse time (see parseInverseSolutionFieldtrip.js) — none of these
// depend on sourcePowers, only on the static source positions, so they never need to
// re-run per EEG click.

export function estimateGridSpacing(positions, sampleSize = 200) {
  // estimate the grid spacing by calculating the median nearest-neighbor distance between source points,
  // using a sample of points if there are many
  const nSources = positions.length;
  const step = Math.max(1, Math.floor(positions.length / sampleSize)); // don't check every single point, just a spread sample
  let nearestDistances = [];
  for (let i = 0; i < nSources; i += step) {
    let nearest = Infinity;
    for (let j = 0; j < nSources; j++) {
      if (j === i) continue;
      const d = euclideanDistance(positions[i], positions[j]);
      nearest = Math.min(nearest, d);
    }
    nearestDistances.push(nearest);
  }

  return median(nearestDistances);
}

export function isParallel(a, b) {
  // The cross product of two vectors is vector with length ~0, when two vectors point in the same (paralell) or opposite (antiparellel) direction
  // isParallel returns True in this case. => used to skip a redundant neighbor-offset candidate that doesn't add an indepdant axis
  // The tolerance is relative (scaled by the vectors' own lengths), not a fixed 1e-6.
  return vectorLength(crossProduct(a, b)) < 1e-6 * vectorLength(a) * vectorLength(b);
}

export function isCoplanar(a, b, c) {
  // The triple scalar product is similar to isParallel, but then for three vectors a,b,c
  // It is ~0 when all three vectors lie in the same plane
  // isCoplanar() returns True in this case => used to reject a third neighbour-offset candidate that doesn't add the missing third dimension.
  // The tolerance is relative (scaled by the vectors' own lengths), not a fixed 1e-6.
  const tripleProduct = dotProduct(a, crossProduct(b, c));
  return Math.abs(tripleProduct) < 1e-6 * vectorLength(a) * vectorLength(b) * vectorLength(c);
}

export function pickIndependentBasis(offsets) {
  // Tries triples of candidate offset vectors until it finds one that form a genuine 3D space
  const nVectors = offsets.length;
  for (let a = 0; a < nVectors; a++) {
    for (let b = a + 1; b < nVectors; b++) {
      // first test if a double is parallel
      if (isParallel(offsets[a], offsets[b])) continue;
      for (let c = b + 1; c < nVectors; c++) {
        // if not, then take a third and check if they lie on the same plane
        if (isCoplanar(offsets[a], offsets[b], offsets[c])) continue;
        // if not, you have an independant basis (note these are not necessarily orthogonal!)
        return [offsets[a], offsets[b], offsets[c]];
      }
    }
  }
  return null;
}

export function findSourceGridBasis(sourcePositions) {
  if (sourcePositions.length < 4) return null; // too few sources
  const gridSpacing = estimateGridSpacing(sourcePositions); // estimate grid spacing
  const tolerance = gridSpacing * 0.1;

  for (const anchor of sourcePositions) {
    const offsets = [];
    for (const point of sourcePositions) {
      if (point === anchor) continue; // skip if point is the same as the anchor
      const offset = vectorSubtract(point, anchor);
      // Check if the offset length is approximately equal to the estimated spacing (within tolerance)
      if (Math.abs(vectorLength(offset) - gridSpacing) <= tolerance) {
        // if so, this means the point is a neighbor of the anchor in the grid, and we can use it to find a basis
        offsets.push(offset);
      }
    }
    // Now we have a list of offsets from the anchor to its neighbors.
    // We can try to pick an independent basis from these offsets.
    const basis = pickIndependentBasis(offsets);
    if (basis) return { anchor, basis, gridSpacing };
  }
  return null;
}

export function mapPositionsToGridIndices(sourcePositions, anchor, basis) {
  // basis = [b1, b2, b3], each a 3D vector (e.g. b1 = [x1,y1,z1]) — what one step along
  // grid-axis 1 (or 2, or 3) looks like in real-world mm space.
  // (i,j,k) = the grid indices (integers) we want to find for each position: how many
  // steps along each basis direction it takes to reach that position from the anchor.
  // offset = the real, known mm displacement from the anchor to a given position.
  //
  // Every position on the lattice satisfies: offset = i*b1 + j*b2 + k*b3
  // e.g. if b1=[2,0,0], b2=[0,2,0], b3=[0,0,2] (a simple axis-aligned 2mm grid) and a
  // point's offset from the anchor is [4,2,6], then i=2, j=1, k=3 — 2 steps along b1,
  // 1 along b2, 3 along b3 — since 2·[2,0,0] + 1·[0,2,0] + 3·[0,0,2] = [4,2,6].
  //
  // We know offset and [b1,b2,b3], and want to solve for the unknown (i,j,k).
  // => conds * [i,j,k] = offset
  //    Note that conds needs b1,b2,b3 as its COLUMNS, not its rows (see MatrixLinSolve tests for an example)
  //    transpose [b1,b2,b3 to get conds => conds = matrixTrans([b1,b2,b3])
  //
  // That equation only goes forward, index → mm (vox2mm).
  // To go the other way, mm → index (mm2vox), it has to be inverted:
  // [i,j,k] = matrixInverse(conds) * offset.
  // matrixLinSolve(conds, offset) does exactly this in one call, but it re-inverts conds
  // internally every time it's called. Conds however never changes across the whole loop of
  // source positions below, so instead conds is inverted once up front (basisInverted),
  // and each position below reuses it via a plain matrixMul, avoiding thousands a redundant matrix
  // inversion per source.

  const basisTransposed = matrixTrans(basis); // conds — basis vectors as columns, not rows
  const basisInverted = matrixInverse(basisTransposed);

  let sourceVolumeIndices = [];
  let iMin = Infinity;
  let jMin = Infinity;
  let kMin = Infinity;
  let iMax = -Infinity;
  let jMax = -Infinity;
  let kMax = -Infinity;
  for (let iSource = 0; iSource < sourcePositions.length; iSource++) {
    const source = sourcePositions[iSource];
    // substract anchor from the point to get the offset
    const offset = vectorSubtract(source, anchor);
    // get volume indices (i,j,k) for each source pos (in mm)
    let [i, j, k] = matrixMul(
      basisInverted,
      offset.map((i) => [i])
    ).map((i) => i[0]);

    // Round the indices as the floating point math might return 1.999999 instead of 2
    i = Math.round(i);
    j = Math.round(j);
    k = Math.round(k);
    sourceVolumeIndices.push([i, j, k]); // store i,j,k for each source

    // find [iMin, jMin and kMin]
    if (i < iMin) iMin = i;
    if (j < jMin) jMin = j;
    if (k < kMin) kMin = k;

    // find [iMax, jMax and kMax]
    if (i > iMax) iMax = i;
    if (j > jMax) jMax = j;
    if (k > kMax) kMax = k;
  }

  // These volume indices however are in respect to the anchor, which could be any source point within the grid
  // Instead we want to substract [iMin, jMin and kMin] from these to get indices starting from 0
  for (let iSource = 0; iSource < sourceVolumeIndices.length; iSource++) {
    sourceVolumeIndices[iSource] = vectorSubtract(sourceVolumeIndices[iSource], [iMin, jMin, kMin]);
  }

  const gridDimensions = [iMax - iMin + 1, jMax - jMin + 1, kMax - kMin + 1]; // correct Max to same zero start and + 1 to offset indices starting from 0

  // minCorner = how many basis-steps the zero-shift above moved everything by — needed by
  // buildAffineMatrix to recover the real-world mm position of voxel [0,0,0], since that's
  // no longer the anchor itself once indices get shifted to be zero-based.
  const minCorner = [iMin, jMin, kMin];

  return { sourceVolumeIndices, gridDimensions, minCorner };
}

export function buildAffineMatrix(anchor, basis, minCorner) {
  // The affine (NIfTI vox2mm convention) maps voxel index (i,j,k) → real-world mm position [x,y,z]:
  // [x,y,z] = i*b1 + j*b2 + k*b3 + origin, => can be writtenas Affine 4×4 matrix [b1 b2 b3 | origin; 0 0 0 1].
  //   | b1x, b2x, b3x, originx |
  //   | b1y, b2y, b3y, originy |
  //   | b1z, b2z, b3z, originz |
  //   |   0,   0,   0,   1     |
  //
  // origin = the real-world mm position of voxel [0,0,0] in the 'zero-shifted' grid.
  // Note this is not anchor itself — mapPositionsToGridIndices's zero-shift moved voxel [0,0,0] away from the
  // anchor by minCorner=[iMin,jMin,kMin] basis-steps, so origin = anchor + (that many steps
  // back toward the anchor). Same forward index→mm math as mapPositionsToGridIndices's own
  // vox2mm equation (conds*[i,j,k]=offset), just evaluated at [i,j,k]=minCorner instead of
  // solved for.
  const [b1, b2, b3] = basis;
  const conds = matrixTrans(basis); // basis vectors as columns, not rows (see mapPositionsToGridIndices)
  const originOffset = matrixMul(
    conds,
    minCorner.map((m) => [m])
  ).map((row) => row[0]); // conds · [i,j,k] = origin shift in mm
  const origin = vectorAdd(anchor, originOffset); // anchor + originShift => realworld location in mm of voxel [0,0,0]

  return [
    [b1[0], b2[0], b3[0], origin[0]],
    [b1[1], b2[1], b3[1], origin[1]],
    [b1[2], b2[2], b3[2], origin[2]],
    [0, 0, 0, 1],
  ];
}

// ─── Per-click source power computation ───────────────────────────────────────
//
// Runs on every EEG plot click, using the grid structure precomputed above (already
// sitting on inverseSolution by the time these are called).

// Computes the instantaneous dipole power at each inside-brain source point for a single
// clicked EEG timepoint. For each source, multiplies its [3 × nChannels] inverse filter
// (stored row-major in flatSourceFilters) by the channel voltage vector, giving a
// [momentX, momentY, momentZ] dipole moment vector. Power = ||moment||² = mx²+my²+mz².
//
// @param {Float64Array} flatSourceFilters - pre-packed filter data from parseInverseSolutionFieldtrip
// @param {number[]|Float64Array} channelVoltages - voltage at each channel at the clicked timepoint,
//   flat 1D array ordered to match inverseSolution.channelLabels (not a column vector)
// @param {number} nInsideSources - number of inside-brain source points
// @param {number} nChannels - number of EEG channels
// @returns {Float64Array} source power per inside-brain point, length = nInsideSources
export function calculateSourcePower({
  flatSourceFilters,
  channelVoltages,
  nInsideSources,
  nChannels,
}) {
  const sourcePowers = new Float64Array(nInsideSources);

  for (let iSource = 0; iSource < nInsideSources; iSource++) {
    const baseSourceIndex = iSource * 3 * nChannels;
    let momentX = 0,
      momentY = 0,
      momentZ = 0;
    for (let iChannel = 0; iChannel < nChannels; iChannel++) {
      const voltage = channelVoltages[iChannel];
      momentX += flatSourceFilters[baseSourceIndex + iChannel] * voltage;
      momentY += flatSourceFilters[baseSourceIndex + nChannels + iChannel] * voltage;
      momentZ += flatSourceFilters[baseSourceIndex + 2 * nChannels + iChannel] * voltage;
    }
    // Squared L2 norm of the dipole moment vector = instantaneous source power
    sourcePowers[iSource] = momentX * momentX + momentY * momentY + momentZ * momentZ;
  }

  return sourcePowers;
}

export function ijkIndexToFlatIndex(i, j, k, gridDimensions) {
  // Convert a (i,j,k) grid index into a flat array index, one scalar per voxel, in
  // i-fastest / k-slowest order (matches NIfTI's on-disk voxel layout):
  // flat index 0,1,2,...,dimI-1 steps through i alone (j=0,k=0); once i wraps, j increments;
  // once j wraps too, k increments. E.g. for gridDimensions=[2,2,2], the order is:
  // (0,0,0),(1,0,0),(0,1,0),(1,1,0),(0,0,1),(1,0,1),(0,1,1),(1,1,1) → flat indices 0..7
  const [dimI, dimJ, dimK] = gridDimensions;
  const flatIndex = i + j * dimI + k * dimI * dimJ;
  return flatIndex;
}

export function buildSourceVolumeGrid(sourceVolumeIndices, sourcePowers, gridDimensions) {
  // Create ESI volume grid as flat array and occupy it with (inside) source power values
  let sourceVolumeGrid = new Float32Array(
    gridDimensions[0] * gridDimensions[1] * gridDimensions[2]
  );

  // first check if we have equal number of insidesourcepositions as sourcepowers
  if (sourceVolumeIndices.length !== sourcePowers.length) {
    throw new Error(
      `unequal number of inside source volume indices (n=${sourceVolumeIndices.length}) compared to source powers (n=${sourcePowers.length})`
    );
  }
  // Loop over source powers and sum up in "grid"
  for (let iSource = 0; iSource < sourceVolumeIndices.length; iSource++) {
    const [i, j, k] = sourceVolumeIndices[iSource];
    const flatArrayInd = ijkIndexToFlatIndex(i, j, k, gridDimensions);
    // sum sourcePowers to the correct flat array pos
    sourceVolumeGrid[flatArrayInd] = sourceVolumeGrid[flatArrayInd] + sourcePowers[iSource];
  }

  return sourceVolumeGrid;
}

export function convertSourcePowersToConnectome(insideSourcePositions, sourcePowers) {
  let calMax = 1e-9;
  for (let i = 0; i < sourcePowers.length; i++) {
    if (sourcePowers[i] > calMax) calMax = sourcePowers[i];
  }
  // Source power is always non-negative (squared magnitude) — 0 is a meaningful, fixed
  // floor for the color scale, not just the sample minimum.
  const calMin = 0;

  const nodes = insideSourcePositions.map((pos, i) => ({
    name: `esi-src-${i}`,
    x: pos[0], // pos is [x, y, z], not an object with .x
    y: pos[1],
    z: pos[2],
    colorValue: sourcePowers[i],
    sizeValue: sourcePowers[i] / calMax, // 0 → invisible, 1 → full nodeScale size
  }));

  return {
    url: ESI_LAYER_URL,
    name: 'ESI Source Power',
    type: 'Electrical Source Imaging',
    kind: 'connectome',
    nodes,
    edges: [],
    calMin,
    calMax,
  };
}

// Build NIfTI volume power heatmap output
// takes gridDimensions, pixDims, affine, and sourceVolumeIndices pre-computed during parse time
// it just (re)computes the sourceVolumeGrid with the latest sourcePowers and creates an NVImage
export function convertSourcePowersToVolume(
  sourceVolumeIndices,
  sourcePowers,
  gridDimensions,
  pixDims,
  affine
) {
  // First build the source volume grid with the (updated) sourcePower values
  const sourceVolumeGrid = buildSourceVolumeGrid(sourceVolumeIndices, sourcePowers, gridDimensions);

  // Convert this into a Nifty volume
  const affineFlat = affine.flat(); // Flatten affine [4x4] into [16x1] => nifty array required affine.length == 16
  const datatypeCode = 16; // 16 stand for float32 (=> matches souceVolumeGrid's Float32Array)

  const niftyArray = NVImage.createNiftiArray(
    gridDimensions,
    pixDims,
    affineFlat,
    datatypeCode,
    sourceVolumeGrid
  ); // returns Uint8Array directly, no Promise;

  let calMax = 1e-9;
  for (let i = 0; i < sourcePowers.length; i++) {
    if (sourcePowers[i] > calMax) calMax = sourcePowers[i];
  }
  // Unlike the connectome (where calMin=0 is fine — it only feeds a color-mapping range),
  // the volume's cal_min doubles as NiiVue's transparent-below-threshold cutoff: its
  // ZERO_TO_MAX_TRANSPARENT_BELOW_MIN shader only ramps voxels toward transparent when
  // cal_min > 0 (alpha *= (f/cal_min)²) — a literal 0 disables that entirely, leaving the
  // whole volume opaque. A fixed fraction of calMax is a placeholder threshold until this
  // becomes a user-adjustable slider.
  const calMin = VOLUME_CAL_MIN_FRACTION * calMax;

  return {
    url: ESI_LAYER_URL,
    bytes: niftyArray,
    name: 'ESI Source Power.nii', // '.nii' extension required! => NiiVue infers file type from this extension — a bare name crashes addVolumesFromUrl
    type: 'Electrical Source Imaging',
    kind: 'volume',
    edges: [],
    calMin,
    calMax,
  };
}

// Main entry point for Electrical Source Imaging. Called on each EEG plot click with
// the loaded inverse filter model and a snapshot of the current channel state.
// The model's flatSourceFilters is pre-computed at file-load time by parseInverseSolutionFieldtrip,
// so this function only performs the fast per-click matrix multiply.
//
// @param {object} inverseSolution - parsed inverse filter model from parseInverseSolutionFieldtrip:
//   { format, flatSourceFilters, insideSourcePositions, nInsideSources, nChannels, channelLabels, ... }
// @param {object} channelSnapshot - per-click EEG state lifted from EegViewer:
//   { isIntracranial: boolean, channelNames: string[], voltages: number[] }
// @returns NiiVue connectome layer object for rendering source power in NiiViewer
export function electricalSourceImaging(inverseSolution, channelSnapshot) {
  if (!inverseSolution) return null;
  if (!channelSnapshot?.voltages?.length) return null;
  // ESI inverse filters are computed from scalp EEG models — applying them to intracranial
  // recordings would produce nonsensical results, so we guard here rather than in the caller.
  if (channelSnapshot.isIntracranial) return null;
  if (inverseSolution.format === 'FieldTrip') {
    if (!inverseSolution?.flatSourceFilters?.length) return [];

    const {
      flatSourceFilters,
      insideSourcePositions,
      nInsideSources,
      nChannels,
      sourceVolumeIndices,
      gridDimensions,
      pixDims,
      affine,
    } = inverseSolution;

    const sourcePowers = calculateSourcePower({
      flatSourceFilters,
      channelVoltages: channelSnapshot.voltages,
      nInsideSources,
      nChannels,
    });

    // Build power connectomes from the inside source positions
    const sourcePowerConnectomes = convertSourcePowersToConnectome(
      insideSourcePositions,
      sourcePowers
    );
    // Build power volume from inside volume indices
    const sourcePowerVolume = convertSourcePowersToVolume(
      sourceVolumeIndices,
      sourcePowers,
      gridDimensions,
      pixDims,
      affine
    );

    return { sourcePowerConnectomes, sourcePowerVolume };
  } else {
    throw new Error(`inverseFilter object has unkown/empty 'format' parameter.`);
  }
}
