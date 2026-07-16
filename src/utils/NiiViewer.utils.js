import { isMeshExt } from '@niivue/niivue';

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

// True for layers backed by an entry in nv.volumes (not connectomes/meshes, which live in
// nv.meshes). Used to index into nv.volumes and to decide reorderability: only volumes are
// reorderable, since meshes/connectomes have no z-order and are pinned to the bottom. The ESI
// layer follows its current kind — 'volume' in Volume mode, 'connectome' in Connectome mode.
export const isImageVolumeLayer = (layer) => layer.kind !== 'connectome' && layer.kind !== 'mesh';

// Returns default display settings, one per layer. Colormap is derived from layer.type
// (layers carry no colormap field). Each entry mirrors its layer's url so effects can locate
// a specific layer's settings by url rather than array position, which is fragile when
// orderedLayers/layerSettings are updated independently. startIndex is layers[0]'s position
// among all loaded layers — pass the already-loaded count when appending so only the very
// first layer overall gets full opacity.
export const getInitialLayerSettings = (layers, startIndex = 0) =>
  layers.map((layer, index) => ({
    url: layer.url,
    visible: true,
    opacity: startIndex + index === 0 ? 1.0 : 0.6, // first loaded layer is fully opaque, others slightly transparent by default
    colormap: TYPE_COLORMAP_DEFAULTS[layer.type] ?? 'gray',
    invert: false,
    showColorbar: false,
    isEsiVolume: true,
    // The Threshold slider's floor always allows dragging down to 0 (so users can always
    // see every power value, however low — see getCalBounds in NiiViewer.jsx), but the
    // ESI layer starts at a small positive default instead of 0: NiiVue's transparent-
    // below-threshold shader ramp only kicks in when cal_min > 0, so a literal 0 would
    // leave the whole ESI volume opaque on first render. Other volumes have no such
    // shader quirk, so they default to showing everything (0) with no thresholding.
    cal_min: layer.url === ESI_LAYER_URL ? 0.01 : 0,
    cal_max: 1,
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

// Strips the extension(s) from a filename for use as a mesh layer's subtype — mirrors
// detectVolumeType's nameWithoutExtension so a mesh card reads e.g. "Mesh - cortex".
const nameWithoutExtension = (filename) => {
  const dotIndex = filename.indexOf('.');
  return dotIndex === -1 ? filename : filename.slice(0, dotIndex);
};

export const filesToLayers = (files) =>
  // Convert a FileList (from input or drag-and-drop) to an array of layer objects with
  // { url, name, type, subtype } for image volumes, plus { kind: 'mesh' } for surface meshes.
  Array.from(files).map((f) => {
    // NiiVue calls fetch(url) internally, so a blob: URL is needed — a plain filename would resolve as a relative HTTP request
    const url = URL.createObjectURL(f);
    // Surface meshes (GIFTI/PLY/OBJ/STL/…) are rendered as 3D meshes, not sliceable volumes,
    // so they take a different load path in NiiViewer (nv.addMeshesFromUrl vs nv.loadVolumes).
    // Tag them with kind: 'mesh' here so both drop entry points can route them correctly.
    // isMeshExt is NiiVue's own extension check, so this list stays in sync with what it can parse.
    if (isMeshExt(f.name)) {
      return {
        url,
        name: f.name,
        type: 'Mesh',
        subtype: nameWithoutExtension(f.name),
        kind: 'mesh',
      };
    }
    const { type, subtype } = detectVolumeType(f.name);
    return { url, name: f.name, type, subtype };
  });
