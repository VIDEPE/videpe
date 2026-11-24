import {
  baseName,
  isElectrodePositionFile,
  isInverseSolutionFile,
  isMontageFile,
} from '@/utils/launchFiles';

// Decides which Shanoir datasets and files VIDEPE loads, and where they go. Sorting the
// downloaded files themselves is shared with the host-app mode, in src/utils/launchFiles.js.

// Shanoir dataset types (DatasetDTO.type) VIDEPE's neuroimaging viewer can show.
// Their downloads (format=nii) contain NIfTI volumes or meshes, which filesToLayers handles.
const IMAGING_DATASET_TYPES = ['MR', 'PET', 'SPECT', 'CT', 'SEGMENTATION', 'MESH'];

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
 * Picks the examination extra-data files (attached to the examination in Shanoir) that
 * VIDEPE loads: electrode positions, inverse solutions and montages.
 *
 * @param {string[]|undefined} paths - ExaminationDTO.extraDataFilePathList.
 * @returns {string[]} base file names, as expected by the extra-data download endpoint.
 */
export function selectExtraDataFileNames(paths) {
  return (paths ?? []).map(baseName).filter((name) => extraFileKind(name) !== null);
}

/**
 * @param {string} name - a file name.
 * @returns {'electrodes'|'inverse'|'montage'|null} the kind of file that goes with a recording,
 *   or null for any other file. The EEG viewer uses one file of each kind.
 */
export function extraFileKind(name) {
  if (isElectrodePositionFile(name)) return 'electrodes';
  if (isInverseSolutionFile(name)) return 'inverse';
  if (isMontageFile(name)) return 'montage';
  return null;
}

/**
 * Keeps one file of each kind (electrode positions, inverse solution, montage) out of the
 * files found for the loaded recording, by file name, so the ones not used never need
 * downloading.
 * - Across places, the most specific to the recording wins: pass the candidates grouped by
 *   place, most specific first (the recording's dataset => its acquisition => the examination).
 * - Within one place, the last listed wins, like a drop of several files at the EEG dropzone
 *   ("using the latest").
 *
 * @template {{ name: string, source: string }} T
 * @param {T[]} candidates - files of any kind (others are ignored), with `source` naming their
 *   place for the user, e.g. 'the examination'.
 * @returns {{ kept: T[], skipped: { name: string, source: string, reason: string }[] }}
 *   `kept`: at most one candidate per kind; `skipped`: the other candidates, each with the
 *   file used instead.
 */
export function pickOneExtraFilePerKind(candidates) {
  const winners = new Map(); // kind → the candidate used
  for (const candidate of candidates) {
    const kind = extraFileKind(candidate.name);
    if (kind === null) continue;
    const winner = winners.get(kind);
    // A later file only replaces a file from the same place: places come most specific first
    if (!winner || winner.source === candidate.source) winners.set(kind, candidate);
  }

  const kept = [...winners.values()];
  const skipped = candidates
    .filter((candidate) => extraFileKind(candidate.name) !== null && !kept.includes(candidate))
    .map(({ name, source }) => {
      const winner = winners.get(extraFileKind(name));
      return { name, source, reason: `using ${winner.name} from ${winner.source}` };
    });
  return { kept, skipped };
}
