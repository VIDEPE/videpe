import {
  EEG_FORMAT_EXTENSIONS,
  ELEC_POS_EXTENSIONS,
  INV_SOLUTIONS_EXTENSIONS,
  MONTAGE_EXTENSIONS,
} from '@/loaders/eegFormatRegistry';
import { LAUNCH_IMAGING_EXTENSIONS } from '@/utils/imagingFormats';
import { isEegRecordingFile, isImagingFile } from '@/utils/launchFiles';
import { extraFileKind } from './shanoirFiles';

// A BIDS import in Shanoir makes one `BIDS` dataset per file, named after that file with its
// dots replaced by underscores, e.g. 'sub-4_ses-7_T1w.nii.gz' → 'sub-4_ses-7_T1w_nii_gz'
// (Shanoir 2.18.1). So the file in a BIDS dataset is known from the dataset name, without
// downloading it. That naming isn't a documented contract and users can rename datasets, so a
// name that doesn't end in a known extension falls back to downloading the dataset.

// The BrainVision marker file: part of a recording, but the EEG viewer doesn't read it
const BRAINVISION_MARKER_EXTENSION = '.vmrk';

// Extensions recognised at the end of a BIDS dataset name: every file VIDEPE opens, plus the
// BIDS files it knows it doesn't use (marker files, JSON sidecars), so those aren't downloaded
// just to find that out. Longest first, so '_nii_gz' is read as '.nii.gz'.
const KNOWN_EXTENSIONS = [
  ...new Set([
    ...LAUNCH_IMAGING_EXTENSIONS,
    ...EEG_FORMAT_EXTENSIONS,
    ...ELEC_POS_EXTENSIONS,
    ...INV_SOLUTIONS_EXTENSIONS,
    ...MONTAGE_EXTENSIONS,
    BRAINVISION_MARKER_EXTENSION,
    '.json',
  ]),
].sort((a, b) => b.length - a.length);

/**
 * @param {{ type?: string }} item - a Shanoir dataset or acquisition.
 * @returns {boolean} whether it comes from a BIDS import (type 'BIDS', in any case).
 */
export const isBidsType = (item) => item?.type?.toUpperCase() === 'BIDS';

/**
 * Restores the file name of a BIDS dataset from its dataset name.
 *
 * @param {string} datasetName - e.g. 'sub-4_ses-7_T1w_nii_gz'.
 * @returns {string|null} e.g. 'sub-4_ses-7_T1w.nii.gz', or null when the name doesn't end in a
 *   known extension (e.g. a renamed dataset).
 */
export function bidsFileNameFromDatasetName(datasetName) {
  const name = datasetName ?? '';
  const extension = KNOWN_EXTENSIONS.find((ext) =>
    name.toLowerCase().endsWith(ext.replaceAll('.', '_'))
  );
  if (!extension || name.length === extension.length) return null;
  return name.slice(0, -extension.length) + extension;
}

/**
 * @param {string} fileName - the file in a BIDS dataset.
 * @returns {'imaging'|'recording'|'extra'|null} what the file is to VIDEPE: an image for the
 *   neuroimaging viewer, part of an EEG recording (incl. the BrainVision marker file), a file
 *   that goes with a recording (electrode positions, inverse solution, montage), or none of
 *   these.
 */
export function bidsFileRole(fileName) {
  if (isImagingFile(fileName)) return 'imaging';
  if (
    isEegRecordingFile(fileName) ||
    fileName.toLowerCase().endsWith(BRAINVISION_MARKER_EXTENSION)
  ) {
    return 'recording';
  }
  if (extraFileKind(fileName) !== null) return 'extra';
  return null;
}

/**
 * @param {string} fileName - e.g. 'sub-4_ses-7_task-rest_eeg.vhdr'.
 * @returns {string} the name without its extension, e.g. 'sub-4_ses-7_task-rest_eeg': the
 *   parts of one recording (.vhdr, .eeg, .vmrk) share it.
 */
export const recordingStem = (fileName) => fileName.slice(0, fileName.lastIndexOf('.'));

/**
 * Sorts an examination's BIDS datasets by the file each holds. The file name comes from the
 * dataset name when it follows Shanoir's naming; otherwise the dataset is downloaded to read
 * it (download through a cache, so a dataset that's loaded later isn't downloaded twice).
 *
 * @param {object[]} datasets - the `BIDS` datasets (DatasetDTOs).
 * @param {(dataset: object) => Promise<File[]>} downloadAndUnzipFiles
 * @returns {Promise<{
 *   imagingDatasets: object[],
 *   recordings: { id: number, name: string, type: string, isBids: true, datasets: object[] }[],
 *   extras: { dataset: object, fileName: string }[],
 *   unsupported: { dataset: object, files: { name: string }[] }[],
 * }>}
 *   - `imagingDatasets`: datasets holding an image, loaded like any imaging dataset.
 *   - `recordings`: the EEG recordings, each grouping the datasets of its parts (e.g. .vhdr,
 *     .eeg and .vmrk), named after them and with the highest id among them (the latest
 *     imported part). `datasets` holds only the parts the EEG viewer reads, so the marker
 *     file is never downloaded.
 *   - `extras`: electrode positions, inverse solutions and montages, with their file name.
 *   - `unsupported`: datasets with no file VIDEPE uses, with the files they hold (by name).
 */
export async function sortBidsDatasets(datasets, downloadAndUnzipFiles) {
  // Each BIDS dataset holds one file: find its name
  const entries = await Promise.all(
    datasets.map(async (dataset) => {
      const fileName = bidsFileNameFromDatasetName(dataset.name);
      if (fileName) return { dataset, fileName, files: [{ name: fileName }] };
      // renamed (or Shanoir's naming changed): read the name from the download
      const files = await downloadAndUnzipFiles(dataset);
      const known = files.find((file) => bidsFileRole(file.name) !== null);
      return { dataset, fileName: known?.name ?? null, files };
    })
  );
  const role = (entry) => (entry.fileName ? bidsFileRole(entry.fileName) : null);

  // Group the recording parts by name stem: one recording each
  const parts = new Map(); // stem → its entries
  for (const entry of entries.filter((e) => role(e) === 'recording')) {
    const stem = recordingStem(entry.fileName);
    parts.set(stem, [...(parts.get(stem) ?? []), entry]);
  }
  const recordings = [];
  const unsupported = entries.filter((e) => role(e) === null);
  for (const [stem, stemEntries] of parts) {
    const readParts = stemEntries.filter((e) => isEegRecordingFile(e.fileName));
    // e.g. only a marker file: no recording to show
    if (readParts.length === 0) {
      unsupported.push(...stemEntries);
      continue;
    }
    recordings.push({
      id: Math.max(...stemEntries.map((e) => e.dataset.id)),
      name: stem,
      type: stemEntries[0].dataset.type,
      isBids: true,
      datasets: readParts.map((e) => e.dataset),
    });
  }

  return {
    imagingDatasets: entries.filter((e) => role(e) === 'imaging').map((e) => e.dataset),
    recordings,
    extras: entries
      .filter((e) => role(e) === 'extra')
      .map(({ dataset, fileName }) => ({ dataset, fileName })),
    unsupported: unsupported.map(({ dataset, files }) => ({ dataset, files })),
  };
}
