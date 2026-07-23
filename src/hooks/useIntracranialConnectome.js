import { useRef, useEffect, useCallback } from 'react';
import {
  getInitialLayerSettings,
  getCurrentMeshXRay,
  makeLayerMergeUpdater,
  makeSettingsMergeUpdater,
  INTRACRANIAL_CONNECTOME_URL,
} from '@/utils/NiiViewer.utils';
import { EEG_NODE_POS_KEY, EEG_NODE_NEG_KEY } from '@/utils/eegColormaps';

/**
 * Merges `intracranialLayer` into orderedLayers/layerSettings by its sentinel URL, and
 * builds/rebuilds/removes the actual NiiVue connectome mesh whenever its data changes. Rebuilt
 * wholesale on every change rather than mutated in place — mirrors how EegTopoViewer rebuilds
 * its own mesh on every topoTimepoint click.
 *
 * @param {Object} params
 * @param {Object|null} params.intracranialLayer - the connectome data to show (nodes/edges/
 *   calMax/name), or null to remove it. Kept separate from a general `layers` list so a
 *   voltage-driven refresh never resets other layers' settings.
 * @param {React.RefObject} params.nvRef - the shared, long-lived NiiVue instance ref; both
 *   effects no-op until it's set.
 * @param {Array} params.orderedLayers - the full ordered layer list, read to find this layer's
 *   existing settings (by sentinel URL) when rebuilding the mesh.
 * @param {Array} params.layerSettings - the parallel per-layer settings array, read for the
 *   same reason.
 * @param {Function} params.setOrderedLayers - React setState for `orderedLayers`; called with
 *   a merge-updater function each time `intracranialLayer` changes.
 * @param {Function} params.setLayerSettings - React setState for `layerSettings`; called with
 *   a merge-updater function each time `intracranialLayer` changes.
 * @returns {Object}
 *   - `intracranialMeshRef` (RefObject) — the current connectome mesh in the scene, or null if
 *     none — read-only from outside this hook; needed by the caller's own handleSettingChange
 *     to mutate mesh properties directly (connectome meshes aren't indexed in `nv.volumes`).
 *   - `clearIntracranialMesh` (Function) — call after the caller itself removes the mesh from
 *     nv (e.g. in handleDeleteLayer) to reset the ref to null; mutating `.current` from outside
 *     this hook isn't allowed, so this is the sanctioned way to clear it externally.
 */
export function useIntracranialConnectome({
  intracranialLayer,
  nvRef,
  orderedLayers,
  layerSettings,
  setOrderedLayers,
  setLayerSettings,
}) {
  const intracranialMeshRef = useRef(null); // current intracranial connectome mesh in the scene
  const lastIntracranialLayerRef = useRef(null); // guards against rebuilding on unrelated re-renders

  // Sanctioned way for the caller to reset intracranialMeshRef after it removes the mesh from
  // nv itself (e.g. handleDeleteLayer) — external code can read `.current` but isn't allowed to
  // write it directly, since the ref is owned by this hook.
  const clearIntracranialMesh = useCallback(() => {
    intracranialMeshRef.current = null;
  }, []);

  // Merges intracranialLayer into orderedLayers/layerSettings by its sentinel URL so it
  // appears in the ImagingControls card list without disturbing other layers' settings on
  // every voltage-driven refresh. Two independent setState calls (not nested) — nesting
  // caused StrictMode's double-invoke to append the settings entry twice, misaligning
  // the arrays and crashing handleNiiFiles. Each updater is idempotent on its own.
  useEffect(() => {
    setOrderedLayers(makeLayerMergeUpdater(intracranialLayer, INTRACRANIAL_CONNECTOME_URL));
    setLayerSettings(
      makeSettingsMergeUpdater(
        intracranialLayer,
        INTRACRANIAL_CONNECTOME_URL,
        undefined,
        getCurrentMeshXRay(orderedLayers, layerSettings)
      )
    );
  }, [intracranialLayer, orderedLayers, layerSettings, setOrderedLayers, setLayerSettings]);

  useEffect(() => {
    const nv = nvRef.current; // guard clause — nothing to do before NiiVue has attached to a canvas
    if (!nv) return;

    if (!intracranialLayer) {
      // No connectome to show anymore (e.g. positions/EEG cleared) — tear down the existing mesh, if any.
      if (intracranialMeshRef.current) {
        nv.removeMesh(intracranialMeshRef.current); // drop it from the 3D scene
        intracranialMeshRef.current = null; // nothing left to track
        lastIntracranialLayerRef.current = null; // so a future re-add isn't mistaken for "unchanged"
        nv.updateGLVolume(); // redraw without it
      }
      return;
    }

    if (intracranialLayer === lastIntracranialLayerRef.current) return; // unrelated re-render (e.g. another layer's settings changed)
    lastIntracranialLayerRef.current = intracranialLayer; // remember what this rebuild is based on

    if (intracranialMeshRef.current) nv.removeMesh(intracranialMeshRef.current); // drop the stale mesh before building its replacement

    // Build the new connectome mesh in memory — not yet added to the scene.
    const mesh = nv.loadConnectomeAsMesh({
      name: intracranialLayer.name,
      nodeColormap: EEG_NODE_POS_KEY,
      nodeColormapNegative: EEG_NODE_NEG_KEY,
      nodeMinColor: 0,
      nodeMaxColor: intracranialLayer.calMax,
      nodeScale: 4,
      edgeColormap: EEG_NODE_POS_KEY,
      edgeColormapNegative: EEG_NODE_NEG_KEY,
      edgeMin: 0,
      edgeMax: intracranialLayer.calMax,
      edgeScale: 0.5,
      showLegend: false,
      colorbarVisible: false, // suppresses the node+edge colorbar entries NiiVue would otherwise add for a populated `edges` array
      nodes: intracranialLayer.nodes,
      edges: intracranialLayer.edges,
    });

    // Apply whatever opacity/visibility is already set for this layer (preserved across
    // data refreshes by the sync effect above); fall back to the same default that effect
    // would compute if it hasn't run yet this render pass (e.g. the connectome's first
    // appearance, before orderedLayers/layerSettings have caught up).
    const existingIndex = orderedLayers.findIndex((l) => l.url === INTRACRANIAL_CONNECTOME_URL); // its current position in the card list, if it has one yet
    const settings =
      layerSettings[existingIndex] ?? // its existing settings, preserved across this rebuild
      getInitialLayerSettings(
        [intracranialLayer],
        orderedLayers.length,
        undefined,
        getCurrentMeshXRay(orderedLayers, layerSettings)
      )[0]; // or computed fresh on first appearance
    mesh.opacity = settings.visible ? settings.opacity : 0; // 0 opacity is how a hidden mesh is represented, same convention as image volumes
    // nv.opts.meshXRay is a scene-global NiiVue option, not a per-mesh property, and NiiVue's
    // own default (0) doesn't match this app's default (1, see getInitialLayerSettings) — apply
    // it here on build, or the card's slider would show 100% while the mesh actually renders
    // opaque until the user drags the slider once.
    nv.opts.meshXRay = settings.meshXRay;

    nv.addMesh(mesh); // actually add it to the 3D scene
    intracranialMeshRef.current = mesh; // track it so the next change/removal can find it
    nv.updateGLVolume(); // redraw with the new mesh visible
  }, [intracranialLayer, orderedLayers, layerSettings, nvRef]);

  return { intracranialMeshRef, clearIntracranialMesh };
}
