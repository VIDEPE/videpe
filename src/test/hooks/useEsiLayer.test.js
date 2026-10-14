import { useReducer } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useEsiLayer } from '@/hooks/useEsiLayer';
import { ESI_LAYER_URL, DEFAULT_MESH_XRAY } from '@/utils/NiiViewer.utils';
import {
  layerReducer,
  initLayerState,
  selectOrderedLayers,
  selectLayerSettings,
  REMOVE_LAYERS,
  UPDATE_SETTINGS,
} from '@/state/layerState';

// This hook has no NiiViewer.test.jsx integration coverage today (unlike the intracranial
// connectome, which is exercised extensively there) — these tests cover the connectome/volume
// branching, cal-bounds math, and rebuild/teardown bookkeeping directly.

const makeConnectomeLayer = (overrides = {}) => ({
  url: ESI_LAYER_URL,
  name: 'ESI Source Power',
  kind: 'connectome',
  nodes: [{ name: 'esi-src-0', x: 0, y: 0, z: 0, colorValue: 0.5, sizeValue: 0.5 }],
  edges: [],
  boundMin: 0,
  boundMax: 1,
  ...overrides,
});

const makeVolumeLayer = (overrides = {}) => ({
  url: ESI_LAYER_URL,
  name: 'ESI Source Power.nii',
  bytes: new Uint8Array([1, 2, 3]),
  kind: 'volume',
  boundMin: 0,
  boundMax: 1,
  ...overrides,
});

const makeEsiLayer = ({ connectome, volume, maxSourcePowerLocation } = {}) => ({
  maxSourcePowerLocation: maxSourcePowerLocation ?? [1, 2, 3],
  sourcePowerConnectomes: connectome ?? makeConnectomeLayer(),
  sourcePowerVolume: volume ?? makeVolumeLayer(),
});

function makeNv() {
  const nv = {
    volumes: [],
    meshes: [],
    loadConnectomeAsMesh: vi.fn((json) => ({ ...json, opacity: 1 })),
    addMesh: vi.fn((mesh) => nv.meshes.push(mesh)),
    removeMesh: vi.fn((mesh) => {
      nv.meshes = nv.meshes.filter((m) => m !== mesh);
    }),
    addVolumesFromUrl: vi.fn().mockImplementation(async (items) => {
      const added = items.map((item) => ({ ...item, id: `vol-${nv.volumes.length}` }));
      nv.volumes = [...nv.volumes, ...added];
      return added;
    }),
    removeVolumeByIndex: vi.fn((index) => {
      nv.volumes = nv.volumes.filter((_, i) => i !== index);
    }),
    setOpacity: vi.fn(),
    setColormap: vi.fn(),
    updateGLVolume: vi.fn(),
    mm2frac: vi.fn((mm) => mm), // identity stand-in — tests assert on what's passed in, not real geometry
    scene: { crosshairPos: null },
    opts: {},
  };
  return nv;
}

// Wraps useEsiLayer with the layer state it expects its caller to own, using the real reducer —
// mirroring how NiiViewer itself supplies it. initialLayers lets tests seed a pending
// (not-yet-in-nv.volumes) MRI/PET layer, same as useLayerLoader does synchronously before its
// own async nv load resolves; initialState seeds a fully custom state instead (e.g. a mesh with
// a non-default meshXRay). Its lastEsiVolumeMode follows the initial isEsiVolumeMode, as it
// would in NiiViewer, where the mode is derived from that same state. dispatchLayers is also
// returned so a test can simulate other changes (that async load "finishing", a card being
// deleted) independently of the ESI layer itself changing; orderedLayers/layerSettings are the
// state's derived views, for assertions.
function useHarness({ esiLayer, isEsiVolumeMode, nvRef, initialLayers = [], initialState }) {
  const [layerState, dispatchLayers] = useReducer(layerReducer, null, () => ({
    ...(initialState ?? initLayerState(initialLayers)),
    lastEsiVolumeMode: isEsiVolumeMode,
  }));
  const hookResult = useEsiLayer({ esiLayer, isEsiVolumeMode, nvRef, layerState, dispatchLayers });
  return {
    layerState,
    dispatchLayers,
    orderedLayers: selectOrderedLayers(layerState),
    layerSettings: selectLayerSettings(layerState),
    ...hookResult,
  };
}

describe('useEsiLayer', () => {
  let nv;
  let nvRef;
  beforeEach(() => {
    nv = makeNv();
    nvRef = { current: nv };
  });

  it('does nothing when esiLayer is null', () => {
    const { result } = renderHook((props) => useHarness(props), {
      initialProps: { esiLayer: null, isEsiVolumeMode: false, nvRef },
    });
    expect(result.current.orderedLayers).toEqual([]);
    expect(nv.addMesh).not.toHaveBeenCalled();
  });

  describe('connectome mode', () => {
    it('builds and adds a connectome mesh via loadConnectomeAsMesh + addMesh', () => {
      const esiLayer = makeEsiLayer();
      const { result } = renderHook((props) => useHarness(props), {
        initialProps: { esiLayer, isEsiVolumeMode: false, nvRef },
      });
      expect(nv.loadConnectomeAsMesh).toHaveBeenCalled();
      expect(nv.addMesh).toHaveBeenCalled();
      expect(result.current.esiMeshRef.current).toBeTruthy();
      expect(result.current.esiVolumeRef.current).toBeNull();
    });

    it('merges the connectome layer into the layer state by the ESI sentinel url', () => {
      const esiLayer = makeEsiLayer();
      const { result } = renderHook((props) => useHarness(props), {
        initialProps: { esiLayer, isEsiVolumeMode: false, nvRef },
      });
      expect(result.current.orderedLayers).toHaveLength(1);
      expect(result.current.orderedLayers[0].url).toBe(ESI_LAYER_URL);
      expect(result.current.layerSettings).toHaveLength(1);
    });

    it('resolves nodeMinColor/nodeMaxColor from boundMin/boundMax and the default cal fractions (0.01/1)', () => {
      const esiLayer = makeEsiLayer({
        connectome: makeConnectomeLayer({ boundMin: 0, boundMax: 100 }),
      });
      renderHook((props) => useHarness(props), {
        initialProps: { esiLayer, isEsiVolumeMode: false, nvRef },
      });
      const call = nv.loadConnectomeAsMesh.mock.calls[0][0];
      expect(call.nodeMinColor).toBeCloseTo(1); // 0.01 * 100 — ESI's default cal_min fraction
      expect(call.nodeMaxColor).toBe(100); // 1 * 100 — default cal_max fraction
    });

    it('excludes nodes below the resolved cal_min from what is passed to loadConnectomeAsMesh (NiiVue warns once per excluded node otherwise)', () => {
      const esiLayer = makeEsiLayer({
        connectome: makeConnectomeLayer({
          boundMin: 0,
          boundMax: 100,
          nodes: [
            { name: 'below-threshold', x: 0, y: 0, z: 0, colorValue: 0.5, sizeValue: 0.5 },
            { name: 'above-threshold', x: 1, y: 1, z: 1, colorValue: 50, sizeValue: 0.5 },
          ],
        }),
      });
      renderHook((props) => useHarness(props), {
        initialProps: { esiLayer, isEsiVolumeMode: false, nvRef },
      });
      const call = nv.loadConnectomeAsMesh.mock.calls[0][0];
      // nodeMinColor resolves to 0.01 * 100 = 1 (see the test above) — only 'above-threshold'
      // (50) clears it.
      expect(call.nodes.map((n) => n.name)).toEqual(['above-threshold']);
    });

    it('hides nodes below cal_min and keeps nodes at/above it even when cal_min equals cal_max', () => {
      const esiLayer = makeEsiLayer({
        connectome: makeConnectomeLayer({
          boundMin: 5,
          boundMax: 5, // cal_min and cal_max both resolve to 5
          nodes: [
            { name: 'below', x: 0, y: 0, z: 0, colorValue: 4, sizeValue: 0.1 },
            { name: 'at-or-above', x: 1, y: 1, z: 1, colorValue: 5, sizeValue: 0.1 },
          ],
        }),
      });
      renderHook((props) => useHarness(props), {
        initialProps: { esiLayer, isEsiVolumeMode: false, nvRef },
      });
      const call = nv.loadConnectomeAsMesh.mock.calls[0][0];
      expect(call.nodes.map((n) => n.name)).toEqual(['at-or-above']);
    });

    // Regression test: NiiVue's own default for nv.opts.meshXRay is 0, but this app's default
    // settings value (DEFAULT_MESH_XRAY) differs — the build effect must write that
    // default onto nv.opts.meshXRay itself, not just leave it for the user's own slider drag.
    it('initializes nv.opts.meshXRay to DEFAULT_MESH_XRAY when the mesh is first built', () => {
      const esiLayer = makeEsiLayer();
      renderHook((props) => useHarness(props), {
        initialProps: { esiLayer, isEsiVolumeMode: false, nvRef },
      });
      expect(nv.opts.meshXRay).toBe(DEFAULT_MESH_XRAY);
    });

    // Regression test: on first appearance the mesh must be built from the card's own settings,
    // which join the scene's current meshXRay — not from separate defaults, which used to reset
    // nv.opts.meshXRay back to the default while the slider kept showing the user's value.
    it("keeps the scene's current meshXRay when the mesh first appears alongside an existing mesh", () => {
      const meshLayer = { url: 'blob:mesh', name: 'pial.gii', kind: 'mesh' };
      const esiLayer = makeEsiLayer();
      const meshAtXRay03 = layerReducer(initLayerState([meshLayer]), {
        type: UPDATE_SETTINGS,
        url: 'blob:mesh',
        patch: { meshXRay: 0.3 },
      });
      renderHook((props) => useHarness(props), {
        initialProps: { esiLayer, isEsiVolumeMode: false, nvRef, initialState: meshAtXRay03 },
      });
      expect(nv.opts.meshXRay).toBe(0.3);
    });

    it('rebuilds the mesh (remove + re-add) when the connectome data object changes', () => {
      const esiLayer1 = makeEsiLayer();
      const { rerender } = renderHook((props) => useHarness(props), {
        initialProps: { esiLayer: esiLayer1, isEsiVolumeMode: false, nvRef },
      });
      nv.addMesh.mockClear();
      const esiLayer2 = makeEsiLayer({ connectome: makeConnectomeLayer({ nodes: [] }) });
      rerender({ esiLayer: esiLayer2, isEsiVolumeMode: false, nvRef });
      expect(nv.removeMesh).toHaveBeenCalled();
      expect(nv.addMesh).toHaveBeenCalled();
    });

    it('does not rebuild on an unrelated re-render with the same esiLayer object', () => {
      const esiLayer = makeEsiLayer();
      const { rerender } = renderHook((props) => useHarness(props), {
        initialProps: { esiLayer, isEsiVolumeMode: false, nvRef },
      });
      nv.addMesh.mockClear();
      rerender({ esiLayer, isEsiVolumeMode: false, nvRef });
      expect(nv.addMesh).not.toHaveBeenCalled();
    });

    // Regression test: React StrictMode mounts, tears down, and mounts again on first mount —
    // its teardown (useSharedNiiVueInstance's cleanup) wipes nv.meshes even though esiLayer
    // itself never changed, which used to leave the mesh permanently missing (see
    // useEsiLayer.js's build effect) since the old guard only compared esiLayer by reference.
    // Simulated here without StrictMode itself, via the same kind of unrelated re-render the
    // guard is designed to tolerate (e.g. another layer's settings changing, which changes
    // layerState — in the build effect's deps — without touching
    // esiLayer/isEsiVolumeMode themselves): whatever removed the mesh from nv.meshes, the hook
    // must notice it's gone and rebuild, not just skip because the ESI data looks unchanged.
    it('rebuilds the mesh if it goes missing from nv.meshes even on an otherwise-unrelated re-render', () => {
      const esiLayer = makeEsiLayer();
      const { result } = renderHook((props) => useHarness(props), {
        initialProps: { esiLayer, isEsiVolumeMode: false, nvRef },
      });
      nv.addMesh.mockClear();
      nv.meshes = []; // something external (e.g. StrictMode's teardown) removed it

      act(() => {
        // unrelated re-render: an empty settings patch still yields a new state object
        result.current.dispatchLayers({ type: UPDATE_SETTINGS, url: ESI_LAYER_URL, patch: {} });
      });

      expect(nv.addMesh).toHaveBeenCalled();
    });

    it('tears down the mesh when esiLayer becomes null', () => {
      const esiLayer = makeEsiLayer();
      const { result, rerender } = renderHook((props) => useHarness(props), {
        initialProps: { esiLayer, isEsiVolumeMode: false, nvRef },
      });
      const mesh = result.current.esiMeshRef.current;
      rerender({ esiLayer: null, isEsiVolumeMode: false, nvRef });
      expect(nv.removeMesh).toHaveBeenCalledWith(mesh);
      expect(result.current.esiMeshRef.current).toBeNull();
    });

    // Regression test for "closing the ESI layer in Connectome mode resurrected it as a
    // Volume": handleDeleteLayer (in NiiViewer.jsx) removes the card directly without
    // going through this hook — simulated here by dispatching REMOVE_LAYERS, since
    // esiLayer/isEsiVolumeMode staying the same is exactly what keeps the merge/build effects
    // from reacting to the deletion itself. What's under test is what happens once fresh ESI
    // data actually does arrive afterwards (e.g. a new EEG click): the newly-seeded settings
    // entry must match the mode that was active, not fall back to Volume mode's hardcoded
    // `isEsiVolume: true` default.
    it('reseeds the settings entry to the current mode (not a hardcoded default) when ESI data reappears after its card was deleted', () => {
      const esiLayer1 = makeEsiLayer();
      const { result, rerender } = renderHook((props) => useHarness(props), {
        initialProps: { esiLayer: esiLayer1, isEsiVolumeMode: false, nvRef },
      });
      expect(result.current.layerSettings[0].isEsiVolume).toBe(false);

      act(() => {
        result.current.dispatchLayers({ type: REMOVE_LAYERS, urls: [ESI_LAYER_URL] });
      });

      const esiLayer2 = makeEsiLayer({ connectome: makeConnectomeLayer({ nodes: [] }) });
      rerender({ esiLayer: esiLayer2, isEsiVolumeMode: false, nvRef });

      expect(result.current.layerSettings[0].isEsiVolume).toBe(false);
    });

    it('snaps the crosshair to maxSourcePowerLocation on rebuild', () => {
      const esiLayer = makeEsiLayer({ maxSourcePowerLocation: [4, 5, 6] });
      renderHook((props) => useHarness(props), {
        initialProps: { esiLayer, isEsiVolumeMode: false, nvRef },
      });
      expect(nv.mm2frac).toHaveBeenCalledWith([4, 5, 6]);
      expect(nv.scene.crosshairPos).toEqual([4, 5, 6]); // mm2frac mock is identity, so this round-trips
    });
  });

  describe('volume mode', () => {
    it('loads the volume via addVolumesFromUrl with the raw bytes and forwarded name', async () => {
      const esiLayer = makeEsiLayer();
      renderHook((props) => useHarness(props), {
        initialProps: { esiLayer, isEsiVolumeMode: true, nvRef },
      });
      await waitFor(() => expect(nv.addVolumesFromUrl).toHaveBeenCalled());
      const [items] = nv.addVolumesFromUrl.mock.calls[0];
      expect(items).toEqual([
        { url: esiLayer.sourcePowerVolume.bytes, name: 'ESI Source Power.nii' },
      ]);
    });

    it('sets cal_min/cal_max/colormapType resolved from boundMin/boundMax after the volume loads', async () => {
      const esiLayer = makeEsiLayer({
        volume: makeVolumeLayer({ boundMin: 0, boundMax: 100 }),
      });
      renderHook((props) => useHarness(props), {
        initialProps: { esiLayer, isEsiVolumeMode: true, nvRef },
      });
      await waitFor(() => expect(nv.volumes).toHaveLength(1));
      expect(nv.volumes[0].cal_min).toBeCloseTo(1); // 0.01 * 100
      expect(nv.volumes[0].cal_max).toBe(100);
      expect(nv.volumes[0].colormapType).toBe(2); // Hard transition between transparant and opaque
    });

    it('sets opacity to 1 when esiLayer is the first layer', async () => {
      const esiLayer = makeEsiLayer();
      renderHook((props) => useHarness(props), {
        initialProps: { esiLayer: esiLayer, isEsiVolumeMode: true, nvRef },
      });
      await waitFor(() => expect(nv.volumes).toHaveLength(1));
      // with only 1 layer the opacity should be 1
      expect(nv.setOpacity).toHaveBeenCalledWith(0, 1);
    });

    it('sets opacity to 0.9 when esiLayer is not the first layer', async () => {
      // add mri layer to nv.volumes
      const mriLayer = { url: 'blob:mri', name: 'mri.nii', kind: 'volume' };
      nv.volumes = [{ id: 'vol-mri' }];
      // Add ESI layer, MRI is already known and loaded, so ESI isn't the first layer
      const esiLayer = makeEsiLayer();
      renderHook((props) => useHarness(props), {
        initialProps: {
          esiLayer,
          isEsiVolumeMode: true,
          nvRef,
          initialLayers: [mriLayer],
        },
      });
      await waitFor(() => expect(nv.volumes).toHaveLength(2));
      // with another layer present esi layer opacity should be 0.9
      expect(nv.setOpacity).toHaveBeenCalledWith(1, 0.9);
    });

    it('snaps the crosshair to maxSourcePowerLocation once the volume finishes loading', async () => {
      const esiLayer = makeEsiLayer({ maxSourcePowerLocation: [7, 8, 9] });
      renderHook((props) => useHarness(props), {
        initialProps: { esiLayer, isEsiVolumeMode: true, nvRef },
      });
      await waitFor(() => expect(nv.volumes).toHaveLength(1));
      expect(nv.mm2frac).toHaveBeenCalledWith([7, 8, 9]);
      expect(nv.scene.crosshairPos).toEqual([7, 8, 9]); // mm2frac mock is identity, so this round-trips
    });

    it('removes the stale volume only after the replacement has finished loading', async () => {
      const esiLayer1 = makeEsiLayer();
      const { rerender } = renderHook((props) => useHarness(props), {
        initialProps: { esiLayer: esiLayer1, isEsiVolumeMode: true, nvRef },
      });
      await waitFor(() => expect(nv.volumes).toHaveLength(1));

      const esiLayer2 = makeEsiLayer({
        volume: makeVolumeLayer({ name: 'ESI Source Power 2.nii' }),
      });
      rerender({ esiLayer: esiLayer2, isEsiVolumeMode: true, nvRef });
      await waitFor(() => expect(nv.addVolumesFromUrl).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(nv.removeVolumeByIndex).toHaveBeenCalled());
    });

    it('drops any leftover connectome mesh before switching into volume mode', async () => {
      const esiLayer = makeEsiLayer();
      const { rerender } = renderHook((props) => useHarness(props), {
        initialProps: { esiLayer, isEsiVolumeMode: false, nvRef },
      });
      expect(nv.addMesh).toHaveBeenCalled();
      const mesh = nv.addMesh.mock.calls[0][0];

      rerender({ esiLayer, isEsiVolumeMode: true, nvRef });
      await waitFor(() => expect(nv.addVolumesFromUrl).toHaveBeenCalled());
      expect(nv.removeMesh).toHaveBeenCalledWith(mesh);
    });

    it('defers adding the ESI volume until other image-volume layers already known in the layer state have landed in nv.volumes', async () => {
      // Regression test: if the ESI volume's addVolumesFromUrl call resolves before the
      // MRI/PET background's own (independent, async) load does, the ESI volume — a coarse
      // source-power grid — can grab nv.volumes[0], NiiVue's base/reference volume that
      // defines the rendering grid. The whole scene then gets resampled onto ESI's coarse
      // grid, visible as blocky "squares" until the layers are manually reordered.
      const mriLayer = { url: 'blob:mri', name: 'mri.nii', kind: 'volume' };
      const esiLayer = makeEsiLayer();
      const { result } = renderHook((props) => useHarness(props), {
        initialProps: {
          esiLayer,
          isEsiVolumeMode: true,
          nvRef,
          initialLayers: [mriLayer],
        },
      });

      // mriLayer is already known (in the layer state), but hasn't landed in nv.volumes yet
      // (its own load is still in flight) — the ESI volume must not jump ahead of it.
      expect(nv.addVolumesFromUrl).not.toHaveBeenCalled();

      // The MRI load finishes: it lands in nv.volumes, and something re-renders the hook with a
      // new layer state (simulated here by an empty settings patch, which yields a new state object).
      nv.volumes = [{ id: 'vol-mri' }];
      act(() => {
        result.current.dispatchLayers({ type: UPDATE_SETTINGS, url: 'blob:mri', patch: {} });
      });

      await waitFor(() => expect(nv.addVolumesFromUrl).toHaveBeenCalled());
    });

    it('tears down the volume when esiLayer becomes null', async () => {
      const esiLayer = makeEsiLayer();
      const { rerender } = renderHook((props) => useHarness(props), {
        initialProps: { esiLayer, isEsiVolumeMode: true, nvRef },
      });
      await waitFor(() => expect(nv.volumes).toHaveLength(1));

      rerender({ esiLayer: null, isEsiVolumeMode: true, nvRef });
      expect(nv.removeVolumeByIndex).toHaveBeenCalledWith(0);
    });
  });
});
