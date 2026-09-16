import { StrictMode, useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useElectrodeConnectome } from '@/hooks/useElectrodeConnectome';
import { ELECTRODE_LAYER_URL } from '@/utils/NiiViewer.utils';
import { EEG_NODE_POS_KEY, EEG_NODE_NEG_KEY } from '@/utils/eegColormaps';

// This hook is otherwise only exercised indirectly through NiiViewer.test.jsx's
// 'connectome layer (electrodes)' describe block (same reasoning as useEsiLayer.test.js) —
// these tests cover the guard/rebuild bookkeeping and electrode display mode wiring directly.

const makeElectrodeLayer = (overrides = {}) => ({
  url: ELECTRODE_LAYER_URL,
  name: 'Intracranial EEG Electrodes',
  type: 'Electrodes',
  subtype: 'Intracranial EEG',
  kind: 'connectome',
  nodes: [
    { name: 'B1', x: 0, y: 0, z: 0, colorValue: 1, sizeValue: 1, metrics: { spike_count: 10 } },
    { name: 'B2', x: 1, y: 0, z: 0, colorValue: -1, sizeValue: 1, metrics: {} },
  ],
  edges: [{ first: 0, second: 1, colorValue: 1 }],
  calMax: 1,
  availableMetrics: ['spike_count'],
  metricMax: { spike_count: 10 },
  hasVoltageSnapshot: true,
  ...overrides,
});

function makeNv() {
  const nv = {
    meshes: [],
    loadConnectomeAsMesh: vi.fn((json) => ({ ...json, opacity: 1, updateMesh: vi.fn() })),
    addMesh: vi.fn((mesh) => nv.meshes.push(mesh)),
    removeMesh: vi.fn((mesh) => {
      nv.meshes = nv.meshes.filter((m) => m !== mesh);
    }),
    setMeshShader: vi.fn(),
    updateGLVolume: vi.fn(),
    opts: {},
  };
  return nv;
}

// Wraps useElectrodeConnectome with the orderedLayers/layerSettings state it expects its
// caller to own, mirroring how NiiViewer itself supplies them. Both start empty — a settings
// entry only exists once the hook's own merge effect creates one (via getInitialLayerSettings),
// same as in the real app; tests that need a specific electrodeDisplayMode drive it afterward
// via the returned setLayerSettings, mirroring NiiViewer's handleSettingChange.
function useHarness({ electrodeLayer, nvRef }) {
  const [orderedLayers, setOrderedLayers] = useState([]);
  const [layerSettings, setLayerSettings] = useState([]);
  const hookResult = useElectrodeConnectome({
    electrodeLayer,
    nvRef,
    orderedLayers,
    layerSettings,
    setOrderedLayers,
    setLayerSettings,
  });
  return { orderedLayers, layerSettings, setOrderedLayers, setLayerSettings, ...hookResult };
}

// Changes the Electrodes layer's electrodeDisplayMode the same way NiiViewer's
// handleSettingChange does — by updating the settings entry already merged in by the hook.
function setDisplayMode(result, mode) {
  act(() => {
    result.current.setLayerSettings((prev) =>
      prev.map((s) => (s.url === ELECTRODE_LAYER_URL ? { ...s, electrodeDisplayMode: mode } : s))
    );
  });
}

// Changes the Electrodes layer's showColorbar the same way ImagingControls's Colorbar
// ToggleSwitch does.
function setShowColorbar(result, value) {
  act(() => {
    result.current.setLayerSettings((prev) =>
      prev.map((s) => (s.url === ELECTRODE_LAYER_URL ? { ...s, showColorbar: value } : s))
    );
  });
}

describe('useElectrodeConnectome', () => {
  let nv;
  let nvRef;
  beforeEach(() => {
    nv = makeNv();
    nvRef = { current: nv };
  });

  it('does nothing when electrodeLayer is null', () => {
    const { result } = renderHook((props) => useHarness(props), {
      initialProps: { electrodeLayer: null, nvRef },
    });
    expect(result.current.orderedLayers).toEqual([]);
    expect(nv.addMesh).not.toHaveBeenCalled();
  });

  it('merges the layer into orderedLayers/layerSettings by the electrode sentinel url', () => {
    const electrodeLayer = makeElectrodeLayer();
    const { result } = renderHook((props) => useHarness(props), {
      initialProps: { electrodeLayer, nvRef },
    });
    expect(result.current.orderedLayers).toEqual([electrodeLayer]);
    expect(result.current.layerSettings).toHaveLength(1);
    expect(result.current.layerSettings[0].url).toBe(ELECTRODE_LAYER_URL);
  });

  it('builds and adds a connectome mesh via loadConnectomeAsMesh + addMesh', () => {
    const electrodeLayer = makeElectrodeLayer();
    const { result } = renderHook((props) => useHarness(props), {
      initialProps: { electrodeLayer, nvRef },
    });
    expect(nv.loadConnectomeAsMesh).toHaveBeenCalled();
    expect(nv.addMesh).toHaveBeenCalled();
    expect(result.current.electrodeMeshRef.current).toBeTruthy();
    expect(nv.setMeshShader).toHaveBeenCalledWith(
      result.current.electrodeMeshRef.current.id,
      'Harmonic'
    );
  });

  it('defaults to None mode when the layer first appears (getInitialLayerSettings default)', () => {
    const electrodeLayer = makeElectrodeLayer();
    renderHook((props) => useHarness(props), { initialProps: { electrodeLayer, nvRef } });
    const call = nv.loadConnectomeAsMesh.mock.calls[0][0];
    expect(call.nodes[0]).toMatchObject({ colorValue: 0, sizeValue: 1 }); // None mode's mapping
    expect(call.nodeMaxColor).toBe(1e-6); // no metricMax entry for 'none' — the same floor calMax uses
  });

  describe('electrode display mode', () => {
    it("passes voltage-coded nodes and calMax through unchanged for 'voltage' mode", () => {
      const electrodeLayer = makeElectrodeLayer();
      const { result } = renderHook((props) => useHarness(props), {
        initialProps: { electrodeLayer, nvRef },
      });
      setDisplayMode(result, 'voltage');

      const call = nv.loadConnectomeAsMesh.mock.calls.at(-1)[0];
      expect(call.nodes).toBe(electrodeLayer.nodes); // same reference — no remapping needed
      expect(call.nodeMaxColor).toBe(electrodeLayer.calMax);
    });

    it("zeroes colorValue and fixes sizeValue to 1 for 'none' mode", () => {
      const electrodeLayer = makeElectrodeLayer();
      const { result } = renderHook((props) => useHarness(props), {
        initialProps: { electrodeLayer, nvRef },
      });
      setDisplayMode(result, 'voltage'); // move away from the default first...
      setDisplayMode(result, 'none'); // ...then explicitly back, to prove this is an active reset

      const call = nv.loadConnectomeAsMesh.mock.calls.at(-1)[0];
      expect(call.nodes[0]).toMatchObject({ colorValue: 0, sizeValue: 1 });
      expect(call.nodes[1]).toMatchObject({ colorValue: 0, sizeValue: 1 });
    });

    it('maps a metric name to colorValue/sizeValue and uses that metric’s own max as nodeMaxColor', () => {
      const electrodeLayer = makeElectrodeLayer();
      const { result } = renderHook((props) => useHarness(props), {
        initialProps: { electrodeLayer, nvRef },
      });
      setDisplayMode(result, 'spike_count');

      const call = nv.loadConnectomeAsMesh.mock.calls.at(-1)[0];
      expect(call.nodes[0]).toMatchObject({ colorValue: 10, sizeValue: 1 }); // B1: 10 / metricMax 10
      expect(call.nodes[1]).toMatchObject({ colorValue: 0, sizeValue: 0 }); // B2 has no spike_count
      expect(call.nodeMaxColor).toBe(10); // metricMax.spike_count, not calMax
    });

    it('rebuilds the mesh when only the display mode changes, same electrodeLayer object', () => {
      const electrodeLayer = makeElectrodeLayer();
      const { result } = renderHook((props) => useHarness(props), {
        initialProps: { electrodeLayer, nvRef },
      });
      nv.loadConnectomeAsMesh.mockClear();
      nv.removeMesh.mockClear();

      setDisplayMode(result, 'voltage');

      expect(nv.removeMesh).toHaveBeenCalled();
      const call = nv.loadConnectomeAsMesh.mock.calls.at(-1)[0];
      expect(call.nodeMaxColor).toBe(electrodeLayer.calMax);
    });

    it('does not rebuild when an unrelated settings change (e.g. nodeScale) leaves the mode untouched', () => {
      const electrodeLayer = makeElectrodeLayer();
      const { result } = renderHook((props) => useHarness(props), {
        initialProps: { electrodeLayer, nvRef },
      });
      nv.loadConnectomeAsMesh.mockClear();

      act(() => {
        result.current.setLayerSettings((prev) =>
          prev.map((s) => (s.url === ELECTRODE_LAYER_URL ? { ...s, nodeScale: 8 } : s))
        );
      });

      expect(nv.loadConnectomeAsMesh).not.toHaveBeenCalled();
    });
  });

  describe('colorbar-only mesh', () => {
    // showColorbar defaults to false and electrodeDisplayMode defaults to 'none' (see
    // getInitialLayerSettings), so the very first render already covers "neither is on".

    it('does not build a colorbar mesh while showColorbar is off', () => {
      const electrodeLayer = makeElectrodeLayer();
      const { result } = renderHook((props) => useHarness(props), {
        initialProps: { electrodeLayer, nvRef },
      });
      setDisplayMode(result, 'voltage');

      expect(nv.meshes).toHaveLength(1); // only the real electrode mesh
    });

    it('does not build a colorbar mesh when electrodeDisplayMode is None, even with showColorbar on', () => {
      const electrodeLayer = makeElectrodeLayer();
      const { result } = renderHook((props) => useHarness(props), {
        initialProps: { electrodeLayer, nvRef },
      });
      setShowColorbar(result, true); // mode is still the default 'none'

      expect(nv.meshes).toHaveLength(1);
    });

    it('builds a second, colorbar-only mesh once showColorbar is on and a metric is selected', () => {
      const electrodeLayer = makeElectrodeLayer();
      const { result } = renderHook((props) => useHarness(props), {
        initialProps: { electrodeLayer, nvRef },
      });
      setDisplayMode(result, 'voltage');
      setShowColorbar(result, true);

      expect(nv.meshes).toHaveLength(2); // the real mesh + the colorbar-only mesh
      const call = nv.loadConnectomeAsMesh.mock.calls.at(-1)[0];
      expect(call.nodes).toHaveLength(1); // a single throwaway node, just to avoid NiiVue's own "empty mesh" error log
      expect(call.edges).toEqual([]);
      expect(call.colorbarVisible).toBe(true);
      expect(call.edgeColormap).toBe(EEG_NODE_POS_KEY);
      expect(call.edgeColormapNegative).toBe(EEG_NODE_NEG_KEY);
      expect(call.edgeMin).toBe(0);
      expect(call.edgeMax).toBe(electrodeLayer.calMax); // mirrors nodeMaxColor for 'voltage' mode
    });

    it('mirrors edgeMax to the selected metric’s own max, not calMax, for a non-voltage metric', () => {
      const electrodeLayer = makeElectrodeLayer();
      const { result } = renderHook((props) => useHarness(props), {
        initialProps: { electrodeLayer, nvRef },
      });
      setDisplayMode(result, 'spike_count');
      setShowColorbar(result, true);

      const call = nv.loadConnectomeAsMesh.mock.calls.at(-1)[0];
      expect(call.edgeMax).toBe(electrodeLayer.metricMax.spike_count);
    });

    it('removes the colorbar-only mesh when showColorbar is toggled back off', () => {
      const electrodeLayer = makeElectrodeLayer();
      const { result } = renderHook((props) => useHarness(props), {
        initialProps: { electrodeLayer, nvRef },
      });
      setDisplayMode(result, 'voltage');
      setShowColorbar(result, true);
      expect(nv.meshes).toHaveLength(2);

      setShowColorbar(result, false);

      expect(nv.meshes).toHaveLength(1); // only the real electrode mesh remains
    });

    it('also tears down the colorbar-only mesh when electrodeLayer becomes null', () => {
      const electrodeLayer = makeElectrodeLayer();
      const { result, rerender } = renderHook((props) => useHarness(props), {
        initialProps: { electrodeLayer, nvRef },
      });
      setDisplayMode(result, 'voltage');
      setShowColorbar(result, true);
      expect(nv.meshes).toHaveLength(2);

      rerender({ electrodeLayer: null, nvRef });

      expect(nv.meshes).toHaveLength(0);
    });

    it("reflects this layer's own showColorbar setting onto the nv.opts.isColorbar master switch", () => {
      const electrodeLayer = makeElectrodeLayer();
      const { result } = renderHook((props) => useHarness(props), {
        initialProps: { electrodeLayer, nvRef },
      });
      setDisplayMode(result, 'voltage');
      expect(nv.opts.isColorbar).toBe(false);

      setShowColorbar(result, true);
      expect(nv.opts.isColorbar).toBe(true);

      setShowColorbar(result, false);
      expect(nv.opts.isColorbar).toBe(false);
    });
  });

  it('tears down the mesh when electrodeLayer becomes null', () => {
    const electrodeLayer = makeElectrodeLayer();
    const { result, rerender } = renderHook((props) => useHarness(props), {
      initialProps: { electrodeLayer, nvRef },
    });
    const mesh = result.current.electrodeMeshRef.current;

    rerender({ electrodeLayer: null, nvRef });

    expect(nv.removeMesh).toHaveBeenCalledWith(mesh);
    expect(result.current.orderedLayers).toEqual([]);
  });

  it('still has exactly one mesh in the scene after a StrictMode mount→unmount→remount cycle', () => {
    const electrodeLayer = makeElectrodeLayer();
    renderHook((props) => useHarness(props), {
      initialProps: { electrodeLayer, nvRef },
      wrapper: StrictMode,
    });
    expect(nv.meshes).toHaveLength(1);
  });

  describe('dismissElectrodeLayer / clearElectrodeMesh', () => {
    // Mirrors NiiViewer's handleDeleteLayer + PatientView's onElectrodeLayerDismissed: in the
    // real app these land in the same batched update (the click handler synchronously calls
    // dismissElectrodeLayer() and triggers the parent to flip electrodeRenderEnabled off,
    // which makes the next electrodeLayer prop null) — so the two are simulated together here.
    it('dismissing the current layer removes its card cleanly, without an extra rebuild', () => {
      const electrodeLayer = makeElectrodeLayer();
      const { result, rerender } = renderHook((props) => useHarness(props), {
        initialProps: { electrodeLayer, nvRef },
      });
      expect(result.current.orderedLayers).toHaveLength(1);

      act(() => {
        result.current.clearElectrodeMesh();
        result.current.dismissElectrodeLayer();
      });
      rerender({ electrodeLayer: null, nvRef });

      expect(result.current.orderedLayers).toEqual([]);
      expect(nv.loadConnectomeAsMesh).toHaveBeenCalledTimes(1); // no rebuild attempted during teardown
    });

    it('a genuinely new electrodeLayer object after dismissal is shown again', () => {
      const electrodeLayer = makeElectrodeLayer();
      const { result, rerender } = renderHook((props) => useHarness(props), {
        initialProps: { electrodeLayer, nvRef },
      });

      act(() => {
        result.current.clearElectrodeMesh();
        result.current.dismissElectrodeLayer();
      });
      rerender({ electrodeLayer: null, nvRef }); // the real transition path — see the test above

      const freshElectrodeLayer = makeElectrodeLayer(); // a new object, e.g. the next voltage click
      rerender({ electrodeLayer: freshElectrodeLayer, nvRef });

      expect(result.current.orderedLayers).toEqual([freshElectrodeLayer]);
    });
  });
});
