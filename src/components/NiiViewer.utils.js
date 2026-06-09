const MRI_BIDS_SUFFIXES = new Set([
  'T1w',
  'T2w',
  'FLAIR',
  'PDw',
  'T1map',
  'T2map',
  'T2star',
  'T1rho',
  'PD',
  'FLASH',
  'angio',
  'inplaneT1',
  'inplaneT2',
  'MTR',
  'MTsat',
  'MTS',
  'MPM',
]);

// Single source of truth for type → default colormap mapping.
export const TYPE_COLORMAP_DEFAULTS = {
  MRI: 'gray',
  PET: 'viridis',
  SPECT: 'magma',
};

// Detects imaging modality from a filename using BIDS suffix first, then keyword fallback.
// Returns { type, subtype } where type is 'MRI', 'PET', 'SPECT', or nameWithoutExtension for unknowns.
// subtype is the BIDS suffix for MRI (e.g. 'T1w', 'T2star'), nameWithoutExtension for PET/SPECT/keyword matches, null for unknowns.
export const detectVolumeType = (filename) => {
  // Strip everything from the first '.' onward (handles .nii.gz, .dcm, etc.)
  const dotIndex = filename.indexOf('.');
  const nameWithoutExtension = dotIndex === -1 ? filename : filename.slice(0, dotIndex);
  const lastSegment = nameWithoutExtension.split('_').at(-1);
  const lower = filename.toLowerCase();

  // Pass 1: BIDS suffix (case-sensitive) — all use nameWithoutExtension as subtype for consistency
  if (MRI_BIDS_SUFFIXES.has(lastSegment)) return { type: 'MRI', subtype: nameWithoutExtension };
  if (lastSegment === 'pet') return { type: 'PET', subtype: nameWithoutExtension };
  if (lastSegment === 'spect') return { type: 'SPECT', subtype: nameWithoutExtension };

  // Pass 2: keyword fallback (case-insensitive, for non-BIDS filenames) — use nameWithoutExtension as subtype so files are distinguishable in the UI
  if (/t1|t2|flair|mri|mprage|bravo/.test(lower)) return { type: 'MRI', subtype: nameWithoutExtension };
  if (/pet|fdg/.test(lower)) return { type: 'PET', subtype: nameWithoutExtension };
  if (/spect|siscom/.test(lower)) return { type: 'SPECT', subtype: nameWithoutExtension };

  return { type: nameWithoutExtension, subtype: null };
};

// Returns an array of display settings, one per layer (volume or mesh).
// Colormap is derived from volume.type via TYPE_COLORMAP_DEFAULTS — volumes themselves
// do not carry a colormap field.
export const getInitialLayerSettings = (volumes) =>
  volumes.map((volume, index) => ({
    visible: true,
    opacity: index === 0 ? 1.0 : 0.6, // first loaded layer is fully opaque, others slightly transparent by default
    colormap: TYPE_COLORMAP_DEFAULTS[volume.type] ?? 'gray',
    invert: false,
    showColorbar: false,
  }));
