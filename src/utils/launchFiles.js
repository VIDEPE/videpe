import { EEG_FORMAT_EXTENSIONS, INV_SOLUTIONS_EXTENSIONS } from '@/loaders/eegFormatRegistry';

// Decides which viewer gets each file when VIDEPE is launched by another app (Shanoir, or a
// host app such as a local Python app), which hands over its files in one batch. In the
// normal flow this isn't needed: each panel has its own drop zone and intake, and the user
// picks the panel by dropping a file there.
//
// Shared by src/shanoir/ and src/hostApp/, which never import from each other.

// Image files the neuroimaging viewer opens: NIfTI volumes (e.g. what Shanoir's format=nii
// download returns), FreeSurfer MGH/MGZ volumes and GIFTI surface meshes. Anything else —
// e.g. the JSON sidecars and .bval/.bvec files Shanoir's DICOM → NIfTI conversion can add —
// would fail to load as a layer.
const IMAGING_EXTENSIONS = ['.nii', '.nii.gz', '.mgh', '.mgz', '.gii'];

// Electrode positions: '.elc', or a BIDS '*_electrodes.tsv'. Other .tsv files
// (BIDS _channels.tsv, _events.tsv, _scans.tsv) are not positions, and would be
// misrouted since the EEG intake routes every .tsv to the electrode-position parser.
export const isElectrodePositionFile = (name) => /(\.elc|_electrodes\.tsv)$/i.test(name);
export const isInverseSolutionFile = (name) =>
  INV_SOLUTIONS_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext));
export const isEegRecordingFile = (name) =>
  EEG_FORMAT_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext));
const isEegIntakeFile = (name) =>
  isEegRecordingFile(name) || isElectrodePositionFile(name) || isInverseSolutionFile(name);
const isImagingFile = (name) => IMAGING_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext));

// Base file name of a path — paths (e.g. Shanoir's) can use either separator.
export const baseName = (path) => path.split(/[\\/]/).pop();

/**
 * Picks the files the EEG intake (useEegFileIntake's handleEegFiles) should receive: the
 * recording itself, electrode positions and inverse solutions. Everything else (e.g. the
 * BrainVision .vmrk marker file, BIDS sidecars) is dropped, so it doesn't show up as
 * "Unsupported file" or get parsed as electrode positions.
 *
 * @param {File[]} files
 * @returns {File[]} the subset to load, in the original order.
 */
export function selectEegIntakeFiles(files) {
  return files.filter((f) => isEegIntakeFile(f.name));
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
 * Lists the file extensions found in a set of files, to tell the user what a dataset VIDEPE
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
 * Picks the image files (volumes and surface meshes) for filesToLayers. Conversion sidecars
 * and other non-image files are dropped.
 *
 * @param {File[]} files
 * @returns {File[]} the subset to load, in the original order.
 */
export function selectImagingFiles(files) {
  return files.filter((f) => isImagingFile(f.name));
}

/**
 * Sorts a mixed set of files (e.g. everything a host app hands over) by the viewer that can
 * open them — the same choices selectEegIntakeFiles and selectImagingFiles make — and reports
 * the rest, so the user can be told what wasn't shown instead of it being dropped silently.
 *
 * Only looks at each item's `name`, so it also sorts files before they're downloaded (e.g. a
 * host app's `{ name, url }` entries), and the skipped ones never need downloading.
 *
 * @template {{ name: string }} T
 * @param {T[]} files - Files, or anything else with a file name.
 * @returns {{ eegFiles: T[], imagingFiles: T[], skippedFiles: T[] }} every file in
 *   exactly one group, each in the original order:
 *   - `eegFiles`: for the EEG intake (recording, electrode positions, inverse solutions).
 *   - `imagingFiles`: for filesToLayers (volumes and surface meshes).
 *   - `skippedFiles`: files neither viewer opens (e.g. an EEGLAB .set, a BIDS sidecar, the
 *     BrainVision .vmrk marker file).
 */
export function sortFilesByViewer(files) {
  return {
    eegFiles: files.filter((f) => isEegIntakeFile(f.name)),
    imagingFiles: files.filter((f) => isImagingFile(f.name)),
    skippedFiles: files.filter((f) => !isEegIntakeFile(f.name) && !isImagingFile(f.name)),
  };
}
