import { useRef, useEffect, useCallback } from 'react';
import {
  getInitialLayerSettings,
  getCurrentMeshXRay,
  makeLayerMergeUpdater,
  makeSettingsMergeUpdater,
  ELECTRODE_LAYER_URL,
} from '@/utils/NiiViewer.utils';
import { applyElectrodeDisplayMode } from '@/utils/eegTopographyUtils';
import { EEG_NODE_POS_KEY, EEG_NODE_NEG_KEY } from '@/utils/eegColormaps';

/**
 * Keeps the Electrodes connectome layer in sync with `electrodeLayer`: merges it into the
 * ImagingControls card list (orderedLayers/layerSettings), and builds/rebuilds/removes the
 * actual NiiVue mesh whenever its data changes. Rebuilt wholesale rather than mutated in
 * place — mirrors how EegTopoViewer rebuilds its own mesh on every topoTimepoint click.
 *
 * @param {Object} params
 * @param {Object|null} params.electrodeLayer - connectome data to show (nodes/edges/calMax/
 *   name), or null to remove it. Kept separate from `layers` so a voltage-driven refresh
 *   never resets other layers' settings.
 * @param {React.RefObject} params.nvRef - the shared NiiVue instance ref; both effects
 *   no-op until it's set.
 * @param {Array} params.orderedLayers - full ordered layer list, read to find this layer's
 *   existing settings by sentinel URL.
 * @param {Array} params.layerSettings - the parallel per-layer settings array.
 * @param {Function} params.setOrderedLayers
 * @param {Function} params.setLayerSettings - React setters, each called with a
 *   merge-updater whenever `electrodeLayer` changes.
 * @returns {Object}
 *   - `electrodeMeshRef` — the current mesh in the scene, or null. Read-only outside this
 *     hook; NiiViewer's handleSettingChange uses it to mutate mesh properties directly
 *     (connectome meshes aren't indexed in `nv.volumes`).
 *   - `clearElectrodeMesh` — call after the caller itself removes the mesh from `nv` (e.g.
 *     handleDeleteLayer), since `.current` can't be written from outside this hook.
 *   - `dismissElectrodeLayer` — call from handleDeleteLayer so the card-sync effect stops
 *     resurrecting the just-deleted card until a genuinely new `electrodeLayer` arrives.
 */
export function useElectrodeConnectome({
  electrodeLayer,
  nvRef,
  orderedLayers,
  layerSettings,
  setOrderedLayers,
  setLayerSettings,
}) {
  // ─── Refs ───────────────────────────────────────────────────────────────────
  const electrodeMeshRef = useRef(null); // mesh currently in the scene, if any
  const lastElectrodeLayerRef = useRef(null); // last layer built from — guards redundant rebuilds
  const lastElectrodeDisplayModeRef = useRef(null); // same, for the Electrode Display mode
  // The specific electrodeLayer dismissed via handleDeleteLayer. Not a boolean: electrodeLayer
  // keeps recomputing from live EEG data, so a plain flag could never be un-set — storing the
  // object lets the sync effect tell "still that stale layer" from "genuinely new data" by
  // identity, auto-expiring the moment a new object arrives.
  const dismissedElectrodeLayerRef = useRef(null);

  // Sanctioned setters for the refs above — external code may read `.current`, not write it.
  const clearElectrodeMesh = useCallback(() => {
    electrodeMeshRef.current = null;
  }, []);
  const dismissElectrodeLayer = useCallback(() => {
    dismissedElectrodeLayerRef.current = lastElectrodeLayerRef.current;
  }, []);

  // ─── Effect: sync the ImagingControls card list ─────────────────────────────
  // React state only — doesn't touch the 3D scene (that's the effect below).
  useEffect(() => {
    // Treat a dismissed layer as absent until a genuinely new object arrives upstream.
    const effectiveElectrodeLayer =
      electrodeLayer && electrodeLayer === dismissedElectrodeLayerRef.current
        ? null
        : electrodeLayer;

    // Add/update/remove only the Electrodes card, leaving every other layer untouched.
    // getCurrentMeshXRay carries over the scene's current value, so a reappearing card
    // doesn't reset that shared setting.
    setOrderedLayers(makeLayerMergeUpdater(effectiveElectrodeLayer, ELECTRODE_LAYER_URL));
    setLayerSettings(
      makeSettingsMergeUpdater(
        effectiveElectrodeLayer,
        ELECTRODE_LAYER_URL,
        undefined,
        getCurrentMeshXRay(orderedLayers, layerSettings)
      )
    );
    // Two separate setState calls, not nested — nesting doubled the settings entry under
    // StrictMode's double-invoke, misaligning the arrays and crashing handleNiiFiles.
  }, [electrodeLayer, orderedLayers, layerSettings, setOrderedLayers, setLayerSettings]);

  // ─── Effect: build/rebuild/remove the NiiVue mesh ───────────────────────────
  useEffect(() => {
    const nv = nvRef.current;
    if (!nv) return; // no canvas attached yet

    // — Teardown: nothing left to show (positions/EEG cleared) —
    if (!electrodeLayer) {
      if (electrodeMeshRef.current) {
        nv.removeMesh(electrodeMeshRef.current);
        electrodeMeshRef.current = null;
        lastElectrodeLayerRef.current = null; // so a future re-add isn't mistaken for "unchanged"
        lastElectrodeDisplayModeRef.current = null;
        nv.updateGLVolume();
      }
      return;
    }

    // — Resolve this layer's settings —
    // Existing card settings when present (preserved across data refreshes), else freshly
    // defaulted — the connectome's first appearance runs before layerSettings has caught up.
    // Resolved before the guard below (its electrodeDisplayMode feeds that comparison) and
    // before the mesh (nodeScale/edgeScale seed it rather than resetting).
    const existingIndex = orderedLayers.findIndex((l) => l.url === ELECTRODE_LAYER_URL);
    const settings =
      layerSettings[existingIndex] ??
      getInitialLayerSettings(
        [electrodeLayer],
        orderedLayers.length,
        undefined,
        getCurrentMeshXRay(orderedLayers, layerSettings)
      )[0];
    const electrodeDisplayMode = settings.electrodeDisplayMode;

    // — Skip if nothing changed —
    // Same layer, same display mode, and the mesh we built is still really in nv.meshes — that
    // last check matters because StrictMode's mount→unmount→remount silently wipes the mesh
    // even though electrodeLayer/displayMode look unchanged.
    if (
      electrodeLayer === lastElectrodeLayerRef.current &&
      electrodeDisplayMode === lastElectrodeDisplayModeRef.current &&
      nv.meshes.includes(electrodeMeshRef.current)
    ) {
      return;
    }
    lastElectrodeLayerRef.current = electrodeLayer;
    lastElectrodeDisplayModeRef.current = electrodeDisplayMode;

    if (electrodeMeshRef.current) nv.removeMesh(electrodeMeshRef.current); // drop the stale mesh first

    // — Apply the selected display mode —
    // 'voltage' is a passthrough (nodes are already voltage-coded by the builder); 'none' and
    // any metric name are remapped by applyElectrodeDisplayMode. The colour range has to track
    // the same choice: calMax for voltage, that metric's own max otherwise.
    const nodes = applyElectrodeDisplayMode(
      electrodeLayer.nodes,
      electrodeDisplayMode,
      electrodeLayer.metricMax
    );
    // nodeMaxColor sets the max value that clamps the node color map
    // use calMax (already voltage dependant) for voltages and metricMax for other metrics
    const nodeMaxColor =
      electrodeDisplayMode === 'voltage'
        ? electrodeLayer.calMax
        : (electrodeLayer.metricMax?.[electrodeDisplayMode] ?? 1e-6);

    // — Build the mesh and add it to the scene —
    const mesh = nv.loadConnectomeAsMesh({
      name: electrodeLayer.name,
      nodeColormap: EEG_NODE_POS_KEY,
      nodeColormapNegative: EEG_NODE_NEG_KEY,
      nodeMinColor: 0,
      nodeMaxColor,
      nodeScale: settings.nodeScale,
      edgeColormap: 'gray',
      edgeColormapNegative: 'gray',
      edgeMin: 0,
      edgeMax: 2, // edges carry a fixed colorValue of 1 (see buildIntracranialConnectome) — renders them gray
      edgeScale: settings.edgeScale,
      showLegend: false,
      colorbarVisible: false, // suppresses the colorbar NiiVue adds for a populated `edges` array
      nodes,
      edges: electrodeLayer.edges,
    });

    mesh.opacity = settings.visible ? settings.opacity : 0; // 0 = hidden, same convention as image volumes
    // meshXRay is scene-global, and NiiVue's default (0) doesn't match this app's (1) — apply
    // it on build, or the card's slider reads 100% while the mesh renders opaque.
    nv.opts.meshXRay = settings.meshXRay;

    nv.addMesh(mesh);
    nv.setMeshShader(mesh.id, 'Harmonic');
    electrodeMeshRef.current = mesh;
    nv.updateGLVolume();
  }, [electrodeLayer, orderedLayers, layerSettings, nvRef]);

  return {
    electrodeMeshRef,
    clearElectrodeMesh,
    dismissElectrodeLayer,
  };
}
