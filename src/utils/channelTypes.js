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

/**
 * Counts the recording's channels per channel type, so the Global Filters window can show
 * which types actually have channels (a type's global filter only affects channels of that
 * type). A channel without settings counts as eeg, the same fallback the display rows use.
 *
 * @param {string[]} channelNames - The recording's channel names.
 * @param {Object<string, {type: string}>} channelSettings - Per-channel settings, keyed by
 *   channel name; entries for names not in channelNames are ignored.
 * @returns {Object<string, number>} A count for every TYPE_LIST type, 0 when it has no channels.
 */
export function countChannelsByType(channelNames, channelSettings) {
  const counts = Object.fromEntries(TYPE_ORDER.map((type) => [type, 0]));
  channelNames.forEach((name) => {
    const type = channelSettings[name]?.type ?? 'eeg';
    if (type in counts) counts[type] += 1; // skip a type not in TYPE_LIST instead of making NaN
  });
  return counts;
}
