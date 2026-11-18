// The imaging file formats VIDEPE names, grouped by type. Kept free of @niivue/niivue so
// launchFiles.js (and its tests) can use them without pulling in NiiVue — the imaging
// counterpart of src/loaders/eegFormatRegistry.js.
//
// The LISTED_ lists name the common formats, not every one that loads: a dropped/picked file is
// routed by NiiVue's own lists in filesToLayers (connectome extension → mesh via isMeshExt →
// anything else a volume), so NiiVue's dozens of other formats (.nrrd, .mha, .stl, .vtk, .trk,
// FreeSurfer's lh.pial, …) still load, as the right type. That's why the imaging file pickers
// have no accept list, and the initial dropzone adds an "Other" row (IMAGING_DROPZONE_DESCRIPTION).

export const LISTED_VOLUME_EXTENSIONS = ['.nii', '.nii.gz', '.mgh', '.mgz', '.dcm'];

// Not named MESH_EXTENSIONS: NiiVue exports one of its own (~30 mesh and tract formats), which is
// what routing actually uses.
export const LISTED_MESH_EXTENSIONS = ['.gii', '.ply', '.obj'];

// Connectome files (NiiVue's JSON connectome format: nodes + edges). Unlike the lists above this
// one is complete, and routing uses it: filesToLayers checks it before NiiVue's own isMeshExt,
// which also matches these extensions, so they're routed as connectomes instead of meshes.
export const CONNECTOME_EXTENSIONS = ['.jcon', '.json'];

// One entry per type, in the order the initial dropzone's description rows show them.
const IMAGING_FORMATS = [
  { name: 'Volume', extensions: LISTED_VOLUME_EXTENSIONS },
  { name: 'Mesh', extensions: LISTED_MESH_EXTENSIONS },
  { name: 'Connectome', extensions: CONNECTOME_EXTENSIONS },
];

// The initial imaging dropzone's description: a label/value row per type (like the EEG
// dropzone), then a row telling the user the list isn't exhaustive.
export const IMAGING_DROPZONE_DESCRIPTION = [
  ...IMAGING_FORMATS.map(({ name, extensions }) => ({
    label: `${name}:`,
    value: extensions.join(', '),
  })),
  { label: 'Other:', value: 'any format NiiVue reads (e.g. .nrrd, .mha, .stl, .vtk, .trk)' },
];

// The imaging files taken from a launch (Shanoir or a host app), which hands over everything in
// one batch, sidecars included — so unlike a drop, this is a whitelist. Every listed format
// except .json: a BIDS/Shanoir JSON sidecar would otherwise load as a (broken) connectome.
export const LAUNCH_IMAGING_EXTENSIONS = [
  ...LISTED_VOLUME_EXTENSIONS,
  ...LISTED_MESH_EXTENSIONS,
  ...CONNECTOME_EXTENSIONS.filter((ext) => ext !== '.json'),
];
