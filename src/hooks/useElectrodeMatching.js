import { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import { parseElectrodePositionFile } from '@/loaders/parseElectrodePositionFile';
import { matchChannelsToPositions } from '@/utils/eegTopographyUtils';
import { detectIsIntracranial } from '@/utils/intracranialDetection';
import electrodeTemplatePaths from 'virtual:electrode-position-templates';

const MIN_STANDARD_MATCH_COUNT_FOR_LED = 19; // below this limit (=>classic 10-20 system's electrode count), the template match is too sparse for a usable topography — status LED stays red instead of auto-matched blue
const MIN_CUSTOM_MATCH_RATIO_FOR_LED = 0.9; // a user-supplied position file should cover nearly every channel — below this, the LED turns amber rather than green, since it likely doesn't match this recording. 90% (not 100%) tolerates the odd non-scalp channel (ECG/EOG/trigger) a position file has no reason to cover.
const RECORDING_TYPE_TOAST_ID = 'eeg-recording-type-detected'; // fixed id so re-detection updates the toast in place instead of stacking

/**
 * Loads all bundled position templates, selects the one matching the most channel names,
 * and detects whether the recording is scalp EEG or SEEG from that match.
 *
 * A custom position file always wins when present. SEEG recordings never fall back to a
 * scalp template; otherwise the best-matching bundled template is used.
 */
export function useElectrodeMatching({ channelNames, customElectrodes, customElecPosFileName }) {
  const [standardTemplate, setStandardTemplate] = useState({
    path: null,
    electrodes: [],
    matched: [],
  });
  const [detectedIsSeeg, setDetectedIsSeeg] = useState(false);

  // Fetch the built-in electrode position templates, match them against the recording's
  // channel names (for detection purposes only), use the best-matching template
  // then (re-)detect the recording type.
  // Re-runs whenever channelNames changes (new recording loaded).
  useEffect(() => {
    let cancelled = false;

    Promise.allSettled(
      electrodeTemplatePaths.map(async (path) => {
        const response = await fetch(path);
        if (response.ok === false) throw new Error(`Failed to load electrode template: ${path}`);

        const { electrodes } = await parseElectrodePositionFile(
          new File([await response.text()], path.split('/').pop())
        );
        if (electrodes.length === 0)
          throw new Error(`Electrode template contains no positions: ${path}`);

        const { matched } = matchChannelsToPositions(channelNames, electrodes);
        return { path, electrodes, matched };
      })
    ).then((results) => {
      if (cancelled) return;

      const candidates = results.flatMap((result, index) => {
        if (result.status === 'fulfilled') return [result.value];
        console.error(
          `Unable to use electrode template ${electrodeTemplatePaths[index]}.`,
          result.reason
        );
        return [];
      });

      if (candidates.length === 0) {
        setStandardTemplate({ path: null, electrodes: [], matched: [] });
        setDetectedIsSeeg(false);
        toast.error('Unable to load any built-in electrode position templates.');
        return;
      }

      // Paths are sorted in the generated module, so ties resolve deterministically.
      const bestMatch = candidates.reduce((best, candidate) =>
        candidate.matched.length > best.matched.length ? candidate : best
      );
      setStandardTemplate(bestMatch);
      const isSeeg = detectIsIntracranial(channelNames, bestMatch.electrodes);
      setDetectedIsSeeg(isSeeg);
      toast(isSeeg ? 'SEEG recording detected' : 'EEG recording detected', {
        id: RECORDING_TYPE_TOAST_ID,
        icon: '🔍',
      });
    });

    return () => {
      cancelled = true;
    };
  }, [channelNames]);

  // Custom positions are matched independently of mode, since intracranial recordings
  // need them for the 3D connectome too.
  const customMatched = useMemo(
    () => matchChannelsToPositions(channelNames, customElectrodes).matched,
    [channelNames, customElectrodes]
  );

  // Render-facing electrodes/matched. Scalp mode falls back to the best-matchingtemplate
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
    standardTemplatePath: standardTemplate.path,
    electrodePositionMatchCount,
    electrodePositionTotalCount,
    isElectrodePositionMatchGoodForLed,
  };
}
