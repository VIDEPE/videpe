// Single source of truth for NiiViewer's layer list: every layer together with its own display
// settings, in display order, addressed by url (never by array position).
//
// This replaces two parallel arrays (orderedLayers + layerSettings) that were only linked by
// index and written from many places with mixed absolute/updater/deferred setState calls —
// any write landing out of step crossed the two arrays, so one layer read another's settings
// (e.g. the electrode mesh reading the ESI layer's settings and rebuilding empty). Here every
// change goes through layerReducer, which applies it to the latest state and re-establishes
// the invariants afterwards:
//   - urls are unique, and every entry's settings.url matches its own url
//   - image volumes come before meshes/connectomes (stable — each group keeps its own order)
//   - meshXRay is shared: equal across every mesh/connectome entry
//
// State shape:
//   { entries: [{ url, layer, settings }], lastEsiVolumeMode }
// lastEsiVolumeMode is the ESI Connectome/Volume mode the user last chose. It outlives the ESI
// entry itself, so a deleted-then-regenerated ESI layer comes back in the same mode.

import {
  getInitialLayerSettings,
  isImageVolumeLayer,
  DEFAULT_MESH_XRAY,
  ELECTRODE_LAYER_URL,
  ESI_LAYER_URL,
} from '@/utils/NiiViewer.utils';

// ─── Action types ───────────────────────────────────────────────────────────────
export const LOAD_FILE_LAYERS = 'LOAD_FILE_LAYERS'; // { layers } — replace all file layers, keep electrode/ESI
export const APPEND_FILE_LAYERS = 'APPEND_FILE_LAYERS'; // { layers } — add file layers after the existing ones
export const REMOVE_LAYERS = 'REMOVE_LAYERS'; // { urls }
export const UPSERT_SENTINEL = 'UPSERT_SENTINEL'; // { url, layer } — add / replace / (layer null) remove electrode or ESI
export const REORDER = 'REORDER'; // { urls } — new display order
export const UPDATE_SETTINGS = 'UPDATE_SETTINGS'; // { url, patch }

// Layers that aren't loaded from files but built in memory from EEG data, each owned by its
// own hook (useElectrodeConnectome / useEsiLayer) and identified by a fixed sentinel url.
const SENTINEL_URLS = [ELECTRODE_LAYER_URL, ESI_LAYER_URL];
const isSentinelUrl = (url) => SENTINEL_URLS.includes(url);

// ─── Selectors ──────────────────────────────────────────────────────────────────
export const selectOrderedLayers = (state) => state.entries.map((entry) => entry.layer);
export const selectLayerSettings = (state) => state.entries.map((entry) => entry.settings);
export const selectEntry = (state, url) => state.entries.find((entry) => entry.url === url);

// A layer's index in nv.volumes: only image volumes occupy a slot there (meshes/connectomes live
// in nv.meshes), so count the image-volume entries before it. -1 if the url isn't an image volume.
export function selectNvVolumeIndex(state, url) {
  const index = state.entries.findIndex((entry) => entry.url === url);
  if (index === -1 || !isImageVolumeLayer(state.entries[index].layer)) return -1;
  return state.entries.slice(0, index).filter((entry) => isImageVolumeLayer(entry.layer)).length;
}

// The meshXRay already active in the scene (shared by every mesh/connectome), so a newly added
// one joins at that value instead of resetting the scene to the default.
function currentMeshXRay(entries) {
  const meshEntry = entries.find((entry) => !isImageVolumeLayer(entry.layer));
  return meshEntry ? meshEntry.settings.meshXRay : DEFAULT_MESH_XRAY;
}

// Default settings for layers joining at position startIndex (only the very first layer overall
// is fully opaque). Every default is created here — callers never seed their own fallback.
function makeEntries(layers, startIndex, state, entriesForXRay) {
  const meshXRay = currentMeshXRay(entriesForXRay);
  return layers.map((layer, i) => {
    // The ESI layer's mode (and its 0.9 volume-mode opacity) follows the last chosen mode.
    const isEsiVolumeMode = layer.url === ESI_LAYER_URL ? state.lastEsiVolumeMode : undefined;
    const [settings] = getInitialLayerSettings([layer], startIndex + i, isEsiVolumeMode, meshXRay);
    return { url: layer.url, layer, settings };
  });
}

// Volumes first, then meshes/connectomes. Image volumes are reorderable; meshes/connectomes
// aren't (they have no z-order relative to the 2D slices), so they cluster at the bottom of the
// card list, which makes that clear. Each group keeps its own order, so the user's volume
// ordering (which mirrors nv.volumes) survives. Returns the same array when already in order.
function sortVolumesFirst(entries) {
  const volumes = entries.filter((entry) => isImageVolumeLayer(entry.layer));
  const others = entries.filter((entry) => !isImageVolumeLayer(entry.layer));
  const sorted = [...volumes, ...others];
  return sorted.every((entry, i) => entry === entries[i]) ? entries : sorted;
}

// Returns state unchanged (same object) when entries didn't change, so React can skip the render.
function withEntries(state, entries) {
  const sorted = sortVolumesFirst(entries);
  return sorted === state.entries ? state : { ...state, entries: sorted };
}

// ─── Reducer ────────────────────────────────────────────────────────────────────
export function layerReducer(state, action) {
  switch (action.type) {
    case LOAD_FILE_LAYERS: {
      // Electrode/ESI entries aren't part of the `layers` prop — keep them, with their settings.
      const kept = state.entries.filter((entry) => isSentinelUrl(entry.url));
      // New file layers start at index 0, so the first one is fully opaque again.
      const fileEntries = makeEntries(action.layers, 0, state, kept);
      return withEntries(state, [...fileEntries, ...kept]);
    }

    case APPEND_FILE_LAYERS: {
      const added = makeEntries(action.layers, state.entries.length, state, state.entries);
      return withEntries(state, [...state.entries, ...added]);
    }

    case REMOVE_LAYERS: {
      const urls = new Set(action.urls);
      if (!state.entries.some((entry) => urls.has(entry.url))) return state;
      return withEntries(
        state,
        state.entries.filter((entry) => !urls.has(entry.url))
      );
    }

    case UPSERT_SENTINEL: {
      const { url, layer } = action;
      const index = state.entries.findIndex((entry) => entry.url === url);
      if (!layer) {
        // Nothing to show — remove the entry, or leave state as-is if there wasn't one.
        if (index === -1) return state;
        return withEntries(
          state,
          state.entries.filter((_, i) => i !== index)
        );
      }
      if (index === -1) {
        // First appearance — append with fresh defaults.
        const added = makeEntries([layer], state.entries.length, state, state.entries);
        return withEntries(state, [...state.entries, ...added]);
      }
      // Same object — data unchanged, nothing to do.
      if (state.entries[index].layer === layer) return state;
      // Data refresh — swap the layer, keep the user's settings for it. (The ESI layer may change
      // kind here, volume ↔ connectome, which sortVolumesFirst then moves to the right group.)
      const entries = state.entries.slice();
      entries[index] = { ...entries[index], layer };
      return withEntries(state, entries);
    }

    case REORDER: {
      const byUrl = new Map(state.entries.map((entry) => [entry.url, entry]));
      const reordered = action.urls.map((url) => byUrl.get(url)).filter(Boolean);
      // Anything the new order didn't mention keeps its place at the end, rather than vanishing.
      const rest = state.entries.filter((entry) => !action.urls.includes(entry.url));
      return withEntries(state, [...reordered, ...rest]);
    }

    case UPDATE_SETTINGS: {
      const { url, patch } = action;
      if (!state.entries.some((entry) => entry.url === url)) return state;
      const { meshXRay, ...ownPatch } = patch;
      const entries = state.entries.map((entry) => {
        let settings = entry.settings;
        if (entry.url === url) settings = { ...settings, ...ownPatch };
        // meshXRay maps to one scene-global NiiVue option, so it's written onto every
        // mesh/connectome entry — not just the one whose slider moved — or their cards drift.
        if (meshXRay !== undefined && !isImageVolumeLayer(entry.layer)) {
          settings = { ...settings, meshXRay };
        }
        return settings === entry.settings ? entry : { ...entry, settings };
      });
      const lastEsiVolumeMode =
        url === ESI_LAYER_URL && patch.isEsiVolume !== undefined
          ? patch.isEsiVolume
          : state.lastEsiVolumeMode;
      return { ...state, entries, lastEsiVolumeMode };
    }

    default:
      throw new Error(`layerReducer: unknown action type ${action.type}`);
  }
}

// useReducer initializer: the `layers` prop's file layers, before any electrode/ESI is merged in.
export function initLayerState(layers = []) {
  return layerReducer({ entries: [], lastEsiVolumeMode: true }, { type: LOAD_FILE_LAYERS, layers });
}
