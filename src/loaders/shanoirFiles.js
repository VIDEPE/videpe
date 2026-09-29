import { EEG_FORMAT_EXTENSIONS, INV_SOLUTIONS_EXTENSIONS } from './eegFormatRegistry';

// Decides which Shanoir datasets and files VIDEPE loads, and where they go.

// Shanoir dataset types (DatasetDTO.type) VIDEPE's neuroimaging viewer can show.
// Their downloads (format=nii) contain NIfTI volumes or meshes, which filesToLayers handles.
const IMAGING_DATASET_TYPES = ['Mr', 'Pet', 'Spect', 'Ct', 'Segmentation', 'Mesh'];

// Electrode positions: '.elc', or a BIDS '*_electrodes.tsv'. Other .tsv files
// (BIDS _channels.tsv, _events.tsv, _scans.tsv) are not positions, and would be
// misrouted since the EEG intake routes every .tsv to the electrode-position parser.
const isElectrodePositionFile = (name) => /(\.elc|_electrodes\.tsv)$/i.test(name);
const isInverseSolutionFile = (name) =>
  INV_SOLUTIONS_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext));
const isEegRecordingFile = (name) =>
  EEG_FORMAT_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext));

// Base file name of a path — Shanoir paths can use either separator.
const baseName = (path) => path.split(/[\\/]/).pop();

/**
 * @param {{ type?: string }} dataset - a Shanoir DatasetDTO.
 * @returns {'eeg'|'imaging'|null} which viewer the dataset belongs to, or null if VIDEPE
 *   can't show it.
 */
export function classifyDataset(dataset) {
  if (dataset?.type === 'Eeg') return 'eeg';
  if (IMAGING_DATASET_TYPES.includes(dataset?.type)) return 'imaging';
  return null;
}

/**
 * Picks the files the EEG intake (useEegFileIntake's handleEegFiles) should receive from an
 * unzipped EEG dataset: the recording itself, electrode positions and inverse solutions.
 * Everything else (e.g. the BrainVision .vmrk marker file, BIDS sidecars) is dropped, so it
 * doesn't show up as "Unsupported file" or get parsed as electrode positions.
 *
 * @param {File[]} files
 * @returns {File[]} the subset to load, in the original order.
 */
export function selectEegIntakeFiles(files) {
  return files.filter(
    (f) =>
      isEegRecordingFile(f.name) || isElectrodePositionFile(f.name) || isInverseSolutionFile(f.name)
  );
}

/**
 * Picks the examination extra-data files (attached to the examination in Shanoir) that
 * VIDEPE loads: electrode positions and inverse solutions.
 *
 * @param {string[]|undefined} paths - ExaminationDTO.extraDataFilePathList.
 * @returns {string[]} base file names, as expected by the extra-data download endpoint.
 */
export function selectExtraDataFileNames(paths) {
  return (paths ?? [])
    .map(baseName)
    .filter((name) => isElectrodePositionFile(name) || isInverseSolutionFile(name));
}
