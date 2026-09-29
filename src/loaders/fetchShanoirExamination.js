import { unzipToFiles } from './unzipToFiles';
import {
  classifyDataset,
  selectEegIntakeFiles,
  selectImagingFiles,
  selectExtraDataFileNames,
} from './shanoirFiles';

// Readable name for a Shanoir dataset in user-facing messages.
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
  const eegDatasets = datasets.filter((d) => classifyDataset(d) === 'eeg');
  const imagingDatasets = datasets.filter((d) => classifyDataset(d) === 'imaging');
  const [eegDataset, ...additionalEegDatasets] = eegDatasets;
  const skippedDatasets = [
    ...additionalEegDatasets.map((d) => ({
      ...datasetLabel(d),
      reason: 'additional EEG recording',
    })),
    ...datasets
      .filter((d) => classifyDataset(d) === null)
      .map((d) => ({ ...datasetLabel(d), reason: 'unsupported type' })),
  ];

  // Downloads a dataset's zip and returns its files
  const downloadFiles = async (dataset) =>
    unzipToFiles(await client.downloadDatasetZip(dataset.id, signal));

  // Extra-data (electrode positions, inverse solutions) only matters alongside a recording
  const extraDataNames = eegDataset
    ? selectExtraDataFileNames(examination?.extraDataFilePathList)
    : [];

  const [eegDatasetFiles, extraDataFiles, imagingFilesPerDataset] = await Promise.all([
    eegDataset ? downloadFiles(eegDataset) : [],
    Promise.all(
      extraDataNames.map((name) => client.downloadExtraData(examinationId, name, signal))
    ),
    Promise.all(imagingDatasets.map(downloadFiles)),
  ]);

  return {
    eegDataset: eegDataset ? datasetLabel(eegDataset) : null,
    eegFiles: [...selectEegIntakeFiles(eegDatasetFiles), ...extraDataFiles],
    imagingFiles: selectImagingFiles(imagingFilesPerDataset.flat()),
    skippedDatasets,
  };
}
