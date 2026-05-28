const MRI_BIDS_SUFFIXES = new Set([
  'T1w', 'T2w', 'FLAIR', 'PDw', 'T1map', 'T2map', 'T2star', 'T1rho',
  'PD', 'FLASH', 'angio', 'inplaneT1', 'inplaneT2', 'MTR', 'MTsat', 'MTS', 'MPM',
]);

// Detects imaging modality from a filename using BIDS suffix first, then keyword fallback.
// Returns { type, colormap } where type is 'MRI', 'PET', 'SPECT', or the bare filename.
export const detectVolumeType = (filename) => {
  // Strip everything from the first '.' onward (handles .nii.gz, .dcm, etc.)
  const dotIndex = filename.indexOf('.');
  const bare = dotIndex === -1 ? filename : filename.slice(0, dotIndex);
  const segments = bare.split('_');
  const lastSegment = segments.at(-1);

  // Pass 1: BIDS suffix (case-sensitive)
  if (MRI_BIDS_SUFFIXES.has(lastSegment)) return { type: 'MRI', colormap: 'gray' };
  if (lastSegment === 'pet') return { type: 'PET', colormap: 'viridis' };
  if (lastSegment === 'spect') return { type: 'SPECT', colormap: 'magma' };

  // Pass 2: keyword fallback (case-insensitive, for non-BIDS filenames)
  const lower = filename.toLowerCase();
  if (/t1|t2|flair|mri|mprage|bravo/.test(lower)) return { type: 'MRI', colormap: 'gray' };
  if (/pet|fdg/.test(lower)) return { type: 'PET', colormap: 'viridis' };
  if (/spect|siscom/.test(lower)) return { type: 'SPECT', colormap: 'magma' };

  return { type: bare, colormap: 'gray' };
};

export const getInitialVisibility = (volumes) => {
  const visible = volumes.map(() => true);
  const mriIndex = volumes.findIndex((volume) => volume.type === 'MRI');
  const petIndex = volumes.findIndex((volume) => volume.type === 'PET');
  if (mriIndex !== -1 && petIndex !== -1) {
    visible[petIndex] = false;
  }
  return visible;
};

export const applyToggle = (volumes, visible, index) => {
  const next = [...visible];
  next[index] = !next[index];

  // MRI and PET are mutually exclusive — turning one on turns the other off
  const type = volumes[index]?.type;
  if (next[index] && (type === 'MRI' || type === 'PET')) {
    const linkedType = type === 'MRI' ? 'PET' : 'MRI';
    const linkedIndex = volumes.findIndex((volume) => volume.type === linkedType);
    if (linkedIndex !== -1) next[linkedIndex] = false;
  }

  return next;
};
