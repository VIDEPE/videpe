import { parseMontageText } from '@/loaders/parseMontageText';

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

// Bundled montage templates, parsed once at module load, in dropdown order.
// - id: stable key for code (the file name without .mtg) — also the dropdown <option>
//   value, and what useMontageChannels reports as the matching template
// - name: UI text shown in the dropdown, free to change
export const MONTAGE_TEMPLATES = [
  { id: 'GSN-HydroCel-257', name: 'GSN-HydroCel-257', text: gsn257Mtg },
  {
    id: 'GSN-HydroCel-257_downsampled',
    name: 'GSN-HydroCel-257 (downsampled)',
    text: gsn257DownsampledMtg,
  },
  { id: 'GSN-HydroCel-257_10-20', name: 'GSN-HydroCel-257 (10-20)', text: gsn257TenTwentyMtg },
  {
    id: 'GSN-HydroCel-257_10-20_downsampled',
    name: 'GSN-HydroCel-257 (10-20 + downsampled)',
    text: gsn257TenTwentyDownsampledMtg,
  },
  {
    id: 'GSN-HydroCel-257_withoutE',
    name: 'GSN-HydroCel-257 (withoutE)',
    text: gsn257WithoutEMtg,
  },
  {
    id: 'GSN-HydroCel-257_withoutE_downsampled',
    name: 'GSN-HydroCel-257 (withoutE + downsampled)',
    text: gsn257WithoutEDownsampledMtg,
  },
  {
    id: 'longbip_GSN-HydroCel-257_downsampled',
    name: 'Long. Bipolar - GSN-HydroCel-257 (downsampled)',
    text: longBipGsn257DownsampledMtg,
  },
  {
    id: 'longbip_GSN-HydroCel-257_10-20_downsampled',
    name: 'Long. Bipolar - GSN-HydroCel-257 (10-20 + downsampled)',
    text: longBipGsn257TenTwentyDownsampledMtg,
  },
  {
    id: 'longbip_GSN-HydroCel-257_withoutE_downsampled',
    name: 'Long. Bipolar - GSN-HydroCel-257 (withoutE + downsampled)',
    text: longBipGsn257WithoutEDownsampledMtg,
  },
  {
    id: 'transbip_GSN-HydroCel-257_downsampled',
    name: 'Trans. Bipolar - GSN-HydroCel-257 (downsampled)',
    text: transBipGsn257DownsampledMtg,
  },
  {
    id: 'transbip_GSN-HydroCel-257_10-20_downsampled',
    name: 'Trans. Bipolar - GSN-HydroCel-257 (10-20 + downsampled)',
    text: transBipGsn257TenTwentyDownsampledMtg,
  },
  {
    id: 'transbip_GSN-HydroCel-257_withoutE_downsampled',
    name: 'Trans. Bipolar - GSN-HydroCel-257 (withoutE + downsampled)',
    text: transBipGsn257WithoutEDownsampledMtg,
  },
  { id: 'double-banana_10-20', name: 'Double Banana (10-20)', text: doubleBananaMtg },
  { id: 'triple-banana_10-20', name: 'Triple Banana (10-20)', text: tripleBananaMtg },
].map(({ id, name, text }) => {
  const { rows, channelTypes } = parseMontageText(text);
  return { id, name, rows, channelTypes };
});

/**
 * The montage templates the sidebar dropdown offers. Bundled at build time, so the full
 * list is there on the first render — no fetch, no loading state.
 *
 * @returns {Array<{id: string, name: string, rows: Array, channelTypes: Object}>}
 */
export function useMontageTemplates() {
  return MONTAGE_TEMPLATES;
}
