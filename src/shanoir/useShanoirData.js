// Where this hook sits in the flow from Shanoir's button to the viewers, and what the other
// files in src/shanoir/ do: see src/shanoir/README.md.

import { createElement, useCallback } from 'react';
import { useLaunchData } from '@/hooks/useLaunchData';
import { fetchShanoirExamination } from '@/shanoir/fetchShanoirExamination';
import { ShanoirSkippedWarning } from '@/shanoir/ShanoirSkippedWarning';

/**
 * Loads one Shanoir examination (EEG recording, electrode positions, inverse solution, montage
 * and imaging volumes) into the viewers when VIDEPE is launched from Shanoir. The downloaded
 * files go through the same handlers a manual file drop would use, so Shanoir data
 * exercises exactly the same downstream logic (EegViewer, ESI, etc.) as local files.
 *
 * Fetching the examination is Shanoir-specific (fetchShanoirExamination); handing the files
 * to the viewers, the toasts and cancelling are shared with the host-app mode (useLaunchData).
 *
 * @param {Object} params
 * @param {(files: File[]) => Promise<boolean>} params.handleEegFiles
 *   The EEG intake handler from useEegFileIntake. Called once with the recording files,
 *   electrode positions, inverse solution and montage, which it routes and parses exactly like a
 *   drop at the EEG dropzone (it sets the EEG recording itself).
 * @param {(layers: object[]) => void} params.setLayers
 *   Called with the imaging layers built from the downloaded volumes/meshes.
 * @param {(name: string|null) => void} params.setShanoirEegName
 *   Called with the name of the EEG dataset that was loaded, or null if none. An examination
 *   can hold several EEG recordings but only the latest imported is loaded, so the caller can show the
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
      const { eegDataset, eegFiles, imagingFiles, skippedDatasets, skippedFiles } =
        await fetchShanoirExamination({ client, examinationId, signal });

      // Toast message for the datasets and the files (electrode positions, inverse solutions,
      // montages) that have been skipped, as markup (see ShanoirSkippedWarning). This file
      // isn't .jsx, so the element is made with createElement instead of <ShanoirSkippedWarning />
      const warning =
        skippedDatasets.length > 0 || skippedFiles.length > 0
          ? createElement(ShanoirSkippedWarning, { skippedDatasets, skippedFiles })
          : null;

      // The name shown in the EEG panel header, with the Shanoir type: an EEG-tab recording and
      // a BIDS one can have near-identical names
      const eegName = eegDataset ? `${eegDataset.name} (${eegDataset.type})` : null;

      return { eegFiles, imagingFiles, eegName, warning };
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
