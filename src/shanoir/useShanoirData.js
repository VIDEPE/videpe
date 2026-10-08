// New src/shanoir/useShanoirData.js: modelled on src/hooks/useDemoData.js (same setIsLoading, the eegReadyResolveRef/niiReadyResolveRef ready promises, one toast.promise).
// For EEG datasets: unzip, then handleEegFiles(files) from src/hooks/useEegFileIntake.js. It already routes .vhdr/.eeg, electrode .tsv/.elc and inverse .mat in one call, using detectAndLoadEEG in src/loaders/eegFormatRegistry.js. loadBrainVisionEEG already reads Files with File.slice.
// Filter .tsv before handing files over. BIDS folders also contain _channels.tsv / _events.tsv, and useEegFileIntake routes every .tsv to the electrode parser (ELEC_POS_EXTENSIONS). Pass only *_electrodes.tsv and .elc, and ignore other .tsv files. .mat goes through unchanged (inverse solution).
// Examination extra-data: read extraDataFilePathList from GET /shanoir-ng/datasets/examinations/{examinationId}. Download *_electrodes.tsv, .elc and .mat entries via GET /shanoir-ng/datasets/examinations/extra-data-download/{examinationId}/{fileName}/ and pass them to handleEegFiles the same way (see "Electrode positions" below).
// For imaging datasets (Mr, Pet, …): download with format=nii, unzip, then filesToLayers(files) from src/utils/NiiViewer.utils.js (it handles NIfTI and in-browser DICOM), then setLayers.
// Ignore other types with a toast note.

import { useState, useCallback, useEffect, useEffectEvent } from 'react';
import toast from 'react-hot-toast';
import { filesToLayers } from '@/utils/NiiViewer.utils';
import { fetchShanoirExamination } from '@/shanoir/fetchShanoirExamination';

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
 * @param {(name: string|null) => void} params.setShanoirEegName
 *   Called with the name of the EEG dataset that was loaded, or null if none. An examination
 *   can hold several EEG recordings but only the first is loaded, so the caller can show the
 *   user which one is on screen (and clear it when the EEG viewer is reset).
 * @param {{ current: (() => void)|null }} params.eegReadyResolveRef
 *   Ref that this hook assigns a resolver function into before starting the load.
 *   EegViewer calls that resolver once its charts have actually finished rendering the
 *   data, so this hook can tell the difference between "data was set" and "the viewer is
 *   ready to be shown."
 * @param {{ current: (() => void)|null }} params.niiReadyResolveRef
 *   Same pattern as eegReadyResolveRef, but for NiiViewer finishing to render the
 *   imaging volumes.
 * @param {ReturnType<import('@/shanoir/shanoirClient').createShanoirClient>} [params.client]
 *   Shanoir API client for the signed-in user; undefined when not launched from Shanoir, in
 *   which case this hook does nothing.
 * @param {number} [params.examinationId] - the Shanoir examination to load (from the launch URL).
 * @returns {Object} The loading state. The load itself starts automatically once, when a client
 *   is given, and is cancelled when the component unmounts.
 *   - `isShanoirLoading` (boolean) — true from the first render of a Shanoir launch until the
 *     examination has loaded (or failed).
 */
export function useShanoirData({
  handleEegFiles,
  setLayers,
  setShanoirEegName,
  eegReadyResolveRef,
  niiReadyResolveRef,
  client,
  examinationId,
}) {
  // Starts as true when launched from Shanoir: the page is loading from its very first render.
  // (Switching it on from inside the effect instead would trigger an extra render — React's
  // set-state-in-effect rule.) Only switched off once the load has finished or failed.
  const [isShanoirLoading, setIsShanoirLoading] = useState(Boolean(client));

  /**
   * Downloads the examination's datasets (see fetchShanoirExamination), reports any datasets
   * that were skipped, then hands the EEG files to handleEegFiles and the imaging files to
   * setLayers — the same handlers a manual file drop would use. Shows a single
   * loading → success/error toast for the whole sequence, rather than one per file.
   *
   * @param {AbortSignal} signal - cancels the load (aborted when the page unmounts).
   * @returns {Promise<void>} Resolves once the viewers that received data (EegViewer and/or
   *   NiiViewer) report, via eegReadyResolveRef/niiReadyResolveRef, that they've finished
   *   rendering it. Never rejects: errors end up in the toast, and a cancelled load just
   *   removes its toast. Callers observe the outcome through this hook's `isShanoirLoading`
   *   return value, and the `eeg`/`layers`/EEG-name state the handlers update.
   */
  const handleLoadShanoir = useCallback(
    async (signal) => {
      const toastId = toast.loading('Loading Shanoir data…');

      // Create ready promises before setting state — the viewers resolve them once fully rendered
      const eegReady = new Promise((resolve) => {
        eegReadyResolveRef.current = resolve;
      });
      const niiReady = new Promise((resolve) => {
        niiReadyResolveRef.current = resolve;
      });

      // try to fetch the data
      try {
        // fetch shanoir examination
        const { eegDataset, eegFiles, imagingFiles, skippedDatasets } =
          await fetchShanoirExamination({ client, examinationId, signal });
        // The download may have finished just as the load was cancelled (unzipping doesn't
        // listen to the signal): stop here, so a cancelled load never fills the viewers.
        // Throws an AbortError, handled like any other cancellation below.
        signal.throwIfAborted();
        setShanoirEegName(eegDataset?.name ?? null);

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
          const isEegSet = await handleEegFiles(eegFiles);
          // only wait for EEG Viewer to finish loading if EEG data is set and the viewer is actually initialising, or else promise never fulfills
          if (isEegSet) await eegReady;
        }
        if (imagingFiles.length > 0) {
          setLayers(await filesToLayers(imagingFiles));
          await niiReady;
        }
        // loaded successfully
        toast.success('Shanoir data loaded!', { id: toastId });
      } catch (err) {
        if (err.name === 'AbortError') {
          // just remove toast (no need to show toast when e.g. using the back button)
          toast.dismiss(toastId);
        } else {
          toast.error(`Error loading Shanoir data:\n${err.message}`, { id: toastId });
        }
      } finally {
        // In development, StrictMode cancels the first run while the real (second) load is still going.
        // This should not disable the loading flag, cause loading is still in progress.
        if (!signal.aborted) setIsShanoirLoading(false);
      }
    },
    [
      handleEegFiles,
      setLayers,
      setShanoirEegName,
      eegReadyResolveRef,
      niiReadyResolveRef,
      client,
      examinationId,
    ]
  );

  // Calls the newest handleLoadShanoir, but never changes itself — so the effect below doesn't
  // need it as a dependency. (handleLoadShanoir changes during the load; as a dependency, every
  // change would abort the download and start it again.)
  const startLoad = useEffectEvent((signal) => handleLoadShanoir(signal));

  // Starts the load once, and cancels it when the page unmounts.
  useEffect(() => {
    if (!client) return; // not launched from Shanoir
    const controller = new AbortController(); // new one per load: once aborted, it stays aborted
    startLoad(controller.signal);
    return () => controller.abort(); // runs later, on unmount — not now
  }, [client, examinationId]);

  return { isShanoirLoading };
}
