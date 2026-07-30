import { useRef, useEffect, useCallback } from 'react';
import {
  getInitialLayerSettings,
  getCurrentMeshXRay,
  makeLayerMergeUpdater,
  makeSettingsMergeUpdater,
  ELECTRODE_LAYER_URL,
} from '@/utils/NiiViewer.utils';
import { EEG_NODE_POS_KEY, EEG_NODE_NEG_KEY } from '@/utils/eegColormaps';

/**
 * Merges `electrodeLayer` into orderedLayers/layerSettings by its sentinel URL, and
 * builds/rebuilds/removes the actual NiiVue connectome mesh whenever its data changes. Rebuilt
 * wholesale on every change rather than mutated in place — mirrors how EegTopoViewer rebuilds
 * its own mesh on every topoTimepoint click.
 *
 * @param {Object} params
 * @param {Object|null} params.electrodeLayer - the connectome data to show (nodes/edges/
 *   calMax/name), or null to remove it. Kept separate from a general `layers` list so a
 *   voltage-driven refresh never resets other layers' settings.
 * @param {React.RefObject} params.nvRef - the shared, long-lived NiiVue instance ref; both
 *   effects no-op until it's set.
 * @param {Array} params.orderedLayers - the full ordered layer list, read to find this layer's
 *   existing settings (by sentinel URL) when rebuilding the mesh.
 * @param {Array} params.layerSettings - the parallel per-layer settings array, read for the
 *   same reason.
 * @param {Function} params.setOrderedLayers - React setState for `orderedLayers`; called with
 *   a merge-updater function each time `electrodeLayer` changes.
 * @param {Function} params.setLayerSettings - React setState for `layerSettings`; called with
 *   a merge-updater function each time `electrodeLayer` changes.
 * @returns {Object}
 *   - `electrodeMeshRef` (RefObject) — the current connectome mesh in the scene, or null if
 *     none — read-only from outside this hook; needed by the caller's own handleSettingChange
 *     to mutate mesh properties directly (connectome meshes aren't indexed in `nv.volumes`).
 *   - `clearElectrodeMesh` (Function) — call after the caller itself removes the mesh from
 *     nv (e.g. in handleDeleteLayer) to reset the ref to null; mutating `.current` from outside
 *     this hook isn't allowed, so this is the sanctioned way to clear it externally.
 *   - `dismissElectrodeLayer` (Function) — call from handleDeleteLayer alongside
 *     clearElectrodeMesh so the merge effect stops resurrecting the just-deleted card until
 *     electrodeLayer actually changes upstream (the next voltage update).
 */
export function useElectrodeConnectome({
  electrodeLayer,
  nvRef,
  orderedLayers,
  layerSettings,
  setOrderedLayers,
  setLayerSettings,
}) {
  const electrodeMeshRef = useRef(null); // current intracranial connectome mesh in the scene
  const lastElectrodeLayerRef = useRef(null); // guards against rebuilding on unrelated re-renders
  // The specific electrodeLayer object dismissed via handleDeleteLayer, if any. Not a boolean:
  // electrodeLayer is a prop that PatientView keeps recomputing from live EEG data, so a plain
  // "dismissed = true" flag could never be un-set. Storing the reference lets the merge effect
  // below tell "still that same stale layer" from "genuinely new data" by identity — the
  // dismissal auto-expires the moment a new object arrives, no explicit undo needed.
  const dismissedElectrodeLayerRef = useRef(null);

  // Sanctioned way for the caller to reset electrodeMeshRef after it removes the mesh from
  // nv itself (e.g. handleDeleteLayer) — external code can read `.current` but isn't allowed to
  // write it directly, since the ref is owned by this hook.
  const clearElectrodeMesh = useCallback(() => {
    electrodeMeshRef.current = null;
  }, []);
  // Snapshots whichever object is currently on screen (lastElectrodeLayerRef, kept current by
  // the build effect below) as dismissed, so the merge effect recognizes and ignores it.
  const dismissElectrodeLayer = useCallback(() => {
    dismissedElectrodeLayerRef.current = lastElectrodeLayerRef.current;
  }, []);

  // Keeps the ImagingControls card list in sync with electrodeLayer. This effect only touches
  // React state (orderedLayers/layerSettings) — it doesn't touch the 3D scene itself; building/
  // removing the actual NiiVue mesh is the separate effect below.
  useEffect(() => {
    // electrodeLayer keeps recomputing from live EEG data (a new object on every voltage
    // update), so just deleting its card wouldn't stop it coming back on the next click.
    // dismissElectrodeLayer() (called from handleDeleteLayer) remembers *that exact object* as
    // dismissed, so until a genuinely new electrodeLayer arrives, treat it as if there were none.
    const effectiveElectrodeLayer =
      electrodeLayer && electrodeLayer === dismissedElectrodeLayerRef.current
        ? null
        : electrodeLayer;

    // Add/update/remove the one card matching ELECTRODE_LAYER_URL, leaving every other card
    // (image volumes, ESI, file meshes...) untouched.
    setOrderedLayers(makeLayerMergeUpdater(effectiveElectrodeLayer, ELECTRODE_LAYER_URL));
    // Same for its settings entry (opacity/visibility/etc.), carrying over the scene's current
    // meshXRay value so a newly (re)appearing card doesn't reset that shared setting.
    setLayerSettings(
      makeSettingsMergeUpdater(
        effectiveElectrodeLayer,
        ELECTRODE_LAYER_URL,
        undefined,
        getCurrentMeshXRay(orderedLayers, layerSettings)
      )
    );
    // The two setState calls above are separate, not nested — nesting made StrictMode's
    // double-invoke add the settings entry twice, misaligning the two arrays and crashing
    // handleNiiFiles.
  }, [electrodeLayer, orderedLayers, layerSettings, setOrderedLayers, setLayerSettings]);

  // Builds/rebuilds/removes the actual NiiVue mesh in the 3D scene whenever electrodeLayer
  // changes — the counterpart to the effect above, which only manages the card list state.
  useEffect(() => {
    const nv = nvRef.current; // guard clause — nothing to do before NiiVue has attached to a canvas
    if (!nv) return;

    if (!electrodeLayer) {
      // No connectome to show anymore (e.g. positions/EEG cleared) — tear down the existing mesh, if any.
      if (electrodeMeshRef.current) {
        nv.removeMesh(electrodeMeshRef.current); // drop it from the 3D scene
        electrodeMeshRef.current = null; // nothing left to track
        lastElectrodeLayerRef.current = null; // so a future re-add isn't mistaken for "unchanged"
        nv.updateGLVolume(); // redraw without it
      }
      return;
    }

    if (electrodeLayer === lastElectrodeLayerRef.current) return; // unrelated re-render (e.g. another layer's settings changed)
    lastElectrodeLayerRef.current = electrodeLayer; // remember what this rebuild is based on

    if (electrodeMeshRef.current) nv.removeMesh(electrodeMeshRef.current); // drop the stale mesh before building its replacement

    // Apply whatever opacity/visibility/nodeScale/edgeScale is already set for this layer
    // (preserved across data refreshes); fall back to the same default that would be computed
    // if it hasn't run yet this render pass (e.g. the connectome's first appearance, before
    // orderedLayers/layerSettings have caught up). Computed before the mesh below so its
    // nodeScale/edgeScale can seed loadConnectomeAsMesh rather than resetting to the default.
    const existingIndex = orderedLayers.findIndex((l) => l.url === ELECTRODE_LAYER_URL); // its current position in the card list, if it has one yet
    const settings =
      layerSettings[existingIndex] ?? // its existing settings, preserved across this rebuild
      getInitialLayerSettings(
        [electrodeLayer],
        orderedLayers.length,
        undefined,
        getCurrentMeshXRay(orderedLayers, layerSettings)
      )[0]; // or computed fresh on first appearance

    // Build the new connectome mesh in memory — not yet added to the scene.
    const mesh = nv.loadConnectomeAsMesh({
      name: electrodeLayer.name,
      nodeColormap: EEG_NODE_POS_KEY,
      nodeColormapNegative: EEG_NODE_NEG_KEY,
      nodeMinColor: 0,
      nodeMaxColor: electrodeLayer.calMax,
      nodeScale: settings.nodeScale,
      edgeColormap: 'gray',
      edgeColormapNegative: 'gray',
      edgeMin: 0,
      edgeMax: 2, // edges carry a fixed colorValue (see buildIntracranialConnectome) => fix calMax to 2, with colorValue=1 this gives gray edge color
      edgeScale: settings.edgeScale,
      showLegend: false,
      colorbarVisible: false, // suppresses the node+edge colorbar entries NiiVue would otherwise add for a populated `edges` array
      nodes: electrodeLayer.nodes,
      edges: electrodeLayer.edges,
    });

    mesh.opacity = settings.visible ? settings.opacity : 0; // 0 opacity is how a hidden mesh is represented, same convention as image volumes
    // nv.opts.meshXRay is a scene-global NiiVue option, not a per-mesh property, and NiiVue's
    // own default (0) doesn't match this app's default (1, see getInitialLayerSettings) — apply
    // it here on build, or the card's slider would show 100% while the mesh actually renders
    // opaque until the user drags the slider once.
    nv.opts.meshXRay = settings.meshXRay;

    nv.addMesh(mesh); // actually add it to the 3D scene
    nv.setMeshShader(mesh.id, 'Harmonic'); // Set Mesh Shader
    electrodeMeshRef.current = mesh; // track it so the next change/removal can find it
    nv.updateGLVolume(); // redraw with the new mesh visible
  }, [electrodeLayer, orderedLayers, layerSettings, nvRef]);

  return {
    electrodeMeshRef,
    clearElectrodeMesh,
    dismissElectrodeLayer,
  };
}
