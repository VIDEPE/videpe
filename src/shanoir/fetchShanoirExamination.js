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
import { isBidsType, sortBidsDatasets } from './bidsDatasets';

// Where a file for the recording (electrode positions, inverse solution, montage) was found,
// as named to the user in the "skipped" toast; most specific to the recording first
const SOURCE_DATASET = "the recording's dataset";
const SOURCE_ACQUISITION = "the recording's acquisition";
const SOURCE_EXAMINATION = 'the examination';
const SOURCE_BIDS = "the recording's BIDS folder";

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
 * Finds the acquisition an EEG recording belongs to. Only the acquisitions that matter are
 * asked (so an examination without them costs no extra request): those with extra data VIDEPE
 * uses, and for a BIDS recording the BIDS acquisitions (one per BIDS folder, e.g. 'eeg (BIDS)'),
 * whose other datasets may hold the recording's electrode positions. The examination's
 * dataset list doesn't link a dataset to its acquisition, so each is asked for its datasets.
 *
 * @param {ReturnType<import('./shanoirClient').createShanoirClient>} client
 * @param {object[]} acquisitions - the examination's acquisitions (DatasetAcquisitionDTOs).
 * @param {{ isBids: boolean, datasets: { id: number }[] }} recording
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ acquisition: object, datasetIds: Set<number> }|null>} the acquisition
 *   with the ids of its datasets, or null if the recording is in none of them (e.g. a processed
 *   dataset, which has no acquisition).
 */
async function findRecordingAcquisition(client, acquisitions, recording, signal) {
  const candidates = acquisitions.filter(
    (acquisition) =>
      selectExtraDataFileNames(acquisition.extraDataFilePathList).length > 0 ||
      (recording.isBids && isBidsType(acquisition))
  );
  const datasetLists = await Promise.all(
    candidates.map((acquisition) => client.listAcquisitionDatasets(acquisition.id, signal))
  );
  const recordingId = recording.datasets[0].id;
  const index = datasetLists.findIndex((list) => list.some((d) => d.id === recordingId));
  if (index === -1) return null;
  return {
    acquisition: candidates[index],
    datasetIds: new Set(datasetLists[index].map((dataset) => dataset.id)),
  };
}

/**
 * Downloads the EEG recording and the files that go with it: electrode positions, inverse
 * solution and montage, one of each kind (see pickOneExtraFilePerKind). They can be in the
 * recording's own dataset zip, attached to its acquisition, attached to the examination, or
 * (for a BIDS recording) BIDS datasets from the same BIDS folder; the most specific to the
 * recording wins, in that order.
 *
 * @returns {Promise<{
 *   datasetFiles: File[], eegFiles: File[], skippedFiles: object[], usedBidsExtras: object[],
 * }>} `datasetFiles`: everything in the recording's dataset zips; `eegFiles`: the files for
 *   the EEG intake, empty when the zips hold no recording VIDEPE can read; `skippedFiles`: the
 *   files of a kind another file won; `usedBidsExtras`: the BIDS extras that were candidates
 *   (from the recording's BIDS folder), whether they won or not.
 */
async function fetchEegRecording({
  client,
  recording,
  bidsExtras,
  examinationId,
  examination,
  acquisitions,
  downloadAndUnzipFiles,
  signal,
}) {
  // The zips and the acquisition lookup run in parallel; the extra data waits for both, so only
  // the files that are used get downloaded
  const [datasetFileLists, found] = await Promise.all([
    Promise.all(recording.datasets.map(downloadAndUnzipFiles)),
    findRecordingAcquisition(client, acquisitions, recording, signal),
  ]);
  const datasetFiles = datasetFileLists.flat();
  const acquisition = found?.acquisition;

  // Without a recording there is nothing to show: electrode positions, inverse solutions and
  // montages only mean something alongside one
  const intakeFiles = selectEegIntakeFiles(datasetFiles);
  if (!hasEegRecording(intakeFiles)) {
    return { datasetFiles, eegFiles: [], skippedFiles: [], usedBidsExtras: [] };
  }

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

  // 4. BIDS datasets from the recording's own BIDS folder (acquisition): load() downloads the
  //    dataset and takes its file. Only for a BIDS recording: Shanoir doesn't record which
  //    BIDS folder a recording from another import (e.g. the EEG tab) belongs to, and one BIDS
  //    import can hold an eeg and an ieeg folder, each with its own electrode positions.
  const usedBidsExtras = recording.isBids
    ? bidsExtras.filter((extra) => found?.datasetIds.has(extra.dataset.id))
    : [];
  const bidsCandidates = usedBidsExtras.map((extra) => ({
    name: extra.fileName,
    source: SOURCE_BIDS,
    load: async () =>
      (await downloadAndUnzipFiles(extra.dataset)).find((file) => extraFileKind(file.name)),
  }));

  // Keep one file of each kind: the order of the places sets the precedence, most specific first
  const candidates = [
    ...datasetCandidates,
    ...acquisitionCandidates,
    ...examinationCandidates,
    ...bidsCandidates,
  ];
  const { kept, skipped } = pickOneExtraFilePerKind(candidates);
  // (a BIDS dataset whose download turns out not to hold the file named is left out)
  const extraFiles = (await Promise.all(kept.map((candidate) => candidate.load()))).filter(Boolean);

  const recordingFiles = intakeFiles.filter((file) => extraFileKind(file.name) === null);
  return {
    datasetFiles,
    eegFiles: [...recordingFiles, ...extraFiles],
    skippedFiles: skipped,
    usedBidsExtras,
  };
}

/**
 * Downloads everything VIDEPE shows for one Shanoir examination, and sorts it into the
 * files for the EEG viewer and the files for the neuroimaging viewer.
 *
 * The examination's datasets are its acquisitions' datasets plus the processed datasets made
 * from them (see listProcessedOutputs); both are routed the same way.
 *
 * Datasets are routed by their Shanoir type (DatasetDTO.type), known before downloading —
 * each dataset is one zip, and its files simply follow the dataset's route. BIDS datasets
 * (one per file of a BIDS import) are routed by the file they hold instead, see
 * sortBidsDatasets:
 * - EEG: only the latest imported EEG recording is loaded (highest dataset id), like the
 *   dropzone, where the newest drop wins. The EEG intake keeps one file per extension,
 *   so combining two recordings could pair one run's .vhdr with another run's .eeg. A BIDS
 *   recording's parts (.vhdr, .eeg, .vmrk) are one recording, with the highest id among them.
 *   The older recordings are reported back in `skippedDatasets`.
 *   One electrode positions, inverse solution and montage file each is added to the EEG files,
 *   the most specific to the recording winning: from its dataset zip, then the extra data
 *   attached to its acquisition, then the extra data attached to the examination, then (for a
 *   BIDS recording) the BIDS datasets of its BIDS folder (see fetchEegRecording). The others
 *   are reported back in `skippedFiles`; BIDS ones that don't go with the recording loaded are
 *   reported in `skippedDatasets`.
 * - Imaging (MR, PET, …, and BIDS images): every dataset is loaded; each becomes one or more
 *   layers.
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
 *   - `eegDataset`: the EEG recording that was loaded, or null if the examination has none (or
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

  // Helper function to download a dataset's zip and return its files. Each dataset is
  // downloaded once: a renamed BIDS dataset is downloaded to find out what it holds, and its
  // files are reused if it's then loaded.
  const downloads = new Map(); // dataset id → Promise of its files
  const downloadAndUnzipFiles = (dataset) => {
    if (!downloads.has(dataset.id)) {
      downloads.set(
        dataset.id,
        client.downloadDatasetZip(dataset.id, signal).then((zip) => unzipToFiles(zip))
      );
    }
    return downloads.get(dataset.id);
  };

  // Route every dataset by type; BIDS datasets by the file they hold (by name, if possible
  // without downloading)
  const bids = await sortBidsDatasets(datasets.filter(isBidsType), downloadAndUnzipFiles);
  const typedDatasets = datasets.filter((dataset) => !isBidsType(dataset));
  const imagingDatasets = [
    ...typedDatasets.filter((dataset) => classifyDataset(dataset) === 'imaging'),
    ...bids.imagingDatasets,
  ];
  const otherDatasets = typedDatasets.filter((dataset) => classifyDataset(dataset) === null);

  // Every EEG recording in the examination: an EEG dataset is one recording, a BIDS
  // recording groups the datasets of its parts
  const recordings = [
    ...typedDatasets
      .filter((dataset) => classifyDataset(dataset) === 'eeg')
      .map((dataset) => ({ ...datasetLabel(dataset), isBids: false, datasets: [dataset] })),
    ...bids.recordings,
  ];
  // only keep the latest imported recording the examination contains e.g. multiple runs.
  // Shanoir's dataset ids follow import order, so the highest id is the latest import,
  // whatever order Shanoir lists them in. Group the others under olderRecordings
  const recordingsLatestFirst = [...recordings].sort((a, b) => b.id - a.id);
  const recording = recordingsLatestFirst[0];
  const olderRecordings = recordingsLatestFirst.slice(1);

  // both olderRecordings and otherDatasets are skipped, but logged in the skippedDatasets
  // so the user knows what is and isn't displayed
  const skippedDatasets = olderRecordings.map((older) => ({
    id: older.id,
    name: older.name,
    type: older.type,
    // "latest" = the highest dataset id, since Shanoir's ids follow import order
    reason: 'older EEG recording, using the latest (highest dataset id)',
  }));
  skippedDatasets.push(
    ...otherDatasets.map((dataset) => ({
      ...datasetLabel(dataset),
      // name the type as Shanoir sent it, so a type that should be supported but isn't
      // recognised (e.g. a spelling mismatch) is visible to the user
      reason: `unsupported dataset type: ${dataset.type ?? 'none'}`,
    }))
  );

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
  skippedDatasets.push(
    ...bids.unsupported.map(({ dataset, files }) => unsupportedFiles(dataset, files))
  );

  // Now download zip and unzip the files
  // The recording (with its electrode positions, inverse solution and montage) and the imaging
  // are started together, then awaited as one
  const [eegRecording, imagingDatasetFiles] = await Promise.all([
    recording
      ? fetchEegRecording({
          client,
          recording,
          bidsExtras: bids.extras,
          examinationId,
          examination,
          acquisitions,
          downloadAndUnzipFiles,
          signal,
        })
      : null,
    Promise.all(imagingDatasets.map((dataset) => downloadAndUnzipFiles(dataset))),
  ]);

  // BIDS electrode positions, inverse solutions and montages that don't go with the loaded
  // recording (another BIDS folder's, or no BIDS recording loaded)
  const usedBidsExtras = eegRecording?.usedBidsExtras ?? [];
  skippedDatasets.push(
    ...bids.extras
      .filter((extra) => !usedBidsExtras.includes(extra))
      .map(({ dataset }) => ({
        ...datasetLabel(dataset),
        reason: 'only used with a recording from the same BIDS folder',
      }))
  );

  // the EEG files (empty when the recording's datasets hold no recording VIDEPE can read)
  const eegFiles = eegRecording?.eegFiles ?? [];
  const isEegLoadable = eegFiles.length > 0;
  if (recording && !isEegLoadable) {
    skippedDatasets.push(unsupportedFiles(recording, eegRecording.datasetFiles));
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
    eegDataset: isEegLoadable ? datasetLabel(recording) : null,
    eegFiles: eegFiles,
    imagingFiles: imagingFiles,
    skippedDatasets,
    skippedFiles: eegRecording?.skippedFiles ?? [],
  };
}
