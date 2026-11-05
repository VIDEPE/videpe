import { useMemo } from 'react';
import { parseMontageText } from '@/loaders/parseMontageText';
import { isMontageRowDrawable, resolveMontageToRecording } from '@/utils/eegViewerUtils';

// ?raw: import the file's contents as a string (bundled at build time), instead of its URL
import gsn257Mtg from '@/assets/montage_files/GSN-HydroCel-257.mtg?raw';
import gsn257DownsampledMtg from '@/assets/montage_files/GSN-HydroCel-257_downsampled.mtg?raw';
import gsn257TenTwentyMtg from '@/assets/montage_files/GSN-HydroCel-257_10-20.mtg?raw';
import gsn257TenTwentyDownsampledMtg from '@/assets/montage_files/GSN-HydroCel-257_10-20_downsampled.mtg?raw';
import gsn257WithoutEMtg from '@/assets/montage_files/GSN-HydroCel-257_withoutE.mtg?raw';
import gsn257WithoutEDownsampledMtg from '@/assets/montage_files/GSN-HydroCel-257_withoutE_downsampled.mtg?raw';
import longBipGsn257DownsampledMtg from '@/assets/montage_files/longbip_GSN-HydroCel-257_downsampled.mtg?raw';
import longBipGsn257TenTwentyDownsampledMtg from '@/assets/montage_files/longbip_GSN-HydroCel-257_10-20_downsampled.mtg?raw';
import longBipGsn257WithoutEDownsampledMtg from '@/assets/montage_files/longbip_GSN-HydroCel-257_withoutE_downsampled.mtg?raw';
import transBipGsn257DownsampledMtg from '@/assets/montage_files/transbip_GSN-HydroCel-257_downsampled.mtg?raw';
import transBipGsn257TenTwentyDownsampledMtg from '@/assets/montage_files/transbip_GSN-HydroCel-257_10-20_downsampled.mtg?raw';
import transBipGsn257WithoutEDownsampledMtg from '@/assets/montage_files/transbip_GSN-HydroCel-257_withoutE_downsampled.mtg?raw';
import doubleBananaMtg from '@/assets/montage_files/double-banana_10-20.mtg?raw';
import tripleBananaMtg from '@/assets/montage_files/triple-banana_10-20.mtg?raw';

// Which electrode templates (ids from STANDARD_TEMPLATES in useElectrodeMatching) each group of
// montages fits. Linked by hand because channel names alone can't tell: E1–E128 also exist in
// the 256 net but at different positions, so a GSN-HydroCel-128 recording would otherwise be
// offered the 257 montages. Nothing is linked to the GSN-HydroCel-128 templates until it has
// been verified which montages make sense for them — they only get None and CAR.
const GSN_256_E_NAMES = ['template_EGI256_prefix_E'];
const GSN_256_NUMBERS = ['template_EGI256'];
const TEN_TWENTY_NAMES = ['standard_1020', 'fsaverage_1005'];

// Bundled montage templates, parsed once at module load, in dropdown order.
// - id: stable key for code (the file name without .mtg) — also the dropdown <option>
//   value, and what useMontageChannels reports as the matching template
// - name: UI text shown in the dropdown, free to change
// - compatibleElectrodeTemplateIds: see above
export const MONTAGE_TEMPLATES = [
  {
    id: 'GSN-HydroCel-257',
    name: 'GSN-HydroCel-257',
    compatibleElectrodeTemplateIds: GSN_256_E_NAMES,
    text: gsn257Mtg,
  },
  {
    id: 'GSN-HydroCel-257_downsampled',
    name: 'GSN-HydroCel-257 (downsampled)',
    compatibleElectrodeTemplateIds: GSN_256_E_NAMES,
    text: gsn257DownsampledMtg,
  },
  {
    // Mixes bare numbers with 10-20 names (1, F8, 3, ...), mostly numbers: 188 of its 257
    // channels are in template_EGI256
    id: 'GSN-HydroCel-257_10-20',
    name: 'GSN-HydroCel-257 (10-20)',
    compatibleElectrodeTemplateIds: GSN_256_NUMBERS,
    text: gsn257TenTwentyMtg,
  },
  {
    id: 'GSN-HydroCel-257_10-20_downsampled',
    name: 'GSN-HydroCel-257 (10-20 + downsampled)',
    compatibleElectrodeTemplateIds: TEN_TWENTY_NAMES,
    text: gsn257TenTwentyDownsampledMtg,
  },
  {
    id: 'GSN-HydroCel-257_withoutE',
    name: 'GSN-HydroCel-257 (withoutE)',
    compatibleElectrodeTemplateIds: GSN_256_NUMBERS,
    text: gsn257WithoutEMtg,
  },
  {
    id: 'GSN-HydroCel-257_withoutE_downsampled',
    name: 'GSN-HydroCel-257 (withoutE + downsampled)',
    compatibleElectrodeTemplateIds: GSN_256_NUMBERS,
    text: gsn257WithoutEDownsampledMtg,
  },
  {
    id: 'longbip_GSN-HydroCel-257_downsampled',
    name: 'Long. Bipolar - GSN-HydroCel-257 (downsampled)',
    compatibleElectrodeTemplateIds: GSN_256_E_NAMES,
    text: longBipGsn257DownsampledMtg,
  },
  {
    id: 'longbip_GSN-HydroCel-257_10-20_downsampled',
    name: 'Long. Bipolar - GSN-HydroCel-257 (10-20 + downsampled)',
    compatibleElectrodeTemplateIds: TEN_TWENTY_NAMES,
    text: longBipGsn257TenTwentyDownsampledMtg,
  },
  {
    id: 'longbip_GSN-HydroCel-257_withoutE_downsampled',
    name: 'Long. Bipolar - GSN-HydroCel-257 (withoutE + downsampled)',
    compatibleElectrodeTemplateIds: GSN_256_NUMBERS,
    text: longBipGsn257WithoutEDownsampledMtg,
  },
  {
    id: 'transbip_GSN-HydroCel-257_downsampled',
    name: 'Trans. Bipolar - GSN-HydroCel-257 (downsampled)',
    compatibleElectrodeTemplateIds: GSN_256_E_NAMES,
    text: transBipGsn257DownsampledMtg,
  },
  {
    id: 'transbip_GSN-HydroCel-257_10-20_downsampled',
    name: 'Trans. Bipolar - GSN-HydroCel-257 (10-20 + downsampled)',
    compatibleElectrodeTemplateIds: TEN_TWENTY_NAMES,
    text: transBipGsn257TenTwentyDownsampledMtg,
  },
  {
    id: 'transbip_GSN-HydroCel-257_withoutE_downsampled',
    name: 'Trans. Bipolar - GSN-HydroCel-257 (withoutE + downsampled)',
    compatibleElectrodeTemplateIds: GSN_256_NUMBERS,
    text: transBipGsn257WithoutEDownsampledMtg,
  },
  {
    id: 'double-banana_10-20',
    name: 'Double Banana (10-20)',
    compatibleElectrodeTemplateIds: TEN_TWENTY_NAMES,
    text: doubleBananaMtg,
  },
  {
    id: 'triple-banana_10-20',
    name: 'Triple Banana (10-20)',
    compatibleElectrodeTemplateIds: TEN_TWENTY_NAMES,
    text: tripleBananaMtg,
  },
].map(({ text, ...template }) => ({ ...template, ...parseMontageText(text) }));

/**
 * The montage templates to offer for this recording, in the recording's own channel spelling
 * (see resolveMontageToRecording), so applying one needs no further conversion. A template is
 * offered when it's linked to the recording's best-matching electrode template and at least
 * one of its rows can be drawn. The second check is needed because the electrode matching
 * always returns a template, even with 0 matched channels. SEEG recordings get none: scalp
 * montages don't apply to depth contacts, even if a name like "F3" happens to overlap.
 *
 * @param {Object} params
 * @param {string[]} params.channelNames - the recording's channel names.
 * @param {string} params.standardTemplateId - id of the best-matching electrode template.
 * @param {boolean} params.detectedIsSeeg - whether the recording was detected as SEEG.
 * @returns {Array<{id: string, name: string, rows: Array, channelTypes: Object}>}
 */
export function useMontageTemplates({ channelNames, standardTemplateId, detectedIsSeeg }) {
  return useMemo(() => {
    if (detectedIsSeeg) return [];

    return MONTAGE_TEMPLATES.filter(({ compatibleElectrodeTemplateIds }) =>
      compatibleElectrodeTemplateIds.includes(standardTemplateId)
    )
      .map((template) => ({ ...template, ...resolveMontageToRecording(template, channelNames) }))
      .filter(({ rows }) => rows.some((row) => isMontageRowDrawable(row, channelNames)));
  }, [channelNames, standardTemplateId, detectedIsSeeg]);
}
