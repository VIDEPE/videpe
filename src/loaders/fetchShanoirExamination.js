import { unzipToFiles } from './unzipToFiles';
import {
  classifyDataset,
  selectEegIntakeFiles,
  selectImagingFiles,
  selectExtraDataFileNames,
} from './shanoirFiles';

// Helper function to get readable name for a Shanoir dataset => used for user-facing messages.
const datasetLabel = (dataset) => ({
  id: dataset.id,
  name: dataset.name ?? `dataset ${dataset.id}`,
  type: dataset.type,
});

/**
 * Downloads everything VIDEPE shows for one Shanoir examination, and sorts it into the
 * files for the EEG viewer and the files for the neuroimaging viewer.
 *
 * Datasets are routed by their Shanoir type (DatasetDTO.type), known before downloading —
 * each dataset is one zip, and its files simply follow the dataset's route:
 * - EEG: only the first EEG dataset is loaded. The EEG intake keeps one file per extension,
 *   so combining two recordings could pair one run's .vhdr with another run's .eeg.
 *   Electrode positions and inverse solutions attached to the examination (extra-data)
 *   are added to the EEG files.
 * - Imaging (MR, PET, …): every dataset is loaded; each becomes one or more layers.
 * - Anything else is not downloaded, and is reported back in `skippedDatasets`.
 *
 * Downloads run in parallel. Nothing is handed to the viewers here — the caller does that
 * once, with the complete sets (see useShanoirLaunch).
 *
 * @param {Object} params
 * @param {ReturnType<import('./shanoirClient').createShanoirClient>} params.client
 * @param {number} params.examinationId
 * @param {AbortSignal} [params.signal] - cancels all requests.
 * @returns {Promise<{
 *   eegDataset: { id: number, name: string, type: string }|null,
 *   eegFiles: File[],
 *   imagingFiles: File[],
 *   skippedDatasets: { id: number, name: string, type: string, reason: string }[],
 * }>} the sorted files:
 *   - `eegDataset`: the EEG dataset that was loaded, or null if the examination has none.
 *   - `eegFiles`: files for useEegFileIntake's handleEegFiles (recording, electrode
 *     positions, inverse solutions).
 *   - `imagingFiles`: files for filesToLayers (NIfTI/MGH volumes, GIFTI meshes).
 *   - `skippedDatasets`: datasets not loaded, with the reason, so the caller can tell the user.
 * @throws {Error} when any request or unzip fails.
 */
export async function fetchShanoirExamination({ client, examinationId, signal }) {
  const [datasets, examination] = await Promise.all([
    client.listExaminationDatasets(examinationId, signal),
    client.getExamination(examinationId, signal),
  ]);

  // Route every dataset by type before downloading anything
  const imagingDatasets = datasets.filter((dataset) => classifyDataset(dataset) === 'imaging');
  const otherDatasets = datasets.filter((dataset) => classifyDataset(dataset) === null);
  const eegDatasets = datasets.filter((dataset) => classifyDataset(dataset) === 'eeg');
  // only keep the first eeg dataset the examination contains e.g. multiple runs
  // group others under additionalEegDatasets
  const eegDataset = eegDatasets[0];
  const additionalEegDatasets = eegDatasets.slice(1);

  // both additionalEegDatasets and otherDatasets are skipped, but logged in the skippedDatasets
  // so the user knows what is and isn't displayed
  const skippedDatasets = additionalEegDatasets.map((dataset) => ({
    id: dataset.id,
    name: dataset.name ?? `dataset ${dataset.id}`,
    type: dataset.type,
    reason: 'additional EEG recording',
  }));
  skippedDatasets.push(
    ...otherDatasets.map((dataset) => ({
      id: dataset.id,
      name: dataset.name ?? `dataset ${dataset.id}`,
      type: dataset.type,
      reason: 'unsupported type',
    }))
  );

  // Extra-data (electrode positions, inverse solutions) only matters alongside a recording
  // Note these are names (not file!), but since these are not zipped these can be checked if
  // they can be used before downloading, unlike the zip files
  const extraDataNames = eegDataset
    ? selectExtraDataFileNames(examination?.extraDataFilePathList)
    : [];

  // Helper function to download a dataset's zip and return its files.
  const downloadAndUnzipFiles = async (dataset) =>
    unzipToFiles(await client.downloadDatasetZip(dataset.id, signal));

  // Now download zip and unzip the files
  // All three downloads are started together, then awaited as one
  const [eegDatasetFiles, imagingDatasetFiles, extraDataFiles] = await Promise.all([
    eegDataset ? downloadAndUnzipFiles(eegDataset) : [],
    Promise.all(imagingDatasets.map((dataset) => downloadAndUnzipFiles(dataset))),
    Promise.all(extraDataNames.map((name) => client.downloadExtraData(examinationId, name, signal))),
  ]);

  // bundle eegFiles and imagingFiles
  const eegFiles = [...selectEegIntakeFiles(eegDatasetFiles), ...extraDataFiles];
  const imagingFiles = selectImagingFiles(imagingDatasetFiles.flat()); // flat is needed to get single array instead of array of arrays

  return {
    eegDataset: eegDataset ? datasetLabel(eegDataset) : null,
    eegFiles: eegFiles,
    imagingFiles: imagingFiles,
    skippedDatasets,
  };
}
