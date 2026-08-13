import { useState, useMemo, useCallback } from 'react';
import toast from 'react-hot-toast';
import { parseInverseSolutionFieldtrip } from '../loaders/parseInverseSolutionFieldtrip';
import {
  electricalSourceImaging,
  matchChannelsToInverseSolution,
} from '../utils/electricalSourceImagingUtils';

/**
 * Owns the inverse-solution file and the Electrical Source Imaging (ESI) layer derived
 * from it. ESI only applies to scalp EEG under a common-average reference — that
 * referencing is now unconditional (see useTimepointSnapshot.js/eegViewerUtils.js, which
 * always average-reference the good channels for topography/connectome/ESI), so this hook
 * no longer needs to force or warn about any montage selection; it only gates `esiLayer`
 * on `esiEnabled` and the recording being scalp EEG.
 *
 * @param {Object} params
 * @param {object|null} params.channelSnapshot
 *   The latest per-channel voltage snapshot lifted out of EegViewer (captured on each
 *   topography click, already average-referenced from good channels only). Fed into the
 *   ESI computation alongside the inverse solution to produce `esiLayer`.
 * @param {string[]} params.channelNames
 *   The recording's full channel-name list — available as soon as a recording loads,
 *   independent of any plot click. Used only to drive the Inverse Solution status LED's
 *   match count against the loaded file's own channels; the actual `esiLayer` computation
 *   matches per-click against `channelSnapshot.channelNames` instead (see
 *   electricalSourceImagingUtils.js's matchVoltagesToInverseSolution).
 * @param {boolean} params.esiEnabled
 *   Whether the ESI toggle in EegViewer is currently on. `esiLayer` is only computed
 *   while this is true — mirrors PatientView's electrodeRenderEnabled gating of
 *   electrodeLayer.
 * @returns {Object} The current ESI state, plus the functions needed to drive it:
 *   - `inverseSolution` (object|null) — the parsed FieldTrip inverse-solution data, or
 *     `null` if none has been loaded.
 *   - `inverseSolutionFileName` (string|null) — the filename (without extension) of the
 *     loaded inverse-solution file, or `null` if none.
 *   - `esiChannelMatchCount`/`esiChannelTotalCount` (number|undefined) — how many of the
 *     inverse solution's own channels have a same-named match in `channelNames`, paired
 *     with the model's total channel count. `undefined` when there's no file loaded yet
 *     (nothing to match against).
 *   - `isEsiChannelMatchGoodForLed` (boolean) — true only for a *full* match (every one of
 *     the model's channels found) — unlike Electrode Position, a partial match here means
 *     ESI can't compute at all, not just degrade.
 *   - `esiLayer` (object|null) — the computed ESI source-power layer
 *     ({ sourcePowerConnectomes, sourcePowerVolume }), or `null` when there's nothing to
 *     show (no inverse solution, no channel data yet, intracranial, a partial channel
 *     match, or `esiEnabled` is false).
 *   - `handleInverseSolutionFile` (file: File) => Promise<void> — parses and activates
 *     a single inverse-solution (.mat) file.
 *   - `resetInverseSolution` () => void — clears the inverse solution and its filename.
 */
export function useElectricalSourceImaging({ channelSnapshot, channelNames, esiEnabled }) {
  const [inverseSolution, setInverseSolution] = useState(null);
  const [inverseSolutionFileName, setInverseSolutionFileName] = useState(null);

  // Independent of any plot click — drives the Inverse Solution LED's match count as soon
  // as both a file and a recording are present, same timing as Electrode Position's LED.
  const esiChannelMatch = useMemo(
    () =>
      inverseSolution && channelNames?.length
        ? matchChannelsToInverseSolution(channelNames, inverseSolution.channelLabels)
        : null,
    [inverseSolution, channelNames]
  );

  /**
   * Parses one inverse-solution file and, if parsing succeeds, makes it the active
   * inverse solution (replacing whatever was active before, if anything). Shows a toast
   * confirming success or reporting a parse error, plus two conditional warnings: one if
   * the recording is currently SEEG-majority (ESI has no effect until channel types read
   * as EEG), and one if the recording has a duplicate channel name the model needs (ESI
   * can never compute for that case — see matchChannelsToInverseSolution).
   *
   * @param {File} file - the dropped/selected inverse-solution (.mat, FieldTrip) file.
   * @returns {Promise<void>} Resolves once parsing finishes and state/toasts have been
   *   updated. Doesn't return a value — callers read the result back via this hook's
   *   `inverseSolution`/`inverseSolutionFileName` return values, not via this promise.
   */
  const handleInverseSolutionFile = useCallback(
    async (file) => {
      try {
        const parsedInverseSolution = await parseInverseSolutionFieldtrip(file);
        setInverseSolution(parsedInverseSolution);
        setInverseSolutionFileName(file.name.replace(/\.[^.]+$/, ''));
        // Confirm the load — same reasoning as electrode positions: the compact dropzone
        // gives no visible feedback of its own that the file was accepted.
        toast.success(`Loaded inverse solution from ${file.name}`);

        // ESI only applies to scalp EEG — the file is still stored (and will take effect
        // automatically once the majority of channel types read as EEG), but tell the user
        // it has no effect right now rather than let them wonder why nothing happened.
        // Relies on channelSnapshot, so this only fires once a topo click has produced a
        // snapshot — before that there's nothing to warn about yet since esiLayer can't
        // compute regardless.
        if (channelSnapshot?.isIntracranial) {
          toast(
            'Electrical Source Imaging is not available while the majority of channels are SEEG',
            {
              icon: '⚠️',
            }
          );
        }

        // A duplicate channel name (e.g. a SEEG and an EEG channel sharing a name) makes
        // ESI unable to compute at all for that channel, silently — surface it explicitly
        // rather than let the toggle just sit disabled with no explanation. Computed fresh
        // from the just-parsed file rather than the memoized esiChannelMatch below, which
        // still reflects the *previous* inverseSolution state at this point in the callback.
        if (channelNames?.length) {
          const { duplicateChannelNames } = matchChannelsToInverseSolution(
            channelNames,
            parsedInverseSolution.channelLabels
          );
          if (duplicateChannelNames.length > 0) {
            toast.error(
              `Electrical Source Imaging can't compute — this recording has more than one channel named ${duplicateChannelNames.join(', ')}`
            );
          }
        }
      } catch (err) {
        toast.error(err.message);
      }
    },
    [channelSnapshot, channelNames]
  );

  const esiLayer = useMemo(
    () => (esiEnabled ? electricalSourceImaging(inverseSolution, channelSnapshot) : null),
    [inverseSolution, channelSnapshot, esiEnabled]
  ); // ESI source power — { sourcePowerConnectomes, sourcePowerVolume } | null | [] — electricalSourceImaging itself returns null for intracranial/missing data

  /**
   * Clears the loaded inverse solution and its filename — returning this hook's state to
   * what it was before any inverse-solution file was loaded.
   *
   * @returns {void} No return value — this only produces the state reset as a side effect.
   */
  const resetInverseSolution = useCallback(() => {
    setInverseSolution(null);
    setInverseSolutionFileName(null);
  }, []);

  return {
    inverseSolution,
    inverseSolutionFileName,
    esiChannelMatchCount: esiChannelMatch?.matchCount,
    esiChannelTotalCount: esiChannelMatch?.totalCount,
    isEsiChannelMatchGoodForLed: esiChannelMatch?.isGoodMatch ?? false,
    esiLayer,
    handleInverseSolutionFile,
    resetInverseSolution,
  };
}
