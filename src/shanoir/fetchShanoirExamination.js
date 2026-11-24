import { unzipToFiles } from '@/loaders/unzipToFiles';
import {
  selectEegIntakeFiles,
  selectImagingFiles,
  hasEegRecording,
  listFileExtensions,
} from '@/utils/launchFiles';
import {
  classifyDataset,
  extraFileKind,
  pickOneExtraFilePerKind,
  selectExtraDataFileNames,
} from './shanoirFiles';

// Where a file for the recording (electrode positions, inverse solution, montage) was found,
// as named to the user in the "skipped" toast; most specific to the recording first
const SOURCE_DATASET = "the recording's dataset";
const SOURCE_ACQUISITION = "the recording's acquisition";
const SOURCE_EXAMINATION = 'the examination';

// Helper function to get readable name for a Shanoir dataset => used for user-facing messages.
const datasetLabel = (dataset) => ({
  id: dataset.id,
  name: dataset.name ?? `dataset ${dataset.id}`,
  type: dataset.type,
});

/**
 * Finds the processed datasets that belong to an examination: the outputs of every
 * processing that uses one of its datasets as input, then (following chains) the outputs of
 * processings that use those outputs as input, and so on. Processed datasets have no
 * acquisition, so the examination's own dataset list doesn't include them. This is how
 * Shanoir's study tree finds them; `datasets/examination/{id}?output=true` would be the
 * direct route, but it answers 204 for every examination (Shanoir 2.18.1).
 *
 * @param {ReturnType<import('./shanoirClient').createShanoirClient>} client
 * @param {{ id: number }[]} datasets - the examination's own datasets.
 * @param {AbortSignal} [signal]
 * @returns {Promise<object[]>} the processed datasets (DatasetDTOs), each once.
 */
async function listProcessedOutputs(client, datasets, signal) {
  // A processing with several inputs in the examination is found once per input, and a chain
  // can lead back to a dataset already seen: both are only followed once
  const seenProcessingIds = new Set();
  const seenDatasetIds = new Set(datasets.map((dataset) => dataset.id));
  const outputs = [];

  // Breadth-first: each round looks up the processings of the datasets found in the round before
  let inputs = datasets;
  while (inputs.length > 0) {
    const processingLists = await Promise.all(
      inputs.map((dataset) => client.listProcessingsByInputDataset(dataset.id, signal))
    );
    const newProcessings = processingLists.flat().filter((processing) => {
      if (seenProcessingIds.has(processing.id)) return false;
      seenProcessingIds.add(processing.id);
      return true;
    });

    const outputLists = await Promise.all(
      newProcessings.map((processing) => client.listProcessingOutputDatasets(processing.id, signal))
    );
    const newOutputs = outputLists.flat().filter((dataset) => {
      if (seenDatasetIds.has(dataset.id)) return false;
      seenDatasetIds.add(dataset.id);
      return true;
    });

    outputs.push(...newOutputs);
    inputs = newOutputs; // next round: processings made from these outputs
  }
  return outputs;
}

/**
 * Finds the acquisition a dataset belongs to, among the acquisitions with extra data VIDEPE
 * uses (the only ones that matter, so an examination without any costs no extra request).
 * The examination's dataset list doesn't link a dataset to its acquisition, so each of those
 * acquisitions is asked for its datasets.
 *
 * @param {ReturnType<import('./shanoirClient').createShanoirClient>} client
 * @param {object[]} acquisitions - the examination's acquisitions (DatasetAcquisitionDTOs).
 * @param {number} datasetId
 * @param {AbortSignal} [signal]
 * @returns {Promise<object|null>} the acquisition, or null if the dataset is in none of them
 *   (e.g. a processed dataset, which has no acquisition).
 */
async function findAcquisitionWithExtraData(client, acquisitions, datasetId, signal) {
  const withExtraData = acquisitions.filter(
    (acquisition) => selectExtraDataFileNames(acquisition.extraDataFilePathList).length > 0
  );
  const datasetLists = await Promise.all(
    withExtraData.map((acquisition) => client.listAcquisitionDatasets(acquisition.id, signal))
  );
  return (
    withExtraData.find((_acquisition, i) =>
      datasetLists[i].some((dataset) => dataset.id === datasetId)
    ) ?? null
  );
}

/**
 * Downloads the EEG recording and the files that go with it: electrode positions, inverse
 * solution and montage, one of each kind (see pickOneExtraFilePerKind). They can be in the
 * recording's own dataset zip, attached to its acquisition, or attached to the examination;
 * the most specific to the recording wins.
 *
 * @returns {Promise<{ datasetFiles: File[], eegFiles: File[], skippedFiles: object[] }>}
 *   `datasetFiles`: everything in the dataset zip; `eegFiles`: the files for the EEG intake,
 *   empty when the zip holds no recording VIDEPE can read; `skippedFiles`: the files of a kind
 *   another file won.
 */
async function fetchEegRecording({
  client,
  eegDataset,
  examinationId,
  examination,
  acquisitions,
  signal,
}) {
  // The zip and the acquisition lookup run in parallel; the extra data waits for both, so only
  // the files that are used get downloaded
  const [datasetFiles, acquisition] = await Promise.all([
    client.downloadDatasetZip(eegDataset.id, signal).then(unzipToFiles),
    findAcquisitionWithExtraData(client, acquisitions, eegDataset.id, signal),
  ]);

  // Without a recording there is nothing to show: electrode positions, inverse solutions and
  // montages only mean something alongside one
  const intakeFiles = selectEegIntakeFiles(datasetFiles);
  if (!hasEegRecording(intakeFiles)) return { datasetFiles, eegFiles: [], skippedFiles: [] };

  // Collect the candidate files (electrode positions, inverse solutions, montages) from each
  // place, as { name, source, load }: `source` names the place for the toast, and `load()`
  // returns the File. The choice below is made on the names alone, so only the files that
  // are used get loaded.

  // 1. Files inside the recording's dataset zip: already downloaded, load() just returns them
  const datasetCandidates = intakeFiles
    .filter((file) => extraFileKind(file.name) !== null)
    .map((file) => ({ name: file.name, source: SOURCE_DATASET, load: async () => file }));

  // 2. Files attached to the recording's acquisition (none if it has no acquisition with
  //    usable extra data): load() downloads the file
  const acquisitionCandidates = selectExtraDataFileNames(acquisition?.extraDataFilePathList).map(
    (name) => ({
      name,
      source: SOURCE_ACQUISITION,
      load: () => client.downloadAcquisitionExtraData(acquisition.id, name, signal),
    })
  );

  // 3. Files attached to the examination: load() downloads the file
  const examinationCandidates = selectExtraDataFileNames(examination?.extraDataFilePathList).map(
    (name) => ({
      name,
      source: SOURCE_EXAMINATION,
      load: () => client.downloadExtraData(examinationId, name, signal),
    })
  );

  // Keep one file of each kind: the order of the places sets the precedence, most specific first
  const candidates = [...datasetCandidates, ...acquisitionCandidates, ...examinationCandidates];
  const { kept, skipped } = pickOneExtraFilePerKind(candidates);
  const extraFiles = await Promise.all(kept.map((candidate) => candidate.load()));

  const recordingFiles = intakeFiles.filter((file) => extraFileKind(file.name) === null);
  return { datasetFiles, eegFiles: [...recordingFiles, ...extraFiles], skippedFiles: skipped };
}

/**
 * Downloads everything VIDEPE shows for one Shanoir examination, and sorts it into the
 * files for the EEG viewer and the files for the neuroimaging viewer.
 *
 * The examination's datasets are its acquisitions' datasets plus the processed datasets made
 * from them (see listProcessedOutputs); both are routed the same way.
 *
 * Datasets are routed by their Shanoir type (DatasetDTO.type), known before downloading —
 * each dataset is one zip, and its files simply follow the dataset's route:
 * - EEG: only the latest imported EEG dataset is loaded (highest dataset id), like the
 *   dropzone, where the newest drop wins. The EEG intake keeps one file per extension,
 *   so combining two recordings could pair one run's .vhdr with another run's .eeg.
 *   The older recordings are reported back in `skippedDatasets`.
 *   One electrode positions, inverse solution and montage file each is added to the EEG files,
 *   the most specific to the recording winning: from its dataset zip, then the extra data
 *   attached to its acquisition, then the extra data attached to the examination (see
 *   fetchEegRecording). The others are reported back in `skippedFiles`.
 * - Imaging (MR, PET, …): every dataset is loaded; each becomes one or more layers.
 * - Anything else is not downloaded, and is reported back in `skippedDatasets`.
 * - A downloaded dataset with no file VIDEPE can open (e.g. an EEGLAB recording) is reported
 *   back in `skippedDatasets` too, with the extensions it contained.
 *
 * Downloads run in parallel. Nothing is handed to the viewers here — the caller does that
 * once, with the complete sets (see useShanoirData).
 *
 * @param {Object} params
 * @param {ReturnType<import('./shanoirClient').createShanoirClient>} params.client
 * @param {number} params.examinationId
 * @param {AbortSignal} [params.signal] - cancels all requests.
 * @returns {Promise<{
 *   eegDatasetName: { id: number, name: string, type: string }|null,
 *   eegFiles: File[],
 *   imagingFiles: File[],
 *   skippedDatasets: { id: number, name: string, type: string, reason: string }[],
 *   skippedFiles: { name: string, source: string, reason: string }[],
 * }>} the sorted files:
 *   - `eegDataset`: the EEG dataset that was loaded, or null if the examination has none (or
 *     its recording is in a format VIDEPE can't read).
 *   - `eegFiles`: files for useEegFileIntake's handleEegFiles (recording, electrode
 *     positions, inverse solutions, montages).
 *   - `imagingFiles`: files for filesToLayers (NIfTI/MGH volumes, GIFTI meshes).
 *   - `skippedDatasets`: datasets not loaded, with the reason, so the caller can tell the user.
 *   - `skippedFiles`: electrode positions, inverse solutions and montages not loaded because
 *     another file of the same kind was used, with where each was found and the file used.
 * @throws {Error} when any request or unzip fails.
 */
export async function fetchShanoirExamination({ client, examinationId, signal }) {
  const [acquisitionDatasets, examination, acquisitions] = await Promise.all([
    client.listExaminationDatasets(examinationId, signal),
    client.getExamination(examinationId, signal),
    client.listExaminationAcquisitions(examinationId, signal),
  ]);
  // Add the processed datasets made from them (e.g. a T1 or segmentation uploaded as a
  // processed dataset), which then follow the same routing rules
  const processedDatasets = await listProcessedOutputs(client, acquisitionDatasets, signal);
  const datasets = [...acquisitionDatasets, ...processedDatasets];

  // Route every dataset by type before downloading anything
  const imagingDatasets = datasets.filter((dataset) => classifyDataset(dataset) === 'imaging');
  const otherDatasets = datasets.filter((dataset) => classifyDataset(dataset) === null);
  const eegDatasets = datasets.filter((dataset) => classifyDataset(dataset) === 'eeg');
  // only keep the latest imported eeg dataset the examination contains e.g. multiple runs.
  // Shanoir's dataset ids follow import order, so the highest id is the latest import,
  // whatever order Shanoir lists them in. Group the others under olderEegDatasets
  const eegDatasetsLatestFirst = [...eegDatasets].sort((a, b) => b.id - a.id);
  const eegDataset = eegDatasetsLatestFirst[0];
  const olderEegDatasets = eegDatasetsLatestFirst.slice(1);

  // both olderEegDatasets and otherDatasets are skipped, but logged in the skippedDatasets
  // so the user knows what is and isn't displayed
  const skippedDatasets = olderEegDatasets.map((dataset) => ({
    id: dataset.id,
    name: dataset.name ?? `dataset ${dataset.id}`,
    type: dataset.type,
    // "latest" = the highest dataset id, since Shanoir's ids follow import order
    reason: 'older EEG recording, using the latest (highest dataset id)',
  }));
  skippedDatasets.push(
    ...otherDatasets.map((dataset) => ({
      id: dataset.id,
      name: dataset.name ?? `dataset ${dataset.id}`,
      type: dataset.type,
      // name the type as Shanoir sent it, so a type that should be supported but isn't
      // recognised (e.g. a spelling mismatch) is visible to the user
      reason: `unsupported dataset type: ${dataset.type ?? 'none'}`,
    }))
  );

  // Helper function to download a dataset's zip and return its files.
  const downloadAndUnzipFiles = async (dataset) =>
    unzipToFiles(await client.downloadDatasetZip(dataset.id, signal));

  // Now download zip and unzip the files
  // The recording (with its electrode positions, inverse solution and montage) and the imaging
  // are started together, then awaited as one
  const [eegRecording, imagingDatasetFiles] = await Promise.all([
    eegDataset
      ? fetchEegRecording({
          client,
          eegDataset,
          examinationId,
          examination,
          acquisitions,
          signal,
        })
      : null,
    Promise.all(imagingDatasets.map((dataset) => downloadAndUnzipFiles(dataset))),
  ]);

  // A dataset of a supported type can still hold only files VIDEPE can't open (e.g. an EEGLAB
  // recording). Report it as skipped, listing what it contained, instead of loading nothing
  // without telling the user.
  const unsupportedFiles = (dataset, files) => {
    const extensions = listFileExtensions(files);
    return {
      ...datasetLabel(dataset),
      reason: `unsupported files${extensions.length > 0 ? `: ${extensions.join(', ')}` : ''}`,
    };
  };

  // the EEG files (empty when the recording's dataset holds no recording VIDEPE can read)
  const eegFiles = eegRecording?.eegFiles ?? [];
  const isEegLoadable = eegFiles.length > 0;
  if (eegDataset && !isEegLoadable) {
    skippedDatasets.push(unsupportedFiles(eegDataset, eegRecording.datasetFiles));
  }

  // bundle imagingFiles, selected per dataset so a dataset without image files can be reported
  const imagingFilesPerDataset = imagingDatasetFiles.map(selectImagingFiles);
  imagingDatasets.forEach((dataset, i) => {
    if (imagingFilesPerDataset[i].length === 0) {
      skippedDatasets.push(unsupportedFiles(dataset, imagingDatasetFiles[i]));
    }
  });
  const imagingFiles = imagingFilesPerDataset.flat(); // flat is needed to get single array instead of array of arrays

  return {
    eegDataset: isEegLoadable ? datasetLabel(eegDataset) : null,
    eegFiles: eegFiles,
    imagingFiles: imagingFiles,
    skippedDatasets,
    skippedFiles: eegRecording?.skippedFiles ?? [],
  };
}
