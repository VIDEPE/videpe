import { useState, useMemo, useCallback } from 'react';
import toast from 'react-hot-toast';
import { parseInverseSolutionFieldtrip } from '../loaders/parseInverseSolutionFieldtrip';
import { electricalSourceImaging } from '../utils/electricalSourceImagingUtils';

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
 * @param {boolean} params.esiEnabled
 *   Whether the ESI toggle in EegViewer is currently on. `esiLayer` is only computed
 *   while this is true — mirrors PatientView's electrodeRenderEnabled gating of
 *   electrodeLayer.
 * @returns {Object} The current ESI state, plus the functions needed to drive it:
 *   - `inverseSolution` (object|null) — the parsed FieldTrip inverse-solution data, or
 *     `null` if none has been loaded.
 *   - `inverseSolutionFileName` (string|null) — the filename (without extension) of the
 *     loaded inverse-solution file, or `null` if none.
 *   - `esiLayer` (object|null) — the computed ESI source-power layer
 *     ({ sourcePowerConnectomes, sourcePowerVolume }), or `null` when there's nothing to
 *     show (no inverse solution, no channel data yet, intracranial, or `esiEnabled` is
 *     false).
 *   - `handleInverseSolutionFile` (file: File) => Promise<void> — parses and activates
 *     a single inverse-solution (.mat) file.
 *   - `resetInverseSolution` () => void — clears the inverse solution and its filename.
 */
export function useElectricalSourceImaging({ channelSnapshot, esiEnabled }) {
  const [inverseSolution, setInverseSolution] = useState(null);
  const [inverseSolutionFileName, setInverseSolutionFileName] = useState(null);

  /**
   * Parses one inverse-solution file and, if parsing succeeds, makes it the active
   * inverse solution (replacing whatever was active before, if anything). Shows a toast
   * confirming success or reporting a parse error, and — if the recording is currently
   * iEEG — an extra toast noting that ESI has no effect until the user switches to EEG
   * mode.
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
      } catch (err) {
        toast.error(err.message);
      }
    },
    [channelSnapshot]
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
    esiLayer,
    handleInverseSolutionFile,
    resetInverseSolution,
  };
}
