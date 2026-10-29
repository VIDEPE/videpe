import { isEegRecordingFile, sortFilesByViewer } from '@/utils/launchFiles';

/**
 * Downloads everything VIDEPE shows for one host-app launch, sorted into the files for the EEG
 * viewer and the files for the neuroimaging viewer — the host-app counterpart of
 * fetchShanoirExamination.
 *
 * The session's files are sorted by name before downloading, so files neither viewer opens
 * (e.g. a PDF, or the BrainVision .vmrk marker file) are never downloaded — they're only
 * reported back in `skippedFiles`. Downloads run in parallel. Nothing is handed to the viewers
 * here — the caller does that once, with the complete sets (see useHostAppData).
 *
 * @param {Object} params
 * @param {ReturnType<import('./hostAppClient').createHostAppClient>} params.client
 * @param {AbortSignal} [params.signal] - cancels all requests.
 * @returns {Promise<{
 *   title: string|null,
 *   eegFiles: File[],
 *   imagingFiles: File[],
 *   skippedFiles: string[],
 *   eegName: string|null,
 * }>} the sorted files:
 *   - `title`: what the host app calls this launch (e.g. a patient code), or null.
 *   - `eegFiles`: files for useEegFileIntake's handleEegFiles (recording, electrode
 *     positions, inverse solutions).
 *   - `imagingFiles`: files for filesToLayers (NIfTI/MGH volumes, GIFTI meshes).
 *   - `skippedFiles`: names of the files not downloaded, so the caller can tell the user.
 *   - `eegName`: the name of the EEG recording file (e.g. 'rest.edf'), for the EEG panel
 *     header, or null if there is none.
 * @throws {Error} when the session or any download fails.
 */
export async function fetchHostAppFiles({ client, signal }) {
  const { title, files } = await client.getSession(signal);

  // Route every file by its name before downloading anything
  const { eegFiles, imagingFiles, skippedFiles } = sortFilesByViewer(files);

  // Helper function to download a group of files, in parallel
  const downloadAll = (entries) =>
    Promise.all(entries.map((entry) => client.downloadFile(entry, signal)));

  // Both groups are started together, then awaited as one
  const [eegDownloads, imagingDownloads] = await Promise.all([
    downloadAll(eegFiles),
    downloadAll(imagingFiles),
  ]);

  return {
    title,
    eegFiles: eegDownloads,
    imagingFiles: imagingDownloads,
    skippedFiles: skippedFiles.map((entry) => entry.name),
    eegName: eegFiles.find((entry) => isEegRecordingFile(entry.name))?.name ?? null,
  };
}
