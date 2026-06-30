import { read as readmat } from 'mat-for-js';
import { readFileSync } from 'node:fs';

// // Test script to
// const TESTFILEPATH = new URL(
//   '../../public/temp/sub-19_meth-eloreta_desc-nonorm_inversefilters.mat',
//   import.meta.url
// ); //import.meta.url is needed to accept a relative path

// const buffer = readFileSync(TESTFILEPATH);
// // buffer.buffer can be a shared, larger Node Buffer pool (for small files); slice out just this file's bytes
// const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

// const result = readmat(arrayBuffer);

// const inside = result.data.inverse_filters.inside;
// const pos = result.data.inverse_filters.pos;
// const filter = result.data.inverse_filters.filter;
// const elec = result.data.inverse_filters.elec;

// parser to extract the following fields from the *_inversefilters.mat*
//  - pos: (nDipoles,1) with [x,y,z] triplets indicating the 3D position of each dipole
//  - filter: (nDipoles,1), each either [] (outside point, e.g. index 0) or 3 sub-arrays of nChannels numbers each — the [3 x nChannels] x/y/z-orientation matrix ✓
//  - inside: (nDipoles,1) flat array of 0 (dipole pos is outside the brain) or 1 (dipole pos it inside the brain)
//  - elec.label: nchannels bare-numeric strings, ending in 'VREF'
export const parseInverseFiltersFieldtrip = async (file) => {
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

  return { format: 'FieldTrip', sourcePositions, sourceFilters, insideMask, channelLabels };
};
