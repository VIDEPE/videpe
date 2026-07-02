import { ESI_CONNECTOME_URL } from '@/components/NiiViewer.utils';

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

    return convertSourcePowersToConnectome(insideSourcePositions, sourcePowers);
  } else {
    throw new Error(`inverseFilter object has missing/empty 'format' parameter.`);
  }
}
