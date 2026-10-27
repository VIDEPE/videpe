// New src/shanoir/useShanoirData.js: modelled on src/hooks/useDemoData.js (same setIsLoading, the eegReadyResolveRef/niiReadyResolveRef ready promises, one toast.promise).
// That generic part now lives in src/hooks/useLaunchData.js, shared with the host-app mode; this hook only adds what's specific to Shanoir.
// For EEG datasets: unzip, then handleEegFiles(files) from src/hooks/useEegFileIntake.js. It already routes .vhdr/.eeg, electrode .tsv/.elc and inverse .mat in one call, using detectAndLoadEEG in src/loaders/eegFormatRegistry.js. loadEegBrainVision already reads Files with File.slice.
// Filter .tsv before handing files over. BIDS folders also contain _channels.tsv / _events.tsv, and useEegFileIntake routes every .tsv to the electrode parser (ELEC_POS_EXTENSIONS). Pass only *_electrodes.tsv and .elc, and ignore other .tsv files. .mat goes through unchanged (inverse solution).
// Examination extra-data: read extraDataFilePathList from GET /shanoir-ng/datasets/examinations/{examinationId}. Download *_electrodes.tsv, .elc and .mat entries via GET /shanoir-ng/datasets/examinations/extra-data-download/{examinationId}/{fileName}/ and pass them to handleEegFiles the same way (see "Electrode positions" below).
// For imaging datasets (Mr, Pet, …): download with format=nii, unzip, then filesToLayers(files) from src/utils/NiiViewer.utils.js (it handles NIfTI and in-browser DICOM), then setLayers.
// Ignore other types with a toast note.

import { useCallback } from 'react';
import { useLaunchData } from '@/hooks/useLaunchData';
import { fetchShanoirExamination } from '@/shanoir/fetchShanoirExamination';

/**
 * Loads one Shanoir examination (EEG recording, electrode positions, inverse solution and
 * imaging volumes) into the viewers when VIDEPE is launched from Shanoir. The downloaded
 * files go through the same handlers a manual file drop would use, so Shanoir data
 * exercises exactly the same downstream logic (EegViewer, ESI, etc.) as local files.
 *
 * Fetching the examination is Shanoir-specific (fetchShanoirExamination); handing the files
 * to the viewers, the toasts and cancelling are shared with the host-app mode (useLaunchData).
 *
 * @param {Object} params
 * @param {(files: File[]) => Promise<boolean>} params.handleEegFiles
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
 *   Ref that the load assigns a resolver function into; EegViewer calls it once its charts
 *   have finished rendering the data (see useLaunchData).
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
  // Downloads the examination's datasets (see fetchShanoirExamination), in the form
  // useLaunchData expects. Wrapped in useCallback so it only changes with another
  // client/examination: a new fetchData starts a new load.
  const fetchData = useCallback(
    async (signal) => {
      // fetch shanoir examination
      const { eegDataset, eegFiles, imagingFiles, skippedDatasets } = await fetchShanoirExamination(
        { client, examinationId, signal }
      );

      // Toast text for the datasets that have been skipped, one bulleted line per dataset
      // (react-hot-toast keeps the line breaks)
      const warning =
        skippedDatasets.length > 0
          ? `Skipped the following datasets:\n${skippedDatasets
              .map((d) => `- ${d.name} (${d.reason})`)
              .join('\n')}`
          : null;

      return { eegFiles, imagingFiles, eegName: eegDataset?.name ?? null, warning };
    },
    [client, examinationId]
  );

  const { isLoading } = useLaunchData({
    enabled: Boolean(client), // undefined client: not launched from Shanoir
    sourceName: 'Shanoir',
    fetchData,
    handleEegFiles,
    setLayers,
    setEegName: setShanoirEegName,
    eegReadyResolveRef,
    niiReadyResolveRef,
  });

  return { isShanoirLoading: isLoading };
}
