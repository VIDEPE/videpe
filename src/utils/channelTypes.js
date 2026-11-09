// The types the data channels in the EEG Viewer can have.
// The type depends which options are available for those recording rows,
// e.g. (global) filtering options, if an EEG topography/3D connectome can be build from it, etc.
export const TYPE_LIST = {
  eeg: 'EEG',
  seeg: 'SEEG',
  other: 'Other',
};
// Canonical grouping order for Sort by Type — clinical convention (eeg, then seeg, then
// other), not alphabetical (which would separate seeg from eeg).
export const TYPE_ORDER = Object.keys(TYPE_LIST);

// all filters off for every known channel type
export const DEFAULT_GLOBAL_FILTERS = Object.fromEntries(
  Object.keys(TYPE_LIST).map((type) => [type, { highPass: null, lowPass: null, notch: null }])
);
