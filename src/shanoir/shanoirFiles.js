import { EEG_FORMAT_EXTENSIONS, INV_SOLUTIONS_EXTENSIONS } from '@/loaders/eegFormatRegistry';

// Decides which Shanoir datasets and files VIDEPE loads, and where they go.

// Shanoir dataset types (DatasetDTO.type) VIDEPE's neuroimaging viewer can show.
// Their downloads (format=nii) contain NIfTI volumes or meshes, which filesToLayers handles.
const IMAGING_DATASET_TYPES = ['MR', 'PET', 'SPECT', 'CT', 'SEGMENTATION', 'MESH'];

// Image files the neuroimaging viewer opens from a Shanoir imaging download: NIfTI volumes
// (what format=nii returns), FreeSurfer MGH/MGZ volumes and GIFTI surface meshes. Anything
// else in the zip — e.g. the JSON sidecars and .bval/.bvec files Shanoir's DICOM → NIfTI
// conversion can add — would fail to load as a layer.
const IMAGING_EXTENSIONS = ['.nii', '.nii.gz', '.mgh', '.mgz', '.gii'];

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
  const type = dataset?.type?.toUpperCase(); // force dataset type to uppercase to make the check case-independent
  if (type === 'EEG') return 'eeg';
  if (IMAGING_DATASET_TYPES.includes(type)) return 'imaging';
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
 * Whether the files include an EEG recording VIDEPE can read. An EEG dataset without one (e.g.
 * an EEGLAB recording) has nothing to show, even if it holds electrode positions.
 *
 * @param {File[]} files
 * @returns {boolean}
 */
export function hasEegRecording(files) {
  return files.some((f) => isEegRecordingFile(f.name));
}

/**
 * Lists the file extensions found in a dataset, to tell the user what a dataset VIDEPE
 * couldn't load contained (e.g. ".set").
 *
 * @param {File[]} files
 * @returns {string[]} each extension once, lowercased and with its dot, in the order the files
 *   come in. Files without an extension are left out.
 */
export function listFileExtensions(files) {
  const extensions = files
    .map((f) => baseName(f.name))
    .filter((name) => name.includes('.'))
    .map((name) => name.slice(name.lastIndexOf('.')).toLowerCase());
  return [...new Set(extensions)]; // a Set keeps the first of each, in order
}

/**
 * Picks the image files (volumes and surface meshes) from an unzipped imaging dataset, for
 * filesToLayers. Conversion sidecars and other non-image files are dropped.
 *
 * @param {File[]} files
 * @returns {File[]} the subset to load, in the original order.
 */
export function selectImagingFiles(files) {
  return files.filter((f) => IMAGING_EXTENSIONS.some((ext) => f.name.toLowerCase().endsWith(ext)));
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
