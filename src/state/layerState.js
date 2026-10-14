// Single source of truth for NiiViewer's layer list: every layer together with its own display
// settings, in display order, addressed by url (never by array position).
//
// Vocabulary — what the names below mean, and what they'll be renamed to in a follow-up PR:
//   state    — { entries, lastEsiVolumeMode }: everything this reducer manages
//   entry    — { url, layer, settings }: one card, all there is to one layer   (→ "layer")
//   entries  — the list of entries, in card order                              (→ "layers")
//   layer    — the data half of an entry: what to show                         (→ "data")
//   settings — the other half: how to show it, i.e. the user's card choices
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
//
// entries — one per layer, in display order (= the ImagingControls card order):
//   url      — the layer's unique id; every action addresses a layer by it. A blob: url for a
//              dropped file, a path for demo/Shanoir files (e.g. 'demo_data/sub-synth_T1w.nii.gz'),
//              or a fixed sentinel string for a generated layer ('__electrodes__',
//              '__esi-source-power__' — see ELECTRODE_LAYER_URL/ESI_LAYER_URL).
//   layer    — what to show: the data, which the user doesn't edit. Always has
//              { url, name, type, subtype, kind }, where `kind` decides how it's rendered:
//                - image volume (kind undefined or 'volume'): an nv.volumes entry, e.g.
//                  { url, name: 'sub-synth_T1w.nii.gz', type: 'MRI', subtype: 'sub-synth_T1w' }
//                - 'mesh': a surface file (GIFTI/PLY/OBJ…) in nv.meshes
//                - 'connectome': nodes/edges built into a mesh — the electrodes
//                  ({ nodes, edges, calMax, metricMax, availableMetrics, hasVoltageSnapshot })
//                  or the ESI layer in connectome mode ({ nodes, edges: [], boundMin, boundMax })
//                The ESI layer in volume mode is an image volume carrying its raw NIfTI `bytes`.
//   settings — how to show it: what the user changes on the card. Created by
//              getInitialLayerSettings, e.g.
//                { url, visible: true, opacity: 0.6, colormap: 'gray', invert: false,
//                  showColorbar: false, cal_min: 0, cal_max: 1, meshXRay: 0.75,
//                  nodeScale: 4, edgeScale: 0.5 }
//              plus `isEsiVolume` (ESI only: Connectome/Volume toggle) and
//              `electrodeDisplayMode` (electrodes only: 'none' / 'voltage' / a metric name).
//              cal_min/cal_max are 0-1 fractions of the layer's own data range, not raw values.
//              settings.url repeats the entry's url, so a settings object on its own still says
//              which layer it belongs to.
//
// lastEsiVolumeMode — the ESI Connectome/Volume mode the user last chose. It outlives the ESI
// entry itself, so a deleted-then-regenerated ESI layer comes back in the same mode.

import {
  getInitialLayerSettings,
  isImageVolumeLayer,
  DEFAULT_MESH_XRAY,
  ELECTRODE_LAYER_URL,
  ESI_LAYER_URL,
} from '@/utils/NiiViewer.utils';

// ─── Action types ───────────────────────────────────────────────────────────────
// The `type` of each action passed to dispatchLayers — every way the layer state can change.
export const LOAD_FILE_LAYERS = 'LOAD_FILE_LAYERS'; // { layers } — replace all file layers, keep electrode/ESI
export const APPEND_FILE_LAYERS = 'APPEND_FILE_LAYERS'; // { layers } — add file layers after the existing ones
export const REMOVE_LAYERS = 'REMOVE_LAYERS'; // { urls }
export const SYNC_GENERATED_LAYER = 'SYNC_GENERATED_LAYER'; // { url, layer } — make a generated layer's entry match `layer`: add / replace / (layer null) remove
export const REORDER = 'REORDER'; // { urls } — new display order
export const UPDATE_SETTINGS = 'UPDATE_SETTINGS'; // { url, patch }

// Generated layers: not loaded from files but built in memory (today from EEG data),
// each owned by its own hook (useElectrodeConnectome / useEsiLayer)
// and identified by a fixed sentinel url (e.g. '__electrodes__' or '__esi-source-power__')
// Add a future generated layer (e.g. a mask derived from the loaded layers) here too, so
// LOAD_FILE_LAYERS keeps it when the file layers are replaced.
const GENERATED_LAYER_URLS = [ELECTRODE_LAYER_URL, ESI_LAYER_URL];
const isGeneratedLayerUrl = (url) => GENERATED_LAYER_URLS.includes(url);

// ─── Selectors ──────────────────────────────────────────────────────────────────
// Read-only helpers that derive values from the state, so callers don't index into it themselves.
export const selectOrderedLayers = (state) => state.entries.map((entry) => entry.layer);
export const selectLayerSettings = (state) => state.entries.map((entry) => entry.settings);
export const selectEntry = (state, url) => state.entries.find((entry) => entry.url === url);

/**
 * A layer's index in nv.volumes. Only image volumes occupy a slot there (meshes/connectomes live
 * in nv.meshes), so this counts the image-volume entries before it.
 *
 * @param {Object} state - the layer state.
 * @param {string} url - the layer to look up.
 * @returns {number} its nv.volumes index, or -1 if the url is unknown or not an image volume.
 */
export function selectNvVolumeIndex(state, url) {
  const index = state.entries.findIndex((entry) => entry.url === url);
  if (index === -1 || !isImageVolumeLayer(state.entries[index].layer)) return -1;
  return state.entries.slice(0, index).filter((entry) => isImageVolumeLayer(entry.layer)).length;
}

/**
 * The meshXRay already active in the scene (shared by every mesh/connectome), so a newly added
 * one joins at that value instead of resetting the scene to the default.
 *
 * @param {Array} entries - the entries to look in.
 * @returns {number} the first mesh/connectome entry's meshXRay, or DEFAULT_MESH_XRAY if there's none.
 */
function currentMeshXRay(entries) {
  const meshEntry = entries.find((entry) => !isImageVolumeLayer(entry.layer));
  return meshEntry ? meshEntry.settings.meshXRay : DEFAULT_MESH_XRAY;
}

/**
 * Builds new entries, with default settings, for layers joining the list. Every default is
 * created here — callers never seed their own fallback.
 *
 * @param {Array} layers - the layers to wrap in entries.
 * @param {number} startIndex - the position the first of them takes among all layers; only the
 *   very first layer overall (position 0) is fully opaque.
 * @param {Object} state - the current state, read for lastEsiVolumeMode (the ESI layer's mode,
 *   and with it its 0.9 volume-mode opacity, follows the last chosen mode).
 * @param {Array} entriesForXRay - the entries whose meshXRay the new ones join (see currentMeshXRay).
 * @returns {Array} one `{ url, layer, settings }` entry per layer, in the same order.
 */
function makeEntries(layers, startIndex, state, entriesForXRay) {
  const meshXRay = currentMeshXRay(entriesForXRay);
  return layers.map((layer, i) => {
    // The ESI layer's mode (and its 0.9 volume-mode opacity) follows the last chosen mode.
    const isEsiVolumeMode = layer.url === ESI_LAYER_URL ? state.lastEsiVolumeMode : undefined;
    const [settings] = getInitialLayerSettings([layer], startIndex + i, isEsiVolumeMode, meshXRay);
    return { url: layer.url, layer, settings };
  });
}

/**
 * New state with these entries, image volumes first, then meshes/connectomes.
 * Image volumes are reorderable; meshes/connectomes aren't (they have no z-order relative to the
 * 2D slices), so they cluster at the bottom of the card list to make that clear.
 * Each group keeps its own order, so the user's volume ordering (which mirrors nv.volumes) survives.
 * Each case only calls this when something actually changed — no-op cases return `state` itself
 * earlier, which is what lets React skip the render (and keeps the connectome hooks' re-running
 * sync effects from looping).
 *
 * @param {Object} state - the current state; every field besides `entries` carries over.
 * @param {Array} entries - the changed entries, in any order.
 * @returns {Object} a new state object with the entries sorted volumes-first.
 */
function withEntries(state, entries) {
  const volumes = entries.filter((entry) => isImageVolumeLayer(entry.layer));
  const others = entries.filter((entry) => !isImageVolumeLayer(entry.layer));
  return { ...state, entries: [...volumes, ...others] };
}

// ─── Reducer ────────────────────────────────────────────────────────────────────
/**
 * Computes the next layer state from the current one and an action — the only place the layer
 * state changes. Used by NiiViewer's useReducer (via dispatchLayers), and called directly where
 * a caller needs the resulting state right away (e.g. to load nv with the new layers' settings).
 *
 * Pure: never mutates `state`. Every change returns a new state object that still satisfies the
 * invariants in this file's header (unique urls, settings aligned, volumes first, shared
 * meshXRay). An action that changes nothing returns `state` itself, so React skips the render.
 *
 * @param {Object} state - the current state: `{ entries: [{ url, layer, settings }], lastEsiVolumeMode }`.
 * @param {Object} action - `{ type, ...payload }`, with `type` one of the action types above;
 *   each type's payload is listed next to its constant.
 * @returns {Object} the next state, or `state` itself when nothing changed.
 * @throws {Error} on an unknown action type — a typo'd type would otherwise be silently ignored.
 */
export function layerReducer(state, action) {
  switch (action.type) {
    case LOAD_FILE_LAYERS: {
      // Electrode/ESI entries aren't part of the `layers` prop — keep them, with their settings.
      const kept = state.entries.filter((entry) => isGeneratedLayerUrl(entry.url));
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
      // if none of the states have the url to be removed => return state
      if (!state.entries.some((entry) => urls.has(entry.url))) return state;
      // else return all states except the ones with these urls
      return withEntries(
        state,
        state.entries.filter((entry) => !urls.has(entry.url))
      );
    }

    case SYNC_GENERATED_LAYER: {
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
