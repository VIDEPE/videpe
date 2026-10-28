import { useState, useCallback } from 'react';
import { useLaunchData } from '@/hooks/useLaunchData';
import { fetchHostAppFiles } from '@/hostApp/fetchHostAppFiles';

/**
 * Loads the files of one host-app launch (EEG recording, electrode positions, inverse solution
 * and imaging volumes) into the viewers when VIDEPE is launched from a host app, such as a
 * local Python app. The downloaded files go through the same handlers a manual file drop
 * would use, so the host app's data exercises exactly the same downstream logic (EegViewer,
 * ESI, etc.) as local files.
 *
 * Fetching the launch's files is host-app-specific (fetchHostAppFiles); handing the files to
 * the viewers, the toasts and cancelling are shared with the Shanoir mode (useLaunchData).
 *
 * @param {Object} params
 * @param {ReturnType<import('./hostAppClient').createHostAppClient>} [params.client]
 *   The host-app client for this launch; undefined when not launched from a host app, in
 *   which case this hook does nothing.
 * @param {string} params.appName - the host app's name (from getHostAppConfig), for the toasts.
 * @param {(files: File[]) => Promise<boolean>} params.handleEegFiles
 *   The EEG intake handler from useEegFileIntake (see useLaunchData).
 * @param {(layers: object[]) => void} params.setLayers
 *   Called with the imaging layers built from the downloaded volumes/meshes.
 * @param {(name: string|null) => void} params.setEegName
 *   Called with the name of the EEG recording file that was loaded (e.g. 'rest.edf'), or null
 *   if none, so the caller can show the user which one is on screen.
 * @param {{ current: (() => void)|null }} params.eegReadyResolveRef
 *   Ref that the load assigns a resolver function into; EegViewer calls it once its charts
 *   have finished rendering the data (see useLaunchData).
 * @param {{ current: (() => void)|null }} params.niiReadyResolveRef
 *   Same pattern as eegReadyResolveRef, but for NiiViewer finishing to render the
 *   imaging volumes.
 * @returns {Object} The loading state and the launch's title. The load itself starts
 *   automatically once, when a client is given, and is cancelled when the component unmounts.
 *   - `isHostAppLoading` (boolean) — true from the first render of a host-app launch until
 *     the files have loaded (or failed).
 *   - `title` (string|null) — what the host app calls this launch (e.g. a patient code), for
 *     the header next to the app's name; null until loaded, or when the host app sends none.
 */
export function useHostAppData({
  client,
  appName,
  handleEegFiles,
  setLayers,
  setEegName,
  eegReadyResolveRef,
  niiReadyResolveRef,
}) {
  // The launch's title, only known once the session has been fetched
  const [title, setTitle] = useState(null);

  // Downloads the launch's files (see fetchHostAppFiles), in the form useLaunchData expects.
  // Wrapped in useCallback so it only changes with another client/app: a new fetchData
  // starts a new load.
  const fetchData = useCallback(
    async (signal) => {
      const { title, eegFiles, imagingFiles, skippedFiles, eegName } = await fetchHostAppFiles({
        client,
        signal,
      });
      setTitle(title);

      // Toast text: the files that have been skipped, one bulleted line per file
      // (react-hot-toast keeps the line breaks), or a note when there was nothing at all
      let warning = null;
      if (skippedFiles.length > 0) {
        warning = `Skipped the following files (VIDEPE can't open them):\n${skippedFiles
          .map((name) => `- ${name}`)
          .join('\n')}`;
      } else if (eegFiles.length === 0 && imagingFiles.length === 0) {
        warning = `${appName} sent no files VIDEPE can open.`;
      }

      return { eegFiles, imagingFiles, eegName, warning };
    },
    [client, appName]
  );

  const { isLoading } = useLaunchData({
    enabled: Boolean(client), // undefined client: not launched from a host app
    sourceName: appName,
    fetchData,
    handleEegFiles,
    setLayers,
    setEegName,
    eegReadyResolveRef,
    niiReadyResolveRef,
  });

  return { isHostAppLoading: isLoading, title };
}
