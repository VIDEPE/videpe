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
// actual bounds so a fraction can be converted to a real value:
//  - ESI layers: boundMin/boundMax come straight off the layer (see
//    convertSourcePowersToConnectome/convertSourcePowersToVolume) — power is always
//    non-negative and boundMax is the observed ceiling for the current click.
//  - Regular volumes: bounds come from NiiVue's own robust_min/robust_max (percentile-
//    clipped range) on the loaded NVImage — global_min/global_max would let one outlier
//    voxel blow out the whole scale.
export function getCalBounds(layer, nvVolume) {
  if (layer.url === ESI_LAYER_URL) return { boundMin: layer.boundMin, boundMax: layer.boundMax };
  return { boundMin: nvVolume?.robust_min ?? 0, boundMax: nvVolume?.robust_max ?? 1 };
}

// Converts a 0-1 Threshold-slider fraction into a real cal_min/cal_max value within [boundMin, boundMax].
export function fractionToCalValue(fraction, boundMin, boundMax) {
  return boundMin + fraction * (boundMax - boundMin);
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
  }

  // nv.volumes now matches layers 1:1, so settings can be applied by index directly.
  layerSettings.forEach((layerSetting, index) => {
    const nvVolume = nv.volumes[index];
    nv.setColormap(nvVolume.id, layerSetting.colormap);
    nv.setOpacity(index, layerSetting.visible ? layerSetting.opacity : 0);
    if (layerSetting.invert) nvVolume.colormapInvert = true;
    nvVolume.colorbarVisible = layerSetting.showColorbar;
    // Applied after setColormap, same requirement as the ESI volume build effect below:
    // setColormap's internal updateGLVolume() re-triggers NiiVue's own cal_min/cal_max
    // auto-scan, which would otherwise silently overwrite these right after they're set.
    const { boundMin, boundMax } = getCalBounds(layers[index], nvVolume);
    nvVolume.cal_min = fractionToCalValue(layerSetting.cal_min, boundMin, boundMax);
    nvVolume.cal_max = fractionToCalValue(layerSetting.cal_max, boundMin, boundMax);
  });
  nv.opts.isColorbar = layerSettings.some((layerSetting) => layerSetting.showColorbar);
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
