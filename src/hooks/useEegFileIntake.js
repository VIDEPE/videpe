import { useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import {
  detectAndLoadEEG,
  checkEegFiles,
  ELEC_POS_EXTENSIONS,
  INV_SOLUTIONS_EXTENSIONS,
  EEG_FORMAT_EXTENSIONS,
} from '../loaders/eegFormats';
import { parseElectrodePositionFile } from '../loaders/parseElectrodePositionFile';
import { findDuplicateChannelNames } from '../utils/eegTopographyUtils';

/**
 * Owns the EEG-recording file-drop intake pipeline:
 * - all dropped/selected files accumulate until the minimum required files for a specific
 *   EEG format to load (see loaders/eegFormat.js) are present.
 * - electrode-position files and inverse solutions are split out first and routed separately,
 *   they are not required for the EegViewer to load, and can be loaded later, after EegViewer initalisation as well.
 *
 * Inverse solutions are handed off to onInverseSolutionFile (owned by useEsiMontage) rather than parsed here.
 * Custom electrode positions are owned here rather than in EegViewer, since they can be
 * dropped at the initial EEG dropzone before EegViewer even exists, and need to stay in
 * sync across the several places that can supply/replace them (this dropzone,
 * EegViewer's own persistent dropzone, and the topography popup's "use custom
 * positions" button) — all three call handleElecPosFile.
 *
 * @param {Object} params
 * @param {(eeg: object) => void} params.setEeg
 *   Called with the fully loaded EEG recording once a complete set of files for a known
 *   format (e.g. BrainVision's .vhdr + .eeg) has been detected and parsed. This is the
 *   same setter PatientView uses for its own `eeg` state — this hook doesn't keep its
 *   own copy of the recording, it just reports the result upward.
 * @param {(loading: boolean) => void} params.setIsLoading
 *   Called with `true` while an EEG recording is being parsed, and `false` once that
 *   finishes (whether it succeeded or failed), so the caller can show a loading state.
 * @param {(file: File) => Promise<void>} params.onInverseSolutionFile
 *   Called with an inverse-solution (.mat) file whenever one is dropped here. Owned by
 *   useEsiMontage — this hook only detects that such a file was dropped and hands it
 *   off; it doesn't parse inverse-solution files itself.
 * @returns {Object} The current intake state, plus the functions needed to drive it:
 *   - `pendingEegFiles` (File[]) — files collected so far that don't yet complete a
 *     recognized EEG format; shown to the user as a checklist while more are awaited.
 *   - `eegHint` (string|null) — a message explaining what's still missing or mismatched
 *     about the pending files, or `null` if there's nothing to report.
 *   - `customElectrodes` (Array<{label, x, y, z}>) — the currently active custom
 *     electrode positions, or an empty array if none have been loaded.
 *   - `customElecPosFileName` (string|null) — the filename (without extension) of the
 *     electrode-position file that produced `customElectrodes`, or `null` if none.
 *   - `handleElecPosFile` (file: File) => Promise<void> — parses a single
 *     electrode-position file and, if valid, makes it the active custom electrode set.
 *   - `handleEegFiles` (newFiles: FileList|File[]) => Promise<void> — the main entry
 *     point: routes one drop/selection's worth of files (EEG recording files, electrode
 *     positions, inverse solutions, or any mix) to the right handling logic.
 *   - `resetIntake` () => void — clears all state owned by this hook (pending files,
 *     hint, custom electrodes) back to its initial empty state.
 */
export function useEegFileIntake({ setEeg, setIsLoading, onInverseSolutionFile }) {
  const [pendingEegFiles, setPendingEegFiles] = useState([]);
  const [eegHint, setEegHint] = useState(null);
  const [customElectrodes, setCustomElectrodes] = useState([]); // [{label,x,y,z}]
  const [customElecPosFileName, setCustomElecPosFileName] = useState(null);

  /**
   * Parses one electrode-position file and, if it contains any usable positions, makes it
   * the active custom electrode set (replacing whatever was active before, if anything).
   * Shows a toast confirming success or reporting a parse error — this is the only
   * feedback the compact dropzone gives, so silently ignoring a bad file isn't an option.
   *
   * @param {File} file - the dropped/selected .elc or .tsv electrode-position file.
   * @returns {Promise<void>} Resolves once parsing finishes and state/toast have been
   *   updated. Doesn't return a value — callers read the result back via this hook's
   *   `customElectrodes`/`customElecPosFileName` return values, not via this promise.
   */
  const handleElecPosFile = useCallback(async (file) => {
    try {
      const { electrodes } = await parseElectrodePositionFile(file);
      if (!electrodes.length) return; // ignore empty or unparseable files
      setCustomElectrodes(electrodes);
      setCustomElecPosFileName(file.name.replace(/\.[^.]+$/, ''));
      // Confirm the load — this dropzone shows no state of its own in compact mode, so
      // without this the file appears to vanish and the user can't tell it was accepted.
      toast.success(`Loaded ${electrodes.length} electrode positions from ${file.name}`);
    } catch (err) {
      toast.error(err.message);
    }
  }, []);

  /**
   * Processes a batch of files dropped/selected at the EEG dropzone. Electrode-position
   * and inverse-solution files are split out and routed to their own handlers first;
   * anything left is checked against known EEG recording formats. If the accumulated
   * files (this batch plus whatever was already pending from an earlier drop) complete
   * a format, the recording is parsed and loaded; if only part of a format is present,
   * the files are held as "pending" so a later drop can complete them; unrecognized
   * files are rejected with a toast.
   *
   * @param {FileList|File[]} newFiles - the files from this single drop/selection. Not
   *   the full accumulated set — that's tracked internally via `pendingEegFiles`.
   * @returns {Promise<void>} Resolves once this batch has been fully routed/processed.
   *   Has no return value of its own — the outcome is observed through this hook's
   *   `eeg` (via `setEeg`), `pendingEegFiles`, and `eegHint` return values, plus toasts
   *   for user-facing feedback.
   */
  const handleEegFiles = useCallback(
    async (newFiles) => {
      const allFiles = Array.from(newFiles);
      // Detect and handle electrode position files
      const elecPosFiles = allFiles.filter((f) =>
        ELEC_POS_EXTENSIONS.some((ext) => f.name.toLowerCase().endsWith(ext))
      );
      if (elecPosFiles.length > 0) {
        await handleElecPosFile(elecPosFiles[elecPosFiles.length - 1]); // keep only the last if multiple were dropped at once
        if (elecPosFiles.length > 1) {
          toast('Multiple electrode position files loaded => using the latest.', {
            icon: '⚠️',
          });
        }
      }
      // Detect and handle inverse filter files
      const invFiltFiles = allFiles.filter((f) =>
        INV_SOLUTIONS_EXTENSIONS.some((ext) => f.name.toLowerCase().endsWith(ext))
      );
      if (invFiltFiles.length > 0) {
        await onInverseSolutionFile(invFiltFiles[invFiltFiles.length - 1]); // keep only the last if multiple were dropped at once
        if (invFiltFiles.length > 1) {
          toast('Multiple inverse solution files loaded => using the latest.', {
            icon: '⚠️',
          });
        }
      }

      // Exclude electrode position and inverse filter files from EEG format detection — they are handled separately above. The remaining files are checked for EEG formats.
      const remainingFiles = allFiles.filter(
        (f) => !elecPosFiles.includes(f) && !invFiltFiles.includes(f)
      );
      // Anything left whose extension doesn't belong to a supported EEG format (e.g. an
      // imaging volume meant for the Neuroimaging panel) is rejected outright
      const eegFiles = remainingFiles.filter((f) =>
        EEG_FORMAT_EXTENSIONS.some((ext) => f.name.toLowerCase().endsWith(ext))
      );
      const unsupportedFiles = remainingFiles.filter((f) => !eegFiles.includes(f));
      if (unsupportedFiles.length > 0) {
        toast.error(
          `Unsupported file${unsupportedFiles.length > 1 ? 's' : ''}: ${unsupportedFiles
            .map((f) => f.name)
            .join(', ')}\nDrop imaging files in the Neuroimaging panel instead.`
        );
      }

      if (eegFiles.length === 0) return; // pure electrode-position/inv-filter/unsupported drop — nothing else to do

      // Merge pending with new files
      const merged = [...pendingEegFiles, ...eegFiles];
      // Then keep only the last file for each extension by createing a map of extension to file.
      // This way, if a user drops a new .vhdr file, it will replace the previous .vhdr in the pending state, while still keeping any .eeg file that was dropped before.
      const byExtension = new Map();
      for (const file of merged) {
        const ext = file.name.toLowerCase().match(/(\.[^.]+)$/)?.[1];
        // for each file with a recognized extension, store it in the Map keyed by that extension.
        // If a .vhdr was already in the map and another .vhdr comes along, .set() overwrites the old entry
        if (ext) byExtension.set(ext, file);
      }
      // Pull File objects back out of the map
      const deduped = [...byExtension.values()];
      // Check the accumulated files against known EEG formats to determine if we can load or if we need to wait for more files.
      const { formatName, complete, missing, warning } = checkEegFiles(deduped);

      if (complete) {
        // All required files present — clear pending state and load.
        // EegViewer shows its own loading/success toast once mounted, so this just
        // detects the format and surfaces errors.
        setPendingEegFiles([]);
        setEegHint(null);
        setIsLoading(true);
        try {
          const parsed = await detectAndLoadEEG(deduped);
          // Reject outright rather than accept and silently mishandle — channelSettings,
          // ESI's channel matching, etc. all assume every channel name is unique.
          const duplicateChannelNames = findDuplicateChannelNames(parsed.channelNames);
          if (duplicateChannelNames.length > 0) {
            throw new Error(
              `Duplicate channel name(s): ${duplicateChannelNames.join(', ')}. Each channel must have a unique name.`
            );
          }
          setEeg(parsed);
        } catch (err) {
          toast.error(`Error loading EEG:\n${err.message}`);
        } finally {
          setIsLoading(false);
        }
      } else if (formatName) {
        // Partial match or name mismatch — hold files and show what's wrong
        setPendingEegFiles(deduped);
        setEegHint(warning ?? `${formatName} also requires: ${missing.join(', ')}`);
      } else {
        // No recognized format at all
        setPendingEegFiles([]);
        setEegHint(null);
        toast.error(`Unrecognized EEG format.\nSupported: BrainVision (.vhdr + .eeg)`);
      }
    },
    [pendingEegFiles, handleElecPosFile, onInverseSolutionFile, setEeg, setIsLoading]
  );

  /**
   * Clears the pending-file queue, the hint, and the custom electrode positions —
   * returning this hook's state to what it was before any files were dropped. Does not
   * touch the loaded `eeg` recording itself: that state is owned by the caller
   * (PatientView), since it's shared with useEsiMontage, so the caller is responsible
   * for clearing it (via its own `setEeg(null)`) alongside calling this.
   *
   * @returns {void} No return value — this only produces the state reset as a side effect.
   */
  const resetIntake = useCallback(() => {
    setPendingEegFiles([]);
    setEegHint(null);
    setCustomElectrodes([]);
    setCustomElecPosFileName(null);
  }, []);

  return {
    pendingEegFiles,
    eegHint,
    customElectrodes,
    customElecPosFileName,
    handleElecPosFile,
    handleEegFiles,
    resetIntake,
  };
}
