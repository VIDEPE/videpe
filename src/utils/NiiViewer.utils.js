import { isMeshExt, isDicomExtension } from '@niivue/niivue';

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

// Every other layer is identified by its file's blob: URL.
// The electrode connectome isn't loaded from a file — it's built in memory from EEG
// data — so it has no real URL. This fixed string stands in for one, letting the
// connectome be tracked, reordered, and deleted the same way as any other layer.
export const ELECTRODE_LAYER_URL = '__electrodes__';

// Same sentinel-URL pattern for the ESI source-power connectome/volume layer.
export const ESI_LAYER_URL = '__esi-source-power__';

// True for layers backed by an entry in nv.volumes (not connectomes/meshes, which live in
// nv.meshes). Used to index into nv.volumes and to decide reorderability: only volumes are
// reorderable, since meshes/connectomes have no z-order and are pinned to the bottom. The ESI
// layer follows its current kind — 'volume' in Volume mode, 'connectome' in Connectome mode.
export const isImageVolumeLayer = (layer) => layer.kind !== 'connectome' && layer.kind !== 'mesh';

// Connectome node/edge scale defaults — exported so ImagingControls can mark each slider's
// reset point without the marker and the actual default drifting apart from each other.
export const DEFAULT_NODE_SCALE = 4;
export const DEFAULT_EDGE_SCALE = 0.5;

// Returns default display settings, one per layer. Settings are keyed by the layer's url
// (not array position, which shifts as layers are added/reordered). startIndex is where
// `layers` starts among all loaded layers, so only the very first layer overall gets full
// opacity. currentMeshXRay seeds the meshXRay field: pass 1 for a scene's first mesh/
// connectome, or getCurrentMeshXRay(...) when appending to an already-populated scene.
export const getInitialLayerSettings = (
  layers,
  startIndex = 0,
  isEsiVolumeMode,
  currentMeshXRay = 1
) =>
  layers.map((layer, index) => ({
    url: layer.url, // identifier to link this settings entry to its layer, since array position can shift
    visible: true, // eye-toggle state — hidden layers get their opacity forced to 0 downstream
    opacity: startIndex + index === 0 ? 1.0 : 0.6, // first loaded layer is fully opaque, others slightly transparent by default
    meshXRay: currentMeshXRay, // shared across all mesh/connectome layers
    nodeScale: DEFAULT_NODE_SCALE, // connectome-only — radius multiplier for node spheres, per-layer (unlike meshXRay)
    edgeScale: DEFAULT_EDGE_SCALE, // connectome-only — radius multiplier for edge tubes, per-layer (unlike meshXRay)
    colormap: TYPE_COLORMAP_DEFAULTS[layer.type] ?? 'gray', // NiiVue colormap key, defaulted by modality
    invert: false, // flips the colormap direction (dark-to-light vs light-to-dark)
    showColorbar: false, // whether this layer's colorbar legend is drawn on the canvas
    ...(layer.url === ESI_LAYER_URL ? { isEsiVolume: isEsiVolumeMode } : {}), // ESI layer's Connectome/Volume mode toggle
    // The Threshold slider's floor always allows dragging down to 0 (so users can always
    // see every power value, however low — see getCalBounds in NiiViewer.jsx), but the
    // ESI layer starts at a small positive default instead of 0: NiiVue's transparent-
    // below-threshold shader ramp only kicks in when cal_min > 0, so a literal 0 would
    // leave the whole ESI volume opaque on first render. Other volumes have no such
    // shader quirk, so they default to showing everything (0) with no thresholding.
    cal_min: layer.url === ESI_LAYER_URL ? 0.01 : 0,
    cal_max: 1,
    ...(layer.url === ELECTRODE_LAYER_URL ? { electrodeDisplayMode: 'none' } : {}), // Electrodes layer's display-mode dropdown
  }));

// Finds the meshXRay value already active in the scene, from any existing mesh/connectome
// layer's settings (they're always kept in sync with each other and with nv.opts.meshXRay —
// see handleSettingChange's meshXRay special-case in NiiViewer.jsx). Pass the result into
// getInitialLayerSettings when appending a new mesh/connectome layer, so it joins at the
// current value instead of resetting the scene back to the default.
export function getCurrentMeshXRay(layers, layerSettings) {
  const index = layers.findIndex((layer) => !isImageVolumeLayer(layer));
  return index === -1 ? 1 : layerSettings[index].meshXRay;
}

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

// NiiVue cal_min/cal_max values depend on the specific volume/source-power data values, so a
// percentile 0-1 slider value would be meaningless applied directly. getCalBounds() resolves a layer's
// actual bounds so a fraction can be converted to a real value
export function getCalBounds(layer, nvVolume, colormapValue) {
  // for ESI layers use the predetermined bounds calculated for that layer
  if (layer.url === ESI_LAYER_URL) {
    return { boundMin: layer.boundMin, boundMax: layer.boundMax };
  }
  // if colormap is random, use the global_min/max to set the cal_min/max to ensure each index gets a random number
  if (colormapValue === 'random') {
    return { boundMin: nvVolume?.global_min ?? 0, boundMax: nvVolume?.global_max ?? 1 };
  }
  // for all the other colormaps it is better to use the robost_min/max to avoid blown out values
  return { boundMin: nvVolume?.robust_min ?? 0, boundMax: nvVolume?.robust_max ?? 1 };
}

// Source - https://stackoverflow.com/a/9493060
// Posted by Mohsen, modified by community. See post 'Timeline' for change history
// Retrieved 2026-09-17, License - CC BY-SA 4.0
/**
 * Converts an HSL color value to RGB. Conversion formula
 * adapted from https://en.wikipedia.org/wiki/HSL_color_space.
 * Assumes h, s, and l are contained in the set [0, 1] and
 * returns r, g, and b in the set [0, 255].
 *
 * @param   {number}  h       The hue
 * @param   {number}  s       The saturation
 * @param   {number}  l       The lightness
 * @return  {Array}           The RGB representation
 */
function hslToRgb(h, s, l) {
  let r, g, b;

  if (s === 0) {
    r = g = b = l; // achromatic
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hueToRgb(p, q, h + 1 / 3);
    g = hueToRgb(p, q, h);
    b = hueToRgb(p, q, h - 1 / 3);
  }

  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function hueToRgb(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

// Volumes always render through a fixed 256-entry LUT texture, so a random per-label colormap
// is capped at 256 distinct labels. Each of the 256 slots gets the color of whichever label
// value would normalize to that slot (inverting NiiVue's own value->slot formula), so a label
// gets a consistent color instead of a gradient bleeding into its neighbors.
export const MAX_RANDOM_COLORMAP_LABELS = 256;

export function makeRandomColormap(minIndex, maxIndex) {
  const nLabels = maxIndex - minIndex + 1;
  const labelColors = Array.from({ length: nLabels }, () => hslToRgb(Math.random(), 1, 0.5));

  const R = [];
  const G = [];
  const B = [];
  const I = [];
  for (let lutSlot = 0; lutSlot < MAX_RANDOM_COLORMAP_LABELS; lutSlot++) {
    const labelValue = Math.round(minIndex + (lutSlot / 255) * (maxIndex - minIndex));
    const [red, green, blue] = labelColors[labelValue - minIndex];
    R.push(red);
    G.push(green);
    B.push(blue);
    I.push(lutSlot);
  }
  return { R, G, B, I };
}

// 'random' is registered as a one-off named colormap per volume (nv.setColormap only resolves
// by name); everything else goes straight through as a real NiiVue colormap name.
export function applyColormap(nv, nvVolume, colormapValue) {
  if (colormapValue === 'random') {
    const colormapKey = `random-${nvVolume.id}`;
    nv.addColormap(colormapKey, makeRandomColormap(nvVolume.global_min, nvVolume.global_max));
    nv.setColormap(nvVolume.id, colormapKey);
  } else {
    nv.setColormap(nvVolume.id, colormapValue);
  }
}

// Converts a 0-1 Threshold-slider fraction into a real cal_min/cal_max value within [boundMin, boundMax].
export function fractionToCalValue(fraction, boundMin, boundMax) {
  return boundMin + fraction * (boundMax - boundMin);
}

// NiiVue's own colorbar-drawing logic only ever checks a volume/mesh's colorbarVisible flag,
// never its opacity or visibility. This caused the bug that a hidden layer still showed
// the colorbar if it was toggled. isAnyColorBarActive is a scene wide master switch that checks
// if both the showColorBar toggle and the visibility toggle are active at the same time for any layer.
// If not, the NiiVue global show colorbar setting is deactivated
export function isAnyColorbarActive(layerSettings) {
  return layerSettings.some((layerSetting) => layerSetting.showColorbar && layerSetting.visible);
}

// Loads only new image volumes into nv (existing ones stay) and applies all settings.
// Connectome/mesh layers are excluded — they're tracked separately by the build effects.
export async function syncVolumesAndApplySettings(nv, layers, layerSettings) {
  const indexOffset = nv.volumes.length; // Volumes before this index are already loaded into nv.
  const newLayers = layers.slice(indexOffset);
  if (newLayers.length > 0) {
    if (indexOffset === 0) {
      await nv.loadVolumes(newLayers);
    } else {
      await nv.addVolumesFromUrl(newLayers);
    }
    // nv now has its own copy of the data — the blob: URL is redundant, so free it now.
    revokeLayerUrls(newLayers);
  }

  // nv.volumes now matches layers 1:1, so settings can be applied by index directly.
  layerSettings.forEach((layerSetting, index) => {
    const nvVolume = nv.volumes[index];
    applyColormap(nv, nvVolume, layerSetting.colormap);
    nv.setOpacity(index, layerSetting.visible ? layerSetting.opacity : 0);
    if (layerSetting.invert) nvVolume.colormapInvert = true;
    // A hidden layer must not keep drawing its colorbar even if showColorbar is on — see
    // isAnyColorbarActive above.
    nvVolume.colorbarVisible = layerSetting.showColorbar && layerSetting.visible;
    // Applied after setColormap, same requirement as the ESI volume build effect below:
    // setColormap's internal updateGLVolume() re-triggers NiiVue's own cal_min/cal_max
    // auto-scan, which would otherwise silently overwrite these right after they're set.
    const { boundMin, boundMax } = getCalBounds(layers[index], nvVolume);
    nvVolume.cal_min = fractionToCalValue(layerSetting.cal_min, boundMin, boundMax);
    nvVolume.cal_max = fractionToCalValue(layerSetting.cal_max, boundMin, boundMax);
  });
  nv.opts.isColorbar = isAnyColorbarActive(layerSettings);
  // GL redraw to apply settings
  nv.updateGLVolume();
}

// Loads only new surface meshes into nv (existing ones stay) and applies their opacity/
// visibility. meshMap tracks the file meshes already in the scene, keyed by their layer url —
// unlike volumes, nv.meshes can't be indexed positionally because it also holds connectome
// meshes built by the ESI/intracranial effects, so a url→mesh map is what distinguishes
// "already loaded" file meshes from new ones. Meshes carry no colormap/threshold controls
// (they render with their own baked-in vertex colors), so only opacity/visibility apply.
export async function syncMeshesAndApplySettings(nv, meshLayers, meshLayerSettings, meshMap) {
  if (meshLayers.length === 0) return; // nothing to load or redraw for

  const newLayers = meshLayers.filter((layer) => !meshMap.has(layer.url));
  if (newLayers.length > 0) {
    // name (with its extension) is essential: the blob: url alone has no extension for NiiVue
    // to detect the mesh format from, so it's forwarded alongside the url.
    const addedMeshes = await nv.addMeshesFromUrl(
      newLayers.map((layer) => ({ url: layer.url, name: layer.name }))
    );
    // addMeshesFromUrl returns the created meshes in input order — record each by its layer url.
    newLayers.forEach((layer, i) => meshMap.set(layer.url, addedMeshes[i]));
    // Same as syncVolumesAndApplySettings — nv has its own copy now, free the blob: URL.
    revokeLayerUrls(newLayers);
  }

  // Apply visibility/opacity to every file mesh (0 opacity is how a hidden mesh is
  // represented, same convention as image volumes and connectome meshes).
  meshLayers.forEach((layer, index) => {
    const mesh = meshMap.get(layer.url);
    if (!mesh) return;
    const setting = meshLayerSettings[index];
    mesh.opacity = setting.visible ? setting.opacity : 0;
    // nv.opts.meshXRay is a scene-global NiiVue option, not a per-mesh property, and NiiVue's
    // own default (0) doesn't match this app's default (1, see getInitialLayerSettings) — apply
    // it here on load, or the card's slider would show 100% while the mesh actually renders
    // opaque until the user drags the slider once.
    nv.opts.meshXRay = setting.meshXRay;
  });
  nv.updateGLVolume();
}

// Strips the extension(s) from a filename for use as a mesh layer's subtype — mirrors
// detectVolumeType's nameWithoutExtension so a mesh card reads e.g. "Mesh - cortex".
const nameWithoutExtension = (filename) => {
  const dotIndex = filename.indexOf('.');
  return dotIndex === -1 ? filename : filename.slice(0, dotIndex);
};

// Pure updater functions for merging a connectome layer into orderedLayers/layerSettings
// by its sentinel URL. Used by both the intracranial and ESI connectome hooks. Five possible
// cases, based on whether `layer` is present and whether an entry already exists at `sentinelUrl`:
//   no layer   + not present  → no-op
//   no layer   + present      → remove it
//   has layer  + not present  → append it
//   has layer  + present, same object      → no-op (data unchanged)
//   has layer  + present, different object → replace it in place
export function makeLayerMergeUpdater(layer, sentinelUrl) {
  return (prevLayers) => {
    const existingIndex = prevLayers.findIndex((l) => l.url === sentinelUrl);
    const alreadyPresent = existingIndex !== -1;

    if (!layer) {
      // Nothing to show — remove the existing entry, or leave the array as-is if there wasn't one.
      return alreadyPresent ? prevLayers.filter((_, i) => i !== existingIndex) : prevLayers;
    }

    if (!alreadyPresent) {
      // First appearance — append as a new layer.
      return [...prevLayers, layer];
    }

    if (prevLayers[existingIndex] === layer) {
      // Same object reference — data hasn't changed, avoid an unnecessary update.
      return prevLayers;
    }

    // Data changed — replace the existing entry in place, preserving its position.
    const next = prevLayers.slice();
    next[existingIndex] = layer;
    return next;
  };
}

// Same merge-by-sentinel-URL logic as makeLayerMergeUpdater, but for the parallel layerSettings
// array — kept as a separate function since "present" here means "has a settings entry", and a
// data-only refresh (layer present in both) must leave the user's existing settings untouched
// rather than overwrite them.
export function makeSettingsMergeUpdater(layer, sentinelUrl, isEsiVolumeMode, currentMeshXRay) {
  return (prevSettings) => {
    const existingIndex = prevSettings.findIndex((s) => s.url === sentinelUrl);
    const alreadyPresent = existingIndex !== -1;

    if (!layer) {
      // Nothing to show — remove its settings entry, or leave the array as-is if there wasn't one.
      return alreadyPresent ? prevSettings.filter((_, i) => i !== existingIndex) : prevSettings;
    }

    if (alreadyPresent) {
      // Already has a settings entry — a data-only refresh (e.g. new sourcePowers) never touches
      // user-chosen settings like opacity/visibility, so leave it untouched.
      return prevSettings;
    }

    // First appearance — seed default settings for it.
    return [
      ...prevSettings,
      ...getInitialLayerSettings([layer], prevSettings.length, isEsiVolumeMode, currentMeshXRay),
    ];
  };
}

// A DICOM series is many files (one per slice) representing a single volume, not one file per
// layer like every other supported format, so dropped .dcm files are pulled out and converted
// as a group instead of going through the same one-file-to-one-layer map as everything else.
// isDicomExtension is NiiVue's own check (ext.toUpperCase() === 'DCM'), which misses DICOM
// files with no extension at all — common in PACS exports (e.g. "IM000001"). Those fall back
// to a DICOM magic-bytes check instead; files with a real (non-.dcm) extension are trusted and
// skip that fallback entirely, so the extra read only happens where it's actually needed.
async function isDicomFile(file) {
  // Extension check
  const extension = file.name.split('.').pop() ?? '';
  if (isDicomExtension(extension)) return true; // extension says it's a DICOM file

  // split('.').pop() returns the whole filename unchanged when there's no '.' at all, so
  // extension === file.name means "no extension". Anything else is a real (non-.dcm)
  // extension, which we trust outright => not a DICOM file.
  if (extension !== file.name) return false;

  // If the file doesn't have an extension it could still be a DICOM file
  // DICOM magic bytes check:
  // DICOM files follow the "Part 10" medical image file format and have a fixed structure at the start of the file:
  // Bytes 0–127 (Preamble): 128 bytes usually set to 0x00 (ignored for file identification).
  // Bytes 128–131 (Magic Bytes): 4 bytes ASCII string
  // 132+ (Data Set): File meta information and encoded medical dataset elements.
  // byte offset:  0                                    128        132
  //               ———————————————————————————————————— —————————— ———————————————————
  //               │ 128-byte preamble (usually zeros) │  "DICM"  │  actual DICOM data...
  //               ———————————————————————————————————— —————————— ———————————————————
  const buf = await file.slice(128, 132).arrayBuffer();
  const bytes = new Uint8Array(buf);
  const magicBytes = String.fromCharCode(...bytes); // 'DICM'
  if (magicBytes === 'DICM') return true; // magicBytes indicate it is a DICOM file => return true

  // all DICOM checks failed => not a DICOM file
  return false;
}

// Runs dcm2niix (WASM, via @niivue/dicom-loader) on a group of .dcm files and turns each
// resulting NIfTI into an image-volume layer, same shape as a regular file drop. dcm2niix
// splits multiple series back out on its own, so a folder containing several series still
// produces one layer per series.
async function dicomFilesToLayers(dicomFiles) {
  const { dicomLoader } = await import('@niivue/dicom-loader');
  const converted = await dicomLoader(dicomFiles);
  return converted.map(({ name, data }) => {
    const url = URL.createObjectURL(new Blob([data]));
    const { type, subtype } = detectVolumeType(name);
    return { url, name, type, subtype };
  });
}

export async function filesToLayers(files) {
  // Convert a FileList (from input or drag-and-drop) to an array of layer objects with
  // { url, name, type, subtype } for image volumes, plus { kind: 'mesh' } for surface meshes.
  const fileArray = Array.from(files);
  const dicomFlags = await Promise.all(fileArray.map(isDicomFile)); // real true/false values, resolved

  const dicomFiles = fileArray.filter((f, i) => dicomFlags[i]);
  const otherLayers = fileArray
    .filter((f, i) => !dicomFlags[i])
    .map((f) => {
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

  const dicomLayers = dicomFiles.length > 0 ? await dicomFilesToLayers(dicomFiles) : [];
  return [...otherLayers, ...dicomLayers];
}

// Frees the blob: URLs backing dropped-file layers. Called right after nv loads a layer
// (redundant by then) and defensively wherever a layer is discarded (failed load, deleted
// card, unmount). Re-revoking is a harmless no-op; non-blob (sentinel/demo) URLs are skipped.
export function revokeLayerUrls(layers) {
  for (const layer of layers) {
    if (layer.url?.startsWith('blob:')) URL.revokeObjectURL(layer.url);
  }
}
