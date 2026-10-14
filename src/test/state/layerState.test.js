import { describe, it, expect } from 'vitest';
import {
  layerReducer,
  initLayerState,
  selectOrderedLayers,
  selectLayerSettings,
  selectEntry,
  selectNvVolumeIndex,
  LOAD_FILE_LAYERS,
  APPEND_FILE_LAYERS,
  REMOVE_LAYERS,
  UPSERT_SENTINEL,
  REORDER,
  UPDATE_SETTINGS,
} from '@/state/layerState';
import {
  isImageVolumeLayer,
  DEFAULT_MESH_XRAY,
  ELECTRODE_LAYER_URL,
  ESI_LAYER_URL,
} from '@/utils/NiiViewer.utils';

const mri = { url: 'blob:mri', type: 'MRI', kind: 'volume' };
const pet = { url: 'blob:pet', type: 'PET', kind: 'volume' };
const pial = { url: 'blob:pial', type: 'pial', kind: 'mesh' };
const electrodes = { url: ELECTRODE_LAYER_URL, type: 'Electrodes', kind: 'connectome' };
const esiVolume = { url: ESI_LAYER_URL, type: 'Electrical Source Imaging', kind: 'volume' };
const esiConnectome = { url: ESI_LAYER_URL, type: 'Electrical Source Imaging', kind: 'connectome' };

const urls = (state) => state.entries.map((entry) => entry.url);
const run = (state, ...actions) => actions.reduce(layerReducer, state);

// The invariants every action must leave intact — see layerState.js's header comment.
function expectInvariants(state) {
  const allUrls = urls(state);
  expect(new Set(allUrls).size).toBe(allUrls.length); // unique
  state.entries.forEach((entry) => expect(entry.settings.url).toBe(entry.url)); // aligned
  const firstNonVolume = state.entries.findIndex((e) => !isImageVolumeLayer(e.layer));
  if (firstNonVolume !== -1) {
    // volumes first: nothing after the first mesh/connectome is an image volume
    expect(state.entries.slice(firstNonVolume).every((e) => !isImageVolumeLayer(e.layer))).toBe(
      true
    );
  }
  const xrays = state.entries
    .filter((e) => !isImageVolumeLayer(e.layer))
    .map((e) => e.settings.meshXRay);
  expect(new Set(xrays).size).toBeLessThanOrEqual(1); // shared meshXRay
}

describe('initLayerState', () => {
  it('seeds one entry per layer, the first fully opaque, ESI mode defaulting to volume', () => {
    const state = initLayerState([mri, pet]);
    expect(urls(state)).toEqual(['blob:mri', 'blob:pet']);
    expect(state.entries[0].settings.opacity).toBe(1);
    expect(state.entries[1].settings.opacity).toBe(0.6);
    expect(state.lastEsiVolumeMode).toBe(true);
  });

  it('starts empty without layers', () => {
    expect(initLayerState().entries).toEqual([]);
  });
});

describe('LOAD_FILE_LAYERS', () => {
  it('replaces the file layers but keeps the electrode/ESI entries and their settings', () => {
    let state = run(
      initLayerState([mri]),
      { type: UPSERT_SENTINEL, url: ELECTRODE_LAYER_URL, layer: electrodes },
      { type: UPDATE_SETTINGS, url: ELECTRODE_LAYER_URL, patch: { nodeScale: 9 } }
    );
    state = layerReducer(state, { type: LOAD_FILE_LAYERS, layers: [pet] });
    expect(urls(state)).toEqual(['blob:pet', ELECTRODE_LAYER_URL]);
    expect(selectEntry(state, ELECTRODE_LAYER_URL).settings.nodeScale).toBe(9);
    expect(selectEntry(state, 'blob:pet').settings.opacity).toBe(1); // first file layer again
  });

  // Regression: the old empty-`layers` branch kept connectome *layers* by kind but their
  // *settings* by url, so an ESI volume (kind 'volume') lost its layer but kept its settings.
  it('with no layers, keeps an ESI volume entry whole (layer and settings together)', () => {
    let state = run(initLayerState([mri]), {
      type: UPSERT_SENTINEL,
      url: ESI_LAYER_URL,
      layer: esiVolume,
    });
    state = layerReducer(state, { type: LOAD_FILE_LAYERS, layers: [] });
    expect(urls(state)).toEqual([ESI_LAYER_URL]);
    expect(state.entries[0].layer).toBe(esiVolume);
    expectInvariants(state);
  });

  it("joins new file meshes at the scene's current meshXRay", () => {
    let state = run(
      initLayerState(),
      { type: UPSERT_SENTINEL, url: ELECTRODE_LAYER_URL, layer: electrodes },
      { type: UPDATE_SETTINGS, url: ELECTRODE_LAYER_URL, patch: { meshXRay: 0.3 } }
    );
    state = layerReducer(state, { type: LOAD_FILE_LAYERS, layers: [pial] });
    expect(selectEntry(state, 'blob:pial').settings.meshXRay).toBe(0.3);
  });
});

describe('APPEND_FILE_LAYERS', () => {
  it('appends after the existing layers, without the first-layer full opacity', () => {
    const state = layerReducer(initLayerState([mri]), { type: APPEND_FILE_LAYERS, layers: [pet] });
    expect(urls(state)).toEqual(['blob:mri', 'blob:pet']);
    expect(selectEntry(state, 'blob:pet').settings.opacity).toBe(0.6);
  });

  it('places an appended volume above existing connectomes (volumes first)', () => {
    const state = run(
      initLayerState([mri]),
      { type: UPSERT_SENTINEL, url: ELECTRODE_LAYER_URL, layer: electrodes },
      { type: APPEND_FILE_LAYERS, layers: [pet] }
    );
    expect(urls(state)).toEqual(['blob:mri', 'blob:pet', ELECTRODE_LAYER_URL]);
  });
});

describe('REMOVE_LAYERS', () => {
  it('removes entries by url, layer and settings together', () => {
    const state = layerReducer(initLayerState([mri, pet]), {
      type: REMOVE_LAYERS,
      urls: ['blob:mri'],
    });
    expect(urls(state)).toEqual(['blob:pet']);
    expectInvariants(state);
  });

  it('returns the same state when none of the urls are present', () => {
    const state = initLayerState([mri]);
    expect(layerReducer(state, { type: REMOVE_LAYERS, urls: ['blob:nope'] })).toBe(state);
  });
});

describe('UPSERT_SENTINEL', () => {
  it('no layer + not present: returns the same state', () => {
    const state = initLayerState([mri]);
    expect(layerReducer(state, { type: UPSERT_SENTINEL, url: ESI_LAYER_URL, layer: null })).toBe(
      state
    );
  });

  it('no layer + present: removes the entry', () => {
    const state = run(
      initLayerState([mri]),
      { type: UPSERT_SENTINEL, url: ELECTRODE_LAYER_URL, layer: electrodes },
      { type: UPSERT_SENTINEL, url: ELECTRODE_LAYER_URL, layer: null }
    );
    expect(urls(state)).toEqual(['blob:mri']);
  });

  it('layer + not present: appends it with default settings', () => {
    const state = layerReducer(initLayerState([mri]), {
      type: UPSERT_SENTINEL,
      url: ELECTRODE_LAYER_URL,
      layer: electrodes,
    });
    expect(urls(state)).toEqual(['blob:mri', ELECTRODE_LAYER_URL]);
    expect(selectEntry(state, ELECTRODE_LAYER_URL).settings).toMatchObject({
      url: ELECTRODE_LAYER_URL,
      electrodeDisplayMode: 'none',
      meshXRay: DEFAULT_MESH_XRAY,
    });
  });

  it('layer + present, same object: returns the same state', () => {
    const state = layerReducer(initLayerState(), {
      type: UPSERT_SENTINEL,
      url: ELECTRODE_LAYER_URL,
      layer: electrodes,
    });
    expect(
      layerReducer(state, { type: UPSERT_SENTINEL, url: ELECTRODE_LAYER_URL, layer: electrodes })
    ).toBe(state);
  });

  it("layer + present, new object: swaps the layer but keeps the user's settings", () => {
    const refreshed = { ...electrodes, hasVoltageSnapshot: true };
    const state = run(
      initLayerState([mri]),
      { type: UPSERT_SENTINEL, url: ELECTRODE_LAYER_URL, layer: electrodes },
      {
        type: UPDATE_SETTINGS,
        url: ELECTRODE_LAYER_URL,
        patch: { electrodeDisplayMode: 'voltage' },
      },
      { type: UPSERT_SENTINEL, url: ELECTRODE_LAYER_URL, layer: refreshed }
    );
    const entry = selectEntry(state, ELECTRODE_LAYER_URL);
    expect(entry.layer).toBe(refreshed);
    expect(entry.settings.electrodeDisplayMode).toBe('voltage');
  });

  it('places a new ESI volume above the electrode connectome (volumes first)', () => {
    const state = run(
      initLayerState([mri]),
      { type: UPSERT_SENTINEL, url: ELECTRODE_LAYER_URL, layer: electrodes },
      { type: UPSERT_SENTINEL, url: ESI_LAYER_URL, layer: esiVolume }
    );
    expect(urls(state)).toEqual(['blob:mri', ESI_LAYER_URL, ELECTRODE_LAYER_URL]);
  });

  it('moves the ESI entry up into the volume group when it switches from connectome to volume', () => {
    const state = run(
      initLayerState([mri]),
      { type: UPSERT_SENTINEL, url: ELECTRODE_LAYER_URL, layer: electrodes },
      { type: UPSERT_SENTINEL, url: ESI_LAYER_URL, layer: esiConnectome }, // below electrodes
      { type: UPSERT_SENTINEL, url: ESI_LAYER_URL, layer: esiVolume }
    );
    expect(urls(state)).toEqual(['blob:mri', ESI_LAYER_URL, ELECTRODE_LAYER_URL]);
  });

  it('seeds a new ESI entry with the last chosen mode and its 0.9 volume opacity', () => {
    const state = layerReducer(initLayerState([mri]), {
      type: UPSERT_SENTINEL,
      url: ESI_LAYER_URL,
      layer: esiVolume,
    });
    expect(selectEntry(state, ESI_LAYER_URL).settings).toMatchObject({
      isEsiVolume: true,
      opacity: 0.9,
    });
  });

  it("joins a new connectome at the scene's current meshXRay instead of the default", () => {
    const state = run(
      initLayerState([pial]),
      { type: UPDATE_SETTINGS, url: 'blob:pial', patch: { meshXRay: 0.3 } },
      { type: UPSERT_SENTINEL, url: ELECTRODE_LAYER_URL, layer: electrodes }
    );
    expect(selectEntry(state, ELECTRODE_LAYER_URL).settings.meshXRay).toBe(0.3);
  });
});

describe('REORDER', () => {
  it('reorders entries by url, layers and settings together', () => {
    const state = layerReducer(initLayerState([mri, pet]), {
      type: REORDER,
      urls: ['blob:pet', 'blob:mri'],
    });
    expect(urls(state)).toEqual(['blob:pet', 'blob:mri']);
    expectInvariants(state);
  });

  it('keeps volumes first even if the requested order puts a connectome above them', () => {
    const state = run(
      initLayerState([mri]),
      { type: UPSERT_SENTINEL, url: ELECTRODE_LAYER_URL, layer: electrodes },
      { type: REORDER, urls: [ELECTRODE_LAYER_URL, 'blob:mri'] }
    );
    expect(urls(state)).toEqual(['blob:mri', ELECTRODE_LAYER_URL]);
  });

  it('keeps entries the new order did not mention', () => {
    const state = layerReducer(initLayerState([mri, pet]), { type: REORDER, urls: ['blob:pet'] });
    expect(urls(state)).toEqual(['blob:pet', 'blob:mri']);
  });
});

describe('UPDATE_SETTINGS', () => {
  it("patches only the targeted entry's settings", () => {
    const state = layerReducer(initLayerState([mri, pet]), {
      type: UPDATE_SETTINGS,
      url: 'blob:pet',
      patch: { opacity: 0.3, colormap: 'hot' },
    });
    expect(selectEntry(state, 'blob:pet').settings).toMatchObject({
      opacity: 0.3,
      colormap: 'hot',
    });
    expect(selectEntry(state, 'blob:mri').settings.opacity).toBe(1);
  });

  it('writes meshXRay onto every mesh/connectome entry, not onto image volumes', () => {
    const state = run(
      initLayerState([mri, pial]),
      { type: UPSERT_SENTINEL, url: ELECTRODE_LAYER_URL, layer: electrodes },
      { type: UPDATE_SETTINGS, url: ELECTRODE_LAYER_URL, patch: { meshXRay: 0.2 } }
    );
    expect(selectEntry(state, ELECTRODE_LAYER_URL).settings.meshXRay).toBe(0.2);
    expect(selectEntry(state, 'blob:pial').settings.meshXRay).toBe(0.2);
    expect(selectEntry(state, 'blob:mri').settings.meshXRay).toBe(DEFAULT_MESH_XRAY);
  });

  it("remembers the ESI layer's isEsiVolume choice in lastEsiVolumeMode, which outlives the entry", () => {
    const state = run(
      initLayerState(),
      { type: UPSERT_SENTINEL, url: ESI_LAYER_URL, layer: esiVolume },
      { type: UPDATE_SETTINGS, url: ESI_LAYER_URL, patch: { isEsiVolume: false } },
      { type: REMOVE_LAYERS, urls: [ESI_LAYER_URL] },
      { type: UPSERT_SENTINEL, url: ESI_LAYER_URL, layer: esiConnectome }
    );
    expect(state.lastEsiVolumeMode).toBe(false);
    expect(selectEntry(state, ESI_LAYER_URL).settings.isEsiVolume).toBe(false);
  });

  it('returns the same state for an unknown url', () => {
    const state = initLayerState([mri]);
    expect(
      layerReducer(state, { type: UPDATE_SETTINGS, url: 'blob:nope', patch: { opacity: 0 } })
    ).toBe(state);
  });

  // The ESI/electrode black-render bug, at reducer level: a settings change addressed by url
  // lands on the right layer no matter what was merged or re-sorted before it was applied.
  it('lands on the right layer even after an ESI volume was merged in and re-sorted first', () => {
    const state = run(
      initLayerState([mri]),
      { type: UPSERT_SENTINEL, url: ELECTRODE_LAYER_URL, layer: electrodes },
      { type: UPSERT_SENTINEL, url: ESI_LAYER_URL, layer: esiVolume }, // sorted above electrodes
      {
        type: UPDATE_SETTINGS,
        url: ELECTRODE_LAYER_URL,
        patch: { electrodeDisplayMode: 'voltage' },
      }
    );
    expect(selectEntry(state, ELECTRODE_LAYER_URL).settings.electrodeDisplayMode).toBe('voltage');
    expect(selectEntry(state, ESI_LAYER_URL).settings.electrodeDisplayMode).toBeUndefined();
    expectInvariants(state);
  });
});

describe('selectors', () => {
  const state = run(
    initLayerState([mri, pial, pet]),
    { type: UPSERT_SENTINEL, url: ELECTRODE_LAYER_URL, layer: electrodes },
    { type: UPSERT_SENTINEL, url: ESI_LAYER_URL, layer: esiVolume }
  );

  it('selectOrderedLayers/selectLayerSettings return index-aligned arrays', () => {
    const layers = selectOrderedLayers(state);
    const settings = selectLayerSettings(state);
    expect(layers.map((l) => l.url)).toEqual(settings.map((s) => s.url));
  });

  it('selectNvVolumeIndex counts only the image volumes before the layer', () => {
    // order: mri, pet, esi (volumes), pial, electrodes
    expect(selectNvVolumeIndex(state, 'blob:mri')).toBe(0);
    expect(selectNvVolumeIndex(state, 'blob:pet')).toBe(1);
    expect(selectNvVolumeIndex(state, ESI_LAYER_URL)).toBe(2);
  });

  it('selectNvVolumeIndex is -1 for meshes, connectomes and unknown urls', () => {
    expect(selectNvVolumeIndex(state, 'blob:pial')).toBe(-1);
    expect(selectNvVolumeIndex(state, ELECTRODE_LAYER_URL)).toBe(-1);
    expect(selectNvVolumeIndex(state, 'blob:nope')).toBe(-1);
  });
});

describe('invariants', () => {
  // Every action, in an order that exercises merges, kind switches, reorders and removals,
  // with the invariants checked after each single step.
  it('hold after every action in a mixed sequence', () => {
    const actions = [
      { type: LOAD_FILE_LAYERS, layers: [mri] },
      { type: UPSERT_SENTINEL, url: ELECTRODE_LAYER_URL, layer: electrodes },
      { type: APPEND_FILE_LAYERS, layers: [pial, pet] },
      { type: UPDATE_SETTINGS, url: 'blob:pial', patch: { meshXRay: 0.4 } },
      { type: UPSERT_SENTINEL, url: ESI_LAYER_URL, layer: esiVolume },
      { type: REORDER, urls: [ELECTRODE_LAYER_URL, 'blob:pet', ESI_LAYER_URL, 'blob:mri'] },
      { type: UPSERT_SENTINEL, url: ESI_LAYER_URL, layer: esiConnectome },
      { type: UPDATE_SETTINGS, url: ESI_LAYER_URL, patch: { isEsiVolume: false } },
      { type: REMOVE_LAYERS, urls: ['blob:pet'] },
      { type: LOAD_FILE_LAYERS, layers: [] },
      { type: UPSERT_SENTINEL, url: ELECTRODE_LAYER_URL, layer: null },
    ];
    let state = initLayerState();
    for (const action of actions) {
      state = layerReducer(state, action);
      expectInvariants(state);
    }
  });

  it('throws on an unknown action type', () => {
    expect(() => layerReducer(initLayerState(), { type: 'NOPE' })).toThrow(/unknown action/);
  });
});
