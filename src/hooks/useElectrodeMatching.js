import { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import { parseElcElectrodePositions } from '@/loaders/parseElcElectrodePositions';
import { matchChannelsToPositions } from '@/utils/eegTopographyUtils';
import { detectIsIntracranial } from '@/utils/intracranialDetection';

const MIN_STANDARD_MATCH_COUNT_FOR_LED = 19; // below this limit (=>classic 10-20 system's electrode count), the standard_1005 template match is too sparse for a usable topography — status LED stays red instead of auto-matched blue
const MIN_CUSTOM_MATCH_RATIO_FOR_LED = 0.9; // a user-supplied position file should cover nearly every channel — below this, the LED turns amber rather than green, since it likely doesn't match this recording. 90% (not 100%) tolerates the odd non-scalp channel (ECG/EOG/trigger) a position file has no reason to cover.
const RECORDING_TYPE_TOAST_ID = 'eeg-recording-type-detected'; // fixed id so re-detection updates the toast in place instead of stacking

/**
 * Fetches the built-in standard_1005 electrode-position template, matches it against the
 * recording's channel names, and (re-)detects the recording type (EEG vs iEEG) from that
 * match — reporting it upward via onRecordingTypeChange. Also derives the render-facing
 * electrode/match set: a user-supplied file (customElectrodes) always wins when present,
 * intracranial recordings never fall back to the scalp template, and otherwise the
 * standard_1005 template is used.
 *
 * @param {Object} params
 * @param {string[]} params.channelNames - the loaded recording's channel names; the
 *   template (and any custom positions) are matched against these.
 * @param {Array<{label:string,x:number,y:number,z:number}>} params.customElectrodes -
 *   user-supplied electrode positions (from a dropped .elc/.tsv file), or `[]` if none.
 * @param {string|null} params.customElecPosFileName - filename of the loaded custom
 *   electrode-position file, or `null` if none — used only to decide which match count
 *   drives the status LED.
 * @param {'eeg'|'ieeg'} params.recordingType - the currently active recording type.
 * @param {(detected: 'eeg'|'ieeg') => void} params.onRecordingTypeChange - called with
 *   the auto-detected recording type whenever the standard_1005 template match completes.
 * @returns {Object} The electrode/recording-type detection state:
 *   - `isIntracranial` (boolean) — true when `recordingType` is 'ieeg'.
 *   - `electrodes` (Array) — the render-facing electrode positions (custom file if
 *     present or intracranial, otherwise the standard_1005 template).
 *   - `matched` (Array) — the subset of `electrodes` matched to `channelNames`, each with
 *     a `channelIdx` back-reference.
 *   - `isStandardElectrodes` (boolean) — true when no custom file is active and the
 *     recording isn't intracranial, i.e. `electrodes` is the standard_1005 template.
 *   - `electrodePositionMatchCount` (number|undefined) — match count to show on the
 *     Electrode Position status LED, or `undefined` when there's nothing meaningful to
 *     show (intracranial with no custom file).
 *   - `electrodePositionTotalCount` (number|undefined) — channel count to pair with
 *     `electrodePositionMatchCount` on the LED, same `undefined` case.
 *   - `isElectrodePositionMatchGoodForLed` (boolean) — whether the LED should render as a
 *     good match (green/blue) rather than a weak one (amber/red).
 */
export function useElectrodeMatching({
  channelNames,
  customElectrodes,
  customElecPosFileName,
  recordingType,
  onRecordingTypeChange,
}) {
  // Detection-only — always holds the standard_1005 template + its match against
  // channelNames, used purely as input to detectIsIntracranial. Never used to
  // render the topography itself (that's customElectrodes' job — see below).
  const [standard1005Electrodes, setStandard1005Electrodes] = useState([]);
  const [standard1005Matched, setStandard1005Matched] = useState([]);

  // Fetch the built-in electrode position template, match it against the recording's
  // channel names (for detection purposes only), then (re-)detect the recording type
  // and report it upward. Re-runs whenever channelNames changes (new recording loaded).
  useEffect(() => {
    fetch('electrode_positions/standard_1005.elc')
      .then((r) => r.text())
      .then((text) => {
        const { electrodes: parsedElectrodes } = parseElcElectrodePositions(text);
        setStandard1005Electrodes(parsedElectrodes);
        setStandard1005Matched(matchChannelsToPositions(channelNames, parsedElectrodes).matched);
        const detected = detectIsIntracranial(channelNames, parsedElectrodes) ? 'ieeg' : 'eeg';
        onRecordingTypeChange?.(detected);
        toast(detected === 'ieeg' ? 'iEEG recording detected' : 'EEG recording detected', {
          id: RECORDING_TYPE_TOAST_ID,
          icon: '🔍',
        });
      })
      .catch(() => {}); // silently ignore if file unavailable (e.g. in tests without the asset)
  }, [channelNames, onRecordingTypeChange]);

  const isIntracranial = recordingType === 'ieeg';

  // Channels matched against the custom electrode positions (if any) — independent
  // of mode, since intracranial recordings need this for the 3D connectome too.
  const customMatched = useMemo(
    () => matchChannelsToPositions(channelNames, customElectrodes).matched,
    [channelNames, customElectrodes]
  );

  // Render-facing electrodes/matched. Scalp mode falls back to the standard_1005
  // template when no custom file is loaded (today's behavior); intracranial mode
  // never falls back to it — standard_1005 simply doesn't apply to depth probes.
  const usingCustom = isIntracranial || customElectrodes.length > 0;
  const electrodes = usingCustom ? customElectrodes : standard1005Electrodes;
  const matched = usingCustom ? customMatched : standard1005Matched;
  const isStandardElectrodes = !isIntracranial && customElectrodes.length === 0;
  // Gates the status LED's auto-matched (blue) state — a technically non-empty match can
  // still be too sparse (e.g. one shared label like "Cz" out of 200+ channels) to call
  // positions "known".
  const isStandardMatchGoodForLed =
    isStandardElectrodes && standard1005Matched.length >= MIN_STANDARD_MATCH_COUNT_FOR_LED;

  // Electrode Position status LED — matchCount/totalCount are shown regardless of quality
  // (isGoodMatch just picks the color). A custom file's match is judged against
  // customMatched even in iEEG mode (no standard-template fallback there, but a custom
  // file's own match quality is still meaningful); the standard-template count only
  // applies in EEG mode, since standard_1005 doesn't apply to iEEG at all.
  const hasCustomElecPos = Boolean(customElecPosFileName);
  const electrodePositionMatchCount = hasCustomElecPos
    ? customMatched.length
    : !isIntracranial
      ? standard1005Matched.length
      : undefined;
  const electrodePositionTotalCount =
    hasCustomElecPos || !isIntracranial ? channelNames.length : undefined;
  const isElectrodePositionMatchGoodForLed = hasCustomElecPos
    ? channelNames.length > 0 &&
      customMatched.length / channelNames.length >= MIN_CUSTOM_MATCH_RATIO_FOR_LED
    : isStandardMatchGoodForLed;

  return {
    isIntracranial,
    electrodes,
    matched,
    isStandardElectrodes,
    electrodePositionMatchCount,
    electrodePositionTotalCount,
    isElectrodePositionMatchGoodForLed,
  };
}
