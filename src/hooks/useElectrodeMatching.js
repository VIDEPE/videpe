import { useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';

import { parseElectrodePositionTsv } from '@/loaders/parseElectrodePositionTsv';
import { matchChannelsToPositions } from '@/utils/eegTopographyUtils';
import { detectIsIntracranial } from '@/utils/intracranialDetection';

// ?raw: import the file's contents as a string (bundled at build time), instead of its URL
import fsaverage1005Tsv from '@/assets/electrode_positions/fsaverage_1005.tsv?raw';
import standard1020Tsv from '@/assets/electrode_positions/standard_1020.tsv?raw';
import egi128PrefixETsv from '@/assets/electrode_positions/template_EGI128_prefix_E.tsv?raw';
import egi128Tsv from '@/assets/electrode_positions/template_EGI128.tsv?raw';
import egi256PrefixETsv from '@/assets/electrode_positions/template_EGI256_prefix_E.tsv?raw';
import egi256Tsv from '@/assets/electrode_positions/template_EGI256.tsv?raw';

// Bundled position templates, parsed once at module load.
// - id: stable key for code (the file name without .tsv), e.g. for filtering montages later
// - name: UI text shown to the user, free to change
// Order doesn't matter, best match is found using findBestStandardTemplate.
export const STANDARD_TEMPLATES = [
  { id: 'fsaverage_1005', name: 'fsaverage 10-05 (FreeSurfer)', text: fsaverage1005Tsv },
  { id: 'standard_1020', name: 'Standard 10-20', text: standard1020Tsv },
  { id: 'template_EGI128_prefix_E', name: 'GSN-HydroCel-128 (E1-E128)', text: egi128PrefixETsv },
  { id: 'template_EGI128', name: 'GSN-HydroCel-128 (1-128)', text: egi128Tsv },
  { id: 'template_EGI256_prefix_E', name: 'GSN-HydroCel-256 (E1-E256)', text: egi256PrefixETsv },
  { id: 'template_EGI256', name: 'GSN-HydroCel-256 (1-256)', text: egi256Tsv },
].map(({ id, name, text }) => ({
  id,
  name,
  electrodes: parseElectrodePositionTsv(text).electrodes,
}));

const MIN_STANDARD_MATCH_COUNT_FOR_LED = 19; // below this limit (=>classic 10-20 system's electrode count), the template match is too sparse for a usable topography — status LED stays red instead of auto-matched blue
const MIN_CUSTOM_MATCH_RATIO_FOR_LED = 0.9; // a user-supplied position file should cover nearly every channel — below this, the LED turns amber rather than green, since it likely doesn't match this recording. 90% (not 100%) tolerates the odd non-scalp channel (ECG/EOG/trigger) a position file has no reason to cover.
const RECORDING_TYPE_TOAST_ID = 'eeg-recording-type-detected'; // fixed id so re-detection updates the toast in place instead of stacking

// Best template for this recording:
// 1. the most matched channels in the recording — covers as much of the recording as possible
// 2. on a tie, the highest share of the template's positions used — favours the smallest template
function findBestStandardTemplate(channelNames) {
  // Match every template, and add the share of its positions the recording uses
  const scoredTemplates = STANDARD_TEMPLATES.map((template) => {
    const { matched } = matchChannelsToPositions(channelNames, template.electrodes);
    const templateCoverage = matched.length / template.electrodes.length;
    return { ...template, matched, templateCoverage };
  });

  let best = scoredTemplates[0];
  for (const candidate of scoredTemplates.slice(1)) {
    const hasMoreMatches = candidate.matched.length > best.matched.length;
    const hasMatchesTieButHigherCoverage =
      candidate.matched.length === best.matched.length &&
      candidate.templateCoverage > best.templateCoverage;
    if (hasMoreMatches || hasMatchesTieButHigherCoverage) best = candidate;
  }
  return best;
}

/**
 * Loads all bundled position templates, selects the one matching the most channel names,
 * and detects whether the recording is scalp EEG or SEEG from that match.
 *
 * A custom position file always wins when present. SEEG recordings never fall back to a
 * scalp template; otherwise the best-matching bundled template is used.
 */
export function useElectrodeMatching({ channelNames, customElectrodes, customElecPosFileName }) {
  // 1. Best bundled template — needed first, since the SEEG check uses its match
  const standardTemplate = useMemo(() => findBestStandardTemplate(channelNames), [channelNames]);
  // 2. SEEG check, from the channel names' shape and that template match
  const detectedIsSeeg = useMemo(
    () => detectIsIntracranial(channelNames, standardTemplate.electrodes),
    [channelNames, standardTemplate]
  );

  // Toast the detected recording type — a side effect, so it belongs in an effect, not in
  // the useMemo above. Re-runs when a new recording is loaded (channelNames) or the
  // detection changes; the fixed toast id updates the existing toast instead of stacking.
  useEffect(() => {
    toast(detectedIsSeeg ? 'SEEG recording detected' : 'EEG recording detected', {
      id: RECORDING_TYPE_TOAST_ID,
      icon: '🔍',
    });
  }, [channelNames, detectedIsSeeg]);

  // Custom positions are matched independently of mode, since intracranial recordings
  // need them for the 3D connectome too.
  const customMatched = useMemo(
    () => matchChannelsToPositions(channelNames, customElectrodes).matched,
    [channelNames, customElectrodes]
  );

  // Render-facing electrodes/matched. Scalp mode falls back to the best-matching
  // template when no custom file is loaded (today's behavior); intracranial mode
  // never falls back to it — best-matching template simply doesn't apply to depth probes.
  const usingCustom = detectedIsSeeg || customElectrodes.length > 0;
  const electrodes = usingCustom ? customElectrodes : standardTemplate.electrodes;
  const matched = usingCustom ? customMatched : standardTemplate.matched;
  const isStandardElectrodes = !detectedIsSeeg && customElectrodes.length === 0;
  // Gates the status LED's auto-matched (blue) state — a technically non-empty match can
  // still be too sparse (e.g. one shared label like "Cz" out of 200+ channels) to call
  // positions "known".
  const isStandardMatchGoodForLed =
    isStandardElectrodes && standardTemplate.matched.length >= MIN_STANDARD_MATCH_COUNT_FOR_LED;

  // Electrode Position status LED — matchCount/totalCount are shown regardless of quality
  // (isGoodMatch just picks the color). A custom file's match is judged against
  // customMatched even in iEEG mode (no standard-template fallback there, but a custom
  // file's own match quality is still meaningful); the standard-template count only
  // applies in EEG mode, since fsaverage_1005 doesn't apply to iEEG at all.
  const hasCustomElecPos = Boolean(customElecPosFileName);
  const electrodePositionMatchCount = hasCustomElecPos
    ? customMatched.length
    : !detectedIsSeeg
      ? standardTemplate.matched.length
      : undefined;
  const electrodePositionTotalCount =
    hasCustomElecPos || !detectedIsSeeg ? channelNames.length : undefined;
  const isElectrodePositionMatchGoodForLed = hasCustomElecPos
    ? channelNames.length > 0 &&
      customMatched.length / channelNames.length >= MIN_CUSTOM_MATCH_RATIO_FOR_LED
    : isStandardMatchGoodForLed;

  return {
    detectedIsSeeg,
    electrodes,
    matched,
    isStandardElectrodes,
    standardTemplateId: standardTemplate.id,
    standardTemplateName: standardTemplate.name,
    electrodePositionMatchCount,
    electrodePositionTotalCount,
    isElectrodePositionMatchGoodForLed,
  };
}
