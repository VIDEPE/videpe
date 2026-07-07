import { ESI_CONNECTOME_URL } from '@/components/NiiViewer.utils';
import {
  median,
  euclideanDistance,
  vectorSubtract,
  dotProduct,
  crossProduct,
  vectorLength,
  matrixLinSolve,
} from './arrayAndMatrixMathUtils';

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

export function convertSourcePowersToConnectome(insideSourcePositions, sourcePowers) {
  let calMax = 1e-9;
  for (let i = 0; i < sourcePowers.length; i++) {
    if (sourcePowers[i] > calMax) calMax = sourcePowers[i];
  }

  const nodes = insideSourcePositions.map((pos, i) => ({
    name: `esi-src-${i}`,
    x: pos[0], // pos is [x, y, z], not an object with .x
    y: pos[1],
    z: pos[2],
    colorValue: sourcePowers[i],
    sizeValue: sourcePowers[i] / calMax, // 0 → invisible, 1 → full nodeScale size
  }));

  return {
    url: ESI_CONNECTOME_URL,
    name: 'ESI Source Power',
    type: 'Electrical Source Imaging',
    kind: 'connectome',
    nodes,
    edges: [],
    calMax,
  };
}

// Stub — NIfTI volume heatmap output, to be implemented after the connectome approach.
// Will need grid dimensions/voxelSize/gridOrigin/insideVoxelIndices pre-computed at
// parse time and passed in, rather than deriving them here from insideSourcePositions alone.
export function convertSourcePowersToVolume(insideSourcePositions, sourcePowers) {
  return null;
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

    const { flatSourceFilters, insideSourcePositions, nInsideSources, nChannels } = inverseSolution;

    const sourcePowers = calculateSourcePower({
      flatSourceFilters,
      channelVoltages: channelSnapshot.voltages,
      nInsideSources,
      nChannels,
    });

    const sourcePowerConnectomes = convertSourcePowersToConnectome(
      insideSourcePositions,
      sourcePowers
    );
    const sourcePowerVolumes = convertSourcePowersToVolume(insideSourcePositions, sourcePowers);

    return { sourcePowerConnectomes, sourcePowerVolumes };
  } else {
    throw new Error(`inverseFilter object has unkown/empty 'format' parameter.`);
  }
}

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

export function isParallel(a,b) {
  // The cross product of two vectors is ~0, when two vectors point in the same (paralell) or opposite (antiparellel) direction
  // isParallel returns True in this case. => used to skip a redundant neighbor-offset candidate that doesn't add an indepdant axis
  // The tolerance is relative (scaled by the vectors' own lengths), not a fixed 1e-6.
  return vectorLength(crossProduct(a, b)) < 1e-6 * vectorLength(a) * vectorLength(b)
}

export function isCoplanar(a,b,c) {
  // The triple product is similar to isParallel, but then for three vectors a,b,c
  // It is ~0 when all three vectors lie in the same plane
  // isCoplanar() returns True in this case => used to reject a third neighbour-offset candidate that doesn't add the missing third dimension.
  // The tolerance is relative (scaled by the vectors' own lengths), not a fixed 1e-6.
  const tripleProduct = dotProduct(a, crossProduct(b, c))
  return Math.abs(tripleProduct) < 1e-6 * vectorLength(a) * vectorLength(b) * vectorLength(c)
}

export function pickIndependentBasis(offsets) {
  // Tries triples of candidate offset vectors until it finds one that form a genuine 3D space
  const nVectors = offsets.length
  for (let a=0; a<nVectors; a++){
    for (let b=a+1; b<nVectors; b++){
      // first test if a double is parallel
      if (isParallel(offsets[a], offsets[b])) continue
      for (let c=b+1; c<nVectors; c++) {
        // if not, then take a third and check if they lie on the same plane
        if (isCoplanar(offsets[a], offsets[b], offsets[c])) continue
        // if not, you have an independant basis (note these are not necessarily orthogonal!)
        return [offsets[a], offsets[b], offsets[c]]
      }
    }
  }
  return null
}

export function findSourceGridBasis(sourcePositions) {
  if (sourcePositions.length < 4) return null // too few sources
  const spacing = estimateGridSpacing(sourcePositions)   // estimate grid spacing
  const tolerance = spacing * 0.1

  for (const anchor of sourcePositions){
    const offsets = []
    for (const point of sourcePositions){
      if (point === anchor) continue   // skip if point is the same as the anchor
        const offset = vectorSubtract(point, anchor)
        // Check if the offset length is approximately equal to the estimated spacing (within tolerance)    
        if (Math.abs(vectorLength(offset) - spacing) <= tolerance ) {
          // if so, this means the point is a neighbor of the anchor in the grid, and we can use it to find a basis
          offsets.push(offset)
        }
    }
    // Now we have a list of offsets from the anchor to its neighbors.
    // We can try to pick an independent basis from these offsets.
    const basis = pickIndependentBasis(offsets)
    if (basis) return { anchor, basis, spacing }
  }
  return null
}

