import { useMemo } from 'react';
import { parseMontageText } from '@/loaders/parseMontageText';
import { isMontageRowDrawable, remapMontageToRecording } from '@/utils/eegViewerUtils';

// montage templates
// ?raw: import the file's contents as a string (bundled at build time), instead of its URL
import downsampledMtg from '@/assets/montage_files/Downsampled_10-20.mtg?raw';
import longBipolarMtg from '@/assets/montage_files/LongBipolar_10-20.mtg?raw';
import transBipolarMtg from '@/assets/montage_files/TransBipolar_10-20.mtg?raw';
import doubleBananaMtg from '@/assets/montage_files/DoubleBanana_10-20.mtg?raw';
import tripleBananaMtg from '@/assets/montage_files/TripleBanana_10-20.mtg?raw';

// channel maps
import tenTwentyToEgi256Numbers from '@/assets/montage_files/channel_maps/10-20_to_EGI256.json';

// Adds the recording's channel prefix to each electrode number: { Fp1: 'E37', ..., Cz: 'VREF' }
function buildEgi256ChannelNames(prefix) {
  const channelNames = Object.entries(tenTwentyToEgi256Numbers).map(([name, number]) => [
    name,
    `${prefix}${number}`,
  ]);
  return { ...Object.fromEntries(channelNames), Cz: 'VREF' };
}

export const MAP_1020_TO_EGI256_E_NAMES = buildEgi256ChannelNames('E');
export const MAP_1020_TO_EGI256_NUMBER_NAMES = buildEgi256ChannelNames('');

// How each electrode template's recordings name their channels (ids from STANDARD_TEMPLATES in
// useElectrodeMatching). A template not listed here gets no montages: E1–E128 also exist in the
// 256 net but at different positions, so the GSN-HydroCel-128 templates are left out until it
// has been verified which montages make sense for them — they only get None and CAR.
// - namePrefix: added to each montage's name, so the dropdown shows which net it's for
// - channelAliases: the recording's name for each montage channel, see remapMontageToRecording
export const MONTAGE_NAMING_SYSTEMS = {
  standard_1020: { namePrefix: '', channelAliases: {} },
  fsaverage_1005: { namePrefix: '', channelAliases: {} },
  template_EGI256_prefix_E: {
    namePrefix: 'EGI 256 - ',
    channelAliases: MAP_1020_TO_EGI256_E_NAMES,
  },
  template_EGI256: { namePrefix: 'EGI 256 - ', channelAliases: MAP_1020_TO_EGI256_NUMBER_NAMES },
};

// Bundled montage templates, parsed once at module load, in dropdown order.
// - id: stable key for code (the file name without .mtg) — also the dropdown <option>
//   value, and what useMontageChannels reports as the matching template
// - name: UI text shown in the dropdown, free to change
export const MONTAGE_TEMPLATES = [
  {
    id: 'Downsampled_10-20',
    name: 'Downsampled (10-20)',
    text: downsampledMtg,
  },
  {
    id: 'LongBipolar_10-20',
    name: 'Long. Bipolar (10-20)',
    text: longBipolarMtg,
  },
  {
    id: 'TransBipolar_10-20',
    name: 'Trans. Bipolar (10-20)',
    text: transBipolarMtg,
  },
  {
    id: 'DoubleBanana_10-20',
    name: 'Double Banana (10-20)',
    text: doubleBananaMtg,
  },
  {
    id: 'TripleBanana_10-20',
    name: 'Triple Banana (10-20)',
    text: tripleBananaMtg,
  },
].map(({ text, ...template }) => ({ ...template, ...parseMontageText(text) }));

/**
 * The montage templates to offer for this recording, in the recording's own channel spelling
 * (see remapMontageToRecording), so applying one needs no further conversion. A template is
 * offered when the recording's best-matching electrode template has a naming system (see
 * MONTAGE_NAMING_SYSTEMS) and at least one of the template's rows can be drawn. The second check
 * is needed because the electrode matching always returns a template, even with 0 matched
 * channels. SEEG recordings get none: scalp montages don't apply to depth contacts, even if a
 * name like "F3" happens to overlap.
 *
 * @param {Object} params
 * @param {string[]} params.channelNames - the recording's channel names.
 * @param {string} params.standardTemplateId - id of the best-matching electrode template.
 * @param {boolean} params.detectedIsSeeg - whether the recording was detected as SEEG.
 * @returns {Array<{id: string, name: string, rows: Array, channelTypes: Object}>}
 */
export function useMontageTemplates({ channelNames, standardTemplateId, detectedIsSeeg }) {
  return useMemo(() => {
    // find how this recording names its channels; SEEG and unlisted templates get no montages
    const namingSystem = MONTAGE_NAMING_SYSTEMS[standardTemplateId];
    if (detectedIsSeeg || !namingSystem) return [];

    // rewrite each montage to the recording's channel names and add the dropdown prefix
    const { namePrefix, channelAliases } = namingSystem;
    const remappedTemplates = MONTAGE_TEMPLATES.map((template) => ({
      ...template,
      ...remapMontageToRecording(template, channelNames, channelAliases),
      name: `${namePrefix}${template.name}`,
    }));

    // only keep the montages with at least one row that can be drawn for this recording
    return remappedTemplates.filter(({ rows }) =>
      rows.some((row) => isMontageRowDrawable(row, channelNames))
    );
  }, [channelNames, standardTemplateId, detectedIsSeeg]);
}
