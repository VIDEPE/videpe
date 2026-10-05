// New src/hooks/useShanoirLaunch.js: modelled on src/hooks/useDemoData.js (same setIsLoading, the eegReadyResolveRef/niiReadyResolveRef ready promises, one toast.promise).
// For EEG datasets: unzip, then handleEegFiles(files) from src/hooks/useEegFileIntake.js. It already routes .vhdr/.eeg, electrode .tsv/.elc and inverse .mat in one call, using detectAndLoadEEG in src/loaders/eegFormatRegistry.js. loadBrainVisionEEG already reads Files with File.slice.
// Filter .tsv before handing files over. BIDS folders also contain _channels.tsv / _events.tsv, and useEegFileIntake routes every .tsv to the electrode parser (ELEC_POS_EXTENSIONS). Pass only *_electrodes.tsv and .elc, and ignore other .tsv files. .mat goes through unchanged (inverse solution).
// Examination extra-data: read extraDataFilePathList from GET /shanoir-ng/datasets/examinations/{examinationId}. Download *_electrodes.tsv, .elc and .mat entries via GET /shanoir-ng/datasets/examinations/extra-data-download/{examinationId}/{fileName}/ and pass them to handleEegFiles the same way (see "Electrode positions" below).
// For imaging datasets (Mr, Pet, …): download with format=nii, unzip, then filesToLayers(files) from src/utils/NiiViewer.utils.js (it handles NIfTI and in-browser DICOM), then setLayers.
// Ignore other types with a toast note.

import { useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import { filesToLayers } from '@/utils/NiiViewer.utils';
import { fetchShanoirExamination } from '@/loaders/fetchShanoirExamination';

/**
 * Loads one Shanoir examination (EEG recording, electrode positions, inverse solution and
 * imaging volumes) into the viewers when VIDEPE is launched from Shanoir. The downloaded
 * files go through the same handlers a manual file drop would use, so Shanoir data
 * exercises exactly the same downstream logic (EegViewer, ESI, etc.) as local files.
 *
 * @param {Object} params
 * @param {(files: File[]) => Promise<void>} params.handleEegFiles
 *   The EEG intake handler from useEegFileIntake. Called once with the recording files,
 *   electrode positions and inverse solution, which it routes and parses exactly like a
 *   drop at the EEG dropzone (it sets the EEG recording itself).
 * @param {(layers: object[]) => void} params.setLayers
 *   Called with the imaging layers built from the downloaded volumes/meshes.
 * @param {(loading: boolean) => void} params.setIsLoading
 *   Called with `true` for the duration of the whole load, and `false` once it finishes
 *   (whether it succeeded or failed) — the same flag real file loads use.
 * @param {{ current: (() => void)|null }} params.eegReadyResolveRef
 *   Ref that this hook assigns a resolver function into before starting the load.
 *   EegViewer calls that resolver once its charts have actually finished rendering the
 *   data, so this hook can tell the difference between "data was set" and "the viewer is
 *   ready to be shown."
 * @param {{ current: (() => void)|null }} params.niiReadyResolveRef
 *   Same pattern as eegReadyResolveRef, but for NiiViewer finishing to render the
 *   imaging volumes.
 * @param {ReturnType<import('@/loaders/shanoirClient').createShanoirClient>} params.client
 *   Shanoir API client for the signed-in user.
 * @param {number} params.examinationId - the Shanoir examination to load (from the launch URL).
 * @param {AbortSignal} [params.signal] - cancels all Shanoir requests (from an AbortController).
 * @returns {Object} The loading state, the loaded recording's name, and the trigger function:
 *   - `isShanoirLoading` (boolean) — true for the duration of the Shanoir load.
 *   - `handleLoadShanoir` () => Promise<void> — fetches and loads the examination,
 *     resolving once the viewers that received data report they've finished rendering it.
 *   - `loadedEegName` (string|null) — name of the EEG dataset that was loaded, or null if
 *     none. An examination can hold several EEG recordings but only the first is loaded, so
 *     this tells the user which one is on screen.
 */
export function useShanoirLaunch({
  handleEegFiles,
  setLayers,
  setIsLoading,
  loadedEegName,
  eegReadyResolveRef,
  niiReadyResolveRef,
  client,
  examinationId,
  signal,
}) {
  const [isShanoirLoading, setIsShanoirLoading] = useState(false);

  /**
   * Downloads the examination's datasets (see fetchShanoirExamination), reports any datasets
   * that were skipped, then hands the EEG files to handleEegFiles and the imaging files to
   * setLayers — the same handlers a manual file drop would use. Wrapped in `toast.promise`
   * so the user sees a single loading → success/error toast for the whole sequence, rather
   * than one per file.
   *
   * @returns {Promise<void>} Resolves once the viewers that received data (EegViewer and/or
   *   NiiViewer) report, via eegReadyResolveRef/niiReadyResolveRef, that they've finished
   *   rendering it. Doesn't return a value — callers observe the outcome through this
   *   hook's `isShanoirLoading` and `loadedEegName` return values, and the `eeg`/`layers`
   *   state the handlers update.
   */
  const handleLoadShanoir = useCallback(async () => {
    setIsLoading(true);
    setIsShanoirLoading(true);
    // Create ready promises before setting state — the viewers resolve them once fully rendered
    const eegReady = new Promise((resolve) => {
      eegReadyResolveRef.current = resolve;
    });
    const niiReady = new Promise((resolve) => {
      niiReadyResolveRef.current = resolve;
    });
    try {
      await toast.promise(
        (async () => {
          // fetch shanoir examination
          const { loadedEegName, eegFiles, imagingFiles, skippedDatasets } =
            await fetchShanoirExamination({
              client,
              examinationId,
              signal,
            });

          // Display toast of datasets that have been skipped
          if (skippedDatasets.length > 0) {
            toast(
              `Skipped the following datasets: ${skippedDatasets
                .map((d) => `${d.name} (${d.reason})`)
                .join(', ')}`,
              {
                icon: '⚠️',
              }
            );
          }

          // forward eegFiles to the handles that wire the files like a normal load would
          if (eegFiles.length > 0) {
            await handleEegFiles(eegFiles);
            await eegReady;
          }
          if (imagingFiles.length > 0) {
            setLayers(await filesToLayers(imagingFiles));
            await niiReady;
          }
        })(),
        {
          loading: 'Loading Shanoir data…',
          success: 'Shanoir data loaded!',
          error: (err) => `Error loading Shanoir data:\n${err.message}`,
        }
      );
    } finally {
      setIsLoading(false);
      setIsShanoirLoading(false);
    }
  }, [
    handleEegFiles,
    setLayers,
    setIsLoading,
    eegReadyResolveRef,
    niiReadyResolveRef,
    client,
    examinationId,
    signal,
  ]);

  return { isShanoirLoading, handleLoadShanoir, loadedEegName };
}
