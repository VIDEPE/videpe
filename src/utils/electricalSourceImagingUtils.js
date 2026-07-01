// Packs the nested sourceFilters cell array from the inverse filter file into a single
// contiguous Float64Array for fast per-click computation. Row-major layout:
//   flat index = iSource × (3 × nChannels) + orientationRow × nChannels + iChannel
//
// Only inside-brain sources are packed (outside sources have empty filter arrays and are
// skipped). The result is read sequentially in calculateSourcePower, giving ~6× speedup
// over per-source matrix multiplication due to cache-friendly access and zero allocations.
//
// @param {Array} sourceFilters - cell array from parseInverseFiltersFieldtrip: one [3 × nChannels]
//   nested array per source position (empty [] for outside-brain points)
// @param {number[]} indicesInsideSources - indices into sourceFilters of the inside-brain points
// @param {number} nInsideSources - number of inside-brain source points
// @param {number} nChannels - number of EEG channels (columns in each filter matrix)
// @returns {Float64Array} flat filter data, length = nInsideSources × 3 × nChannels
export function flattenInverseFilters(
  sourceFilters,
  indicesInsideSources,
  nInsideSources,
  nChannels
) {
  const flatSourceFilters = new Float64Array(nInsideSources * 3 * nChannels);

  for (let iSource = 0; iSource < nInsideSources; iSource++) {
    const filter = sourceFilters[indicesInsideSources[iSource]];
    for (let row = 0; row < 3; row++) {
      // row 0 = x orientation, row 1 = y orientation, row 2 = z orientation
      for (let iChannel = 0; iChannel < nChannels; iChannel++) {
        flatSourceFilters[iSource * 3 * nChannels + row * nChannels + iChannel] =
          filter[row][iChannel];
      }
    }
  }

  return flatSourceFilters;
}

// Computes the instantaneous dipole power at each inside-brain source point for a single
// clicked EEG timepoint. For each source, multiplies its [3 × nChannels] inverse filter
// (stored row-major in flatSourceFilters) by the channel voltage vector, giving a
// [momentX, momentY, momentZ] dipole moment vector. Power = ||moment||² = mx²+my²+mz².
//
// @param {Float64Array} flatSourceFilters - pre-packed filter data from flattenInverseFilters
// @param {number[]|Float64Array} channelVoltages - voltage at each channel at the clicked timepoint,
//   in the same channel order as inverseFilters.channelLabels (flat 1D array, not column vector)
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
//
// @param {object} inverseFilters - parsed inverse filter model from parseInverseFiltersFieldtrip:
//   { format: 'FieldTrip', sourcePositions, sourceFilters, insideMask, channelLabels }
// @param {number[]|Float64Array} channelVoltages - voltage at each channel at the clicked timepoint,
//   flat 1D array ordered to match inverseFilters.channelLabels
// @returns NiiVue connectome layer object for rendering source power in NiiViewer
export function electricalSourceImaging(inverseFilters, channelVoltages) {
  if (inverseFilters.format === 'FieldTrip') {
    if (!inverseFilters?.sourceFilters?.length) return [];

    // Find all grid indices where insideMask === 1 (source is inside the brain/headmodel)
    const indicesInsideSources = inverseFilters.insideMask.reduce(
      (acc, val, idx) => (val ? [...acc, idx] : acc),
      []
    );
    const nInsideSources = indicesInsideSources.length;
    const nChannels = inverseFilters.channelLabels.length;

    // Pack the nested filter cell array into a flat Float64Array for fast per-click computation
    const flatSourceFilters = flattenInverseFilters(
      inverseFilters.sourceFilters,
      indicesInsideSources,
      nInsideSources,
      nChannels
    );

    const sourcePowers = calculateSourcePower(
      flatSourceFilters,
      channelVoltages,
      nInsideSources,
      nChannels
    );

    // Extract mm positions of inside-brain sources for NiiVue node placement
    const insideSourcePositions = indicesInsideSources.map(
      (i) => inverseFilters.sourcePositions[i]
    );

    return convertSourcePowersToVolume(insideSourcePositions, sourcePowers);
  } else {
    throw new Error(`inverseFilter object has missing/empty 'format' parameter.`);
  }
}
