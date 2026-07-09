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
  'Electrical Source Imaging': 'inferno',
};

// Every other layer is identified by its file's blob: URL. The intracranial
// electrode connectome isn't loaded from a file — it's built in memory from EEG
// data — so it has no real URL. This fixed string stands in for one, letting the
// connectome be tracked, reordered, and deleted the same way as any other layer.
export const INTRACRANIAL_CONNECTOME_URL = '__intracranial-electrodes__';

// Same sentinel-URL pattern for the ESI source-power connectome/volume layer.
export const ESI_LAYER_URL = '__esi-source-power__';

// Returns an array of display settings, one per layer (image volume, connectome, or
// other mesh). Colormap is derived from layer.type via TYPE_COLORMAP_DEFAULTS — layers
// themselves do not carry a colormap field.
// url mirrors the owning layer's url so settings entries carry their own identity —
// letting effects filter/locate a specific layer's settings (e.g. the connectome's) by
// url instead of by array position, which is fragile when orderedLayers/layerSettings
// are updated independently by more than one effect.
// startIndex is the position of layers[0] among all loaded layers — pass the count of
// already-loaded layers when appending so only the very first layer overall gets full opacity.
export const getInitialLayerSettings = (layers, startIndex = 0) =>
  layers.map((layer, index) => ({
    url: layer.url,
    visible: true,
    opacity: startIndex + index === 0 ? 1.0 : 0.6, // first loaded layer is fully opaque, others slightly transparent by default
    colormap: TYPE_COLORMAP_DEFAULTS[layer.type] ?? 'gray',
    invert: false,
    showColorbar: false,
    isEsiVolume: true,
  }));

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
  if (/t1|t2|flair|mri|mprage|bravo/.test(lower))
    return { type: 'MRI', subtype: nameWithoutExtension };
  if (/pet|fdg/.test(lower)) return { type: 'PET', subtype: nameWithoutExtension };
  if (/spect|siscom/.test(lower)) return { type: 'SPECT', subtype: nameWithoutExtension };

  return { type: nameWithoutExtension, subtype: null };
};

export const filesToLayers = (files) =>
  // Convert a FileList (from input or drag-and-drop) to an array of layer objects with { url, name, type, subtype }.
  Array.from(files).map((f) => {
    // NiiVue calls fetch(url) internally, so a blob: URL is needed — a plain filename would resolve as a relative HTTP request
    const { type, subtype } = detectVolumeType(f.name);
    return { url: URL.createObjectURL(f), name: f.name, type, subtype };
  });
