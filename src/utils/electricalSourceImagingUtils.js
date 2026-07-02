// Computes the instantaneous dipole power at each inside-brain source point for a single
// clicked EEG timepoint. For each source, multiplies its [3 × nChannels] inverse filter
// (stored row-major in flatSourceFilters) by the channel voltage vector, giving a
// [momentX, momentY, momentZ] dipole moment vector. Power = ||moment||² = mx²+my²+mz².
//
// @param {Float64Array} flatSourceFilters - pre-packed filter data from parseInverseFiltersFieldtrip
// @param {number[]|Float64Array} channelVoltages - voltage at each channel at the clicked timepoint,
//   flat 1D array ordered to match inverseFilters.channelLabels (not a column vector)
// @param {number} nInsideSources - number of inside-brain source points
// @param {number} nChannels - number of EEG channels
// @returns {Float64Array} source power per inside-brain point, length = nInsideSources
export function calculateSourcePower(
  flatSourceFilters,
  channelVoltages,
  nInsideSources,
  nChannels
) {
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

// Converts per-source power values and their 3D positions into a NiiVue connectome
// volume layer for rendering in NiiViewer. Each inside-brain source becomes a node
// whose color encodes its power relative to the maximum across all sources.
//
// @param {number[][]} insideSourcePositions - [x, y, z] mm coordinates of each inside-brain source,
//   in the same coordinate space as any loaded anatomical volume in NiiViewer
// @param {Float64Array} sourcePowers - instantaneous dipole power per source from calculateSourcePower
// @returns {object|null} NiiVue connectome layer object, or null (stub — not yet implemented)
export function convertSourcePowersToVolume(insideSourcePositions, sourcePowers) {
  let sourcePowerVolume = null;
  return sourcePowerVolume;
}

// Main entry point for Electrical Source Imaging. Called on each EEG plot click with
// the loaded inverse filter model and the channel voltages at the clicked timepoint.
// The model's flatSourceFilters is pre-computed at file-load time by parseInverseFiltersFieldtrip,
// so this function only performs the fast per-click matrix multiply.
//
// @param {object} inverseFilters - parsed inverse filter model from parseInverseFiltersFieldtrip:
//   { format, flatSourceFilters, insideSourcePositions, nInsideSources, nChannels, channelLabels, ... }
// @param {number[]|Float64Array} channelVoltages - voltage at each channel at the clicked timepoint,
//   flat 1D array ordered to match inverseFilters.channelLabels
// @returns NiiVue connectome layer object for rendering source power in NiiViewer
export function electricalSourceImaging(inverseFilters, channelVoltages) {
  if (inverseFilters.format === 'FieldTrip') {
    if (!inverseFilters?.flatSourceFilters?.length) return [];

    const { flatSourceFilters, insideSourcePositions, nInsideSources, nChannels } = inverseFilters;

    const sourcePowers = calculateSourcePower(
      flatSourceFilters,
      channelVoltages,
      nInsideSources,
      nChannels
    );

    return convertSourcePowersToVolume(insideSourcePositions, sourcePowers);
  } else {
    throw new Error(`inverseFilter object has missing/empty 'format' parameter.`);
  }
}
