import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import toast from 'react-hot-toast';
import { parseInverseSolutionFieldtrip } from '../loaders/parseInverseSolutionFieldtrip';
import { electricalSourceImaging } from '../utils/electricalSourceImagingUtils';

/**
 * Owns the inverse-solution file and the Electrical Source Imaging (ESI) layer derived
 * from it. ESI only applies to scalp EEG under a common-average reference, so this hook
 * also owns the behavior that forces/warns about the Average montage whenever an inverse
 * solution is active in EEG mode — but the montage state itself is owned by the caller
 * (see useMontage) and passed in here, since montage is a general EEG-referencing concept
 * that other features (e.g. bad-channel selection) will also need, independent of ESI.
 *
 * @param {Object} params
 * @param {object|null} params.eeg
 *   The currently loaded EEG recording (or `null` before one is loaded). Used only to
 *   gate the Average-montage-forcing effect: it must not run before a recording exists,
 *   since `recordingType` defaults to 'eeg' pre-load and could still turn out to be iEEG.
 * @param {'eeg'|'ieeg'} params.recordingType
 *   Whether the loaded recording is scalp EEG or intracranial iEEG. ESI only applies to
 *   'eeg' — this is used both to decide whether to force the Average montage, and to
 *   warn the user when an inverse solution is loaded while in 'ieeg' mode.
 * @param {object|null} params.channelSnapshot
 *   The latest per-channel voltage snapshot lifted out of EegViewer (captured on each
 *   topography click). Fed into the ESI computation alongside the inverse solution to
 *   produce `esiLayer`.
 * @param {'none'|'average'|'median'} params.montage
 *   The currently selected EEG reference montage, owned by useMontage. Read here to
 *   decide whether `esiLayer` should be computed (ESI is only valid under 'average').
 * @param {(newMontage: string) => void} params.setMontage
 *   The raw montage setter from useMontage. Called here to force the montage to
 *   'average' when an inverse solution becomes active in EEG mode, and by
 *   `handleMontageChange` to apply the user's own montage selection.
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
 *     show (no inverse solution, montage isn't Average, no channel data yet, or
 *     `esiEnabled` is false).
 *   - `handleInverseSolutionFile` (file: File) => Promise<void> — parses and activates
 *     a single inverse-solution (.mat) file.
 *   - `handleMontageChange` (newMontage: string) => void — applies the user's montage
 *     selection (via setMontage), warning them if doing so hides a visible ESI layer.
 *   - `resetInverseSolution` () => void — clears the inverse solution and its filename.
 *     Does not touch the montage — the caller resets that separately via useMontage.
 */
export function useElectricalSourceImaging({
  eeg,
  recordingType,
  channelSnapshot,
  montage,
  setMontage,
  esiEnabled,
}) {
  const [inverseSolution, setInverseSolution] = useState(null);
  const [inverseSolutionFileName, setInverseSolutionFileName] = useState(null);

  /**
   * Parses one inverse-solution file and, if parsing succeeds, makes it the active
   * inverse solution (replacing whatever was active before, if anything). Shows a toast
   * confirming success or reporting a parse error, and — if the recording is currently
   * iEEG — an extra toast noting that ESI has no effect until the user switches to EEG
   * mode. Does not itself force the Average montage; that's handled by the effect below,
   * which reacts to `inverseSolution` changing.
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
        // gives no visible feedback of its own that the file was accepted. Forcing the
        // Average montage (and warning about it) is handled by the effect below, which
        // also covers the case of switching into EEG mode with a solution already loaded.
        toast.success(`Loaded inverse solution from ${file.name}`);

        // ESI only applies to scalp EEG — the file is still stored (and will be picked up
        // automatically by the force-Average effect below once the user switches back to
        // EEG mode), but tell them it has no effect right now rather than let them wonder
        // why nothing happened.
        if (recordingType === 'ieeg') {
          toast(
            'Electrical Source Imaging is not available for iEEG — will apply once you switch to EEG mode',
            {
              icon: '⚠️',
            }
          );
        }
      } catch (err) {
        toast.error(err.message);
      }
    },
    [recordingType]
  );

  // Holds the latest montage so the ESI-forcing effect below can read it without listing
  // montage as a dependency — otherwise the effect would re-run and undo a deliberate
  // switch away from Average the moment the user made it.
  const montageRef = useRef(montage);
  montageRef.current = montage;

  // ESI is only valid for scalp EEG under a common-average reference. Whenever an inverse
  // solution is present in EEG mode, force the Average montage and tell the user why —
  // but not before `eeg` loads, since recordingType defaults to 'eeg' pre-load and the
  // recording could still turn out to be iEEG. Not keyed on montage, so a deliberate
  // switch away from Average isn't undone. Fixed toast id collapses StrictMode's
  // double-invoke (and any rapid re-trigger) into one.
  useEffect(() => {
    if (!inverseSolution || !eeg || recordingType !== 'eeg') return;
    if (montageRef.current === 'average') return; // already Average — repeating the warning is just noise
    setMontage('average');
    toast('Montage set to Average — required for Electrical Source Imaging', {
      icon: '⚠️',
      id: 'esi-force-average-montage',
    });
  }, [inverseSolution, eeg, recordingType, setMontage]);

  const esiLayer = useMemo(
    () =>
      montage === 'average' && esiEnabled
        ? electricalSourceImaging(inverseSolution, channelSnapshot)
        : null,
    [inverseSolution, channelSnapshot, montage, esiEnabled]
  ); // ESI source power — { sourcePowerConnectomes, sourcePowerVolume } | null | [] — only valid under the Average montage while the ESI toggle is on

  // Montage is a controlled prop on EegViewer so it can be forced to 'average' above
  // when adding an inverse solution file.
  // This is the other direction — the user switching away from it while ESI is active. Warns
  // only when doing so actually hides a layer that was visible: not merely whenever an
  // inverse solution happens to be loaded. That excludes iEEG mode (ESI never applies
  // there) and EEG mode before the first channel click (no channelSnapshot yet, so no
  // layer has ever been computed) — in both cases esiLayer is already falsy, so nothing
  // is being hidden and the warning would be misleading.
  /**
   * Applies the user's EEG reference montage selection (via setMontage). If the new
   * montage isn't Average and an ESI layer is currently visible, warns the user that
   * it's about to be hidden — this is the user-initiated counterpart to the auto-forcing
   * effect above.
   *
   * @param {'none'|'average'|'median'} newMontage - the montage the user selected.
   * @returns {void} No return value — this only calls setMontage (and shows a toast) as
   *   a side effect.
   */
  const handleMontageChange = useCallback(
    (newMontage) => {
      setMontage(newMontage);
      if (newMontage !== 'average' && esiLayer) {
        toast('Electrical Source Imaging requires the Average montage — layer hidden', {
          icon: '⚠️',
        });
      }
    },
    [esiLayer, setMontage]
  );

  /**
   * Clears the loaded inverse solution and its filename — returning this hook's state to
   * what it was before any inverse-solution file was loaded. Does not touch the montage:
   * that's owned by useMontage, so the caller resets it separately (via its own
   * `resetMontage`) alongside calling this.
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
    handleMontageChange,
    resetInverseSolution,
  };
}
