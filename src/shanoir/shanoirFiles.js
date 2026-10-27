import { baseName, isElectrodePositionFile, isInverseSolutionFile } from '@/utils/launchFiles';

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
