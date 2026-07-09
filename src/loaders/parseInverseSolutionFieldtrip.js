import { read as readmat } from 'mat-for-js';
import {
  findSourceGridBasis,
  mapPositionsToGridIndices,
  buildAffineMatrix,
} from '@/utils/electricalSourceImagingUtils';
import { vectorLength } from '@/utils/arrayAndMatrixMathUtils';

// parser to extract the following fields from the *_inversefilters.mat*
//  - pos: (nDipoles,1) with [x,y,z] triplets indicating the 3D position of each dipole
//  - filter: (nDipoles,1), each either [] (outside point, e.g. index 0) or 3 sub-arrays of nChannels numbers each — the [3 x nChannels] x/y/z-orientation matrix ✓
//  - inside: (nDipoles,1) flat array of 0 (dipole pos is outside the brain) or 1 (dipole pos it inside the brain)
//  - elec.label: nchannels bare-numeric strings, ending in 'VREF'
export const parseInverseSolutionFieldtrip = async (file) => {
  // The arrayBuffer() method returns a Promise that resolves with the contents of the blob as binary data contained in an ArrayBuffer.
  const arrayBuffer = await file.arrayBuffer();
  // Which can be read by mat4js.read function
  const result = readmat(arrayBuffer);
  if (!result.data.inverse_filters) {
    throw new Error(
      `${file.name} does not contain an inverse_filters struct — expected a FieldTrip *_inversefilters.mat export for Electrical Source Imaging (ESI).`
    );
  }

  // Extract the fields needed for Electrical Source Imaging (ESI), renamed from FieldTrip's
  // own struct field names to a tool-agnostic shape — a future Cartool parser converges on
  // the same field names here even though Cartool's own internal naming will differ.

  // pos: array of dipole positions
  const sourcePositions = result.data.inverse_filters.pos;
  if (!sourcePositions?.length) {
    throw new Error(`${file.name} has a missing/empty 'pos' array.`);
  }
  // filter: array of inverse filter matrices
  const sourceFilters = result.data.inverse_filters.filter;
  if (!sourceFilters?.length) {
    throw new Error(`${file.name} has a missing/empty 'filter' array.`);
  }
  // inside: array with 0/1 indicating dipole position outside or inside the brain
  const insideMask = result.data.inverse_filters.inside;
  if (!insideMask?.length) {
    throw new Error(`${file.name} has a missing/empty 'inside' array.`);
  }
  // elec: an array of channel name strings
  const channelLabels = result.data.inverse_filters.elec?.label;
  if (!channelLabels?.length) {
    throw new Error(`${file.name} has a missing/empty 'elec.label' array.`);
  }

  // Pre-compute the fields at parse time so the per-click ESI computation only
  // needs to call calculateSourcePower — no flattening work on every EEG click.
  const nChannels = channelLabels.length;

  // Find all grid indices where the source is inside the brain/headmodel
  const indicesInsideSources = insideMask.reduce(
    (acc, val, idx) => (val ? [...acc, idx] : acc),
    []
  );
  const nInsideSources = indicesInsideSources.length;

  // mm positions of inside-brain sources only (for NiiVue node placement)
  const insideSourcePositions = indicesInsideSources.map((i) => sourcePositions[i]);

  // Pack all inside-source filter matrices into a contiguous Float64Array (row-major).
  //
  // Before — nested cell array (sourceFilters), 4 total points, 2 inside, 4 channels:
  //   sourceFilters = [
  //     [],                                   // index 0 — outside brain
  //     [[ 0.5, -1.2,  0.8,  0.3],            // index 1 — inside (source 0), x-row (row 0)
  //      [ 1.1,  0.4, -0.6,  0.9],            //                              y-row (row 1)
  //      [-0.2,  0.7,  1.3, -0.5]],           //                              z-row (row 2)
  //     [],                                   // index 2 — outside brain
  //     [[ 0.1,  0.6, -0.9,  0.2],            // index 3 — inside (source 1), x-row (row 0)
  //      [-0.4,  0.8,  0.5, -0.7],            //                              y-row (row 1)
  //      [ 0.9, -0.3,  0.1,  0.4]],           //                              z-row (row 2)
  //   ]
  //
  // After — flat Float64Array (only inside sources, outside points skipped):
  // flat index:  0      1     2     3     4     5     6     7     8     9    10    11    12 ...
  //             ├───────────────────────────── source 0 ───────────────────────────────┤├─ source 1 ──
  //             ├──────── x row ──────┤├──────── y row ───────┤├────── z row ──────────┤├─ x row ──
  // value:       0.5  -1.2   0.8   0.3   1.1   0.4  -0.6   0.9  -0.2   0.7   1.3  -0.5   0.1 ...
  // channel:      1     2     3     4     1     2     3     4     1     2     3     4     1   ...
  //
  // flat index = iSource × (3 × nChannels) + orientationRow × nChannels + iChannel
  // ~6× faster than per-source matrixMul at click time due to cache-friendly sequential reads.
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

  //--- Prepare Volume Grid tructure for source power volume generation (only needs to be calculated once)

  // Get anchor, basis needed to get grid indices
  const { anchor, basis, gridSpacing } = findSourceGridBasis(insideSourcePositions);
  // Get grid indices (i,j,k) for each source position [x,y,z]
  const { sourceVolumeIndices, gridDimensions, minCorner } = mapPositionsToGridIndices(
    insideSourcePositions,
    anchor,
    basis
  );
  const pixDims = basis.map(vectorLength);
  const affine = buildAffineMatrix(anchor, basis, minCorner);

  // sourceFilters (the raw nested cell array) is intentionally excluded from the return —
  // flatSourceFilters replaces it for computation, avoiding a duplicate ~20MB allocation.
  return {
    format: 'FieldTrip',
    sourcePositions,
    insideMask,
    channelLabels,
    indicesInsideSources,
    insideSourcePositions,
    flatSourceFilters,
    nInsideSources,
    nChannels,
    sourceVolumeIndices,
    gridDimensions,
    gridSpacing,
    pixDims,
    affine,
  };
};
