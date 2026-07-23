import { useRef, useEffect, useCallback } from 'react';
import {
  getInitialLayerSettings,
  makeLayerMergeUpdater,
  makeSettingsMergeUpdater,
  getCalBounds,
  fractionToCalValue,
  isImageVolumeLayer,
  ESI_LAYER_URL,
} from '@/utils/NiiViewer.utils';
import { EEG_NODE_POS_KEY } from '@/utils/eegColormaps';

/**
 * Merges the ESI (Electrical Source Imaging) source-power layer into orderedLayers/
 * layerSettings by its sentinel URL, and builds/rebuilds/removes the NiiVue object
 * representing it whenever its data or the Connectome/Volume toggle changes. Same
 * merge-then-rebuild pattern as useIntracranialConnectome, but branches between two NiiVue
 * object kinds — a connectome mesh or an NVImage volume — depending on `isEsiVolumeMode`.
 *
 * @param {Object} params
 * @param {Object|null} params.esiLayer - the layer carrying both representations of the
 *   current ESI click (`sourcePowerConnectomes` and `sourcePowerVolume`), or null when there's
 *   nothing to show (e.g. no inverse solution loaded, iEEG mode, empty flatSourceFilters).
 * @param {boolean} params.isEsiVolumeMode - true to render `esiLayer.sourcePowerVolume` (an
 *   NVImage), false to render `esiLayer.sourcePowerConnectomes` (a connectome mesh).
 * @param {React.RefObject} params.nvRef - the shared, long-lived NiiVue instance ref; both
 *   effects no-op until it's set.
 * @param {Array} params.orderedLayers - the full ordered layer list, read to find this layer's
 *   existing settings (by sentinel URL) when rebuilding.
 * @param {Array} params.layerSettings - the parallel per-layer settings array, read for the
 *   same reason, and for the user's chosen cal_min/cal_max fractions.
 * @param {Function} params.setOrderedLayers - React setState for `orderedLayers`; called with
 *   a merge-updater function each time the active ESI representation changes.
 * @param {Function} params.setLayerSettings - React setState for `layerSettings`; called with
 *   a merge-updater function each time the active ESI representation changes.
 * @returns {Object}
 *   - `esiMeshRef` (RefObject) — the current ESI connectome mesh in the scene (connectome
 *     mode), or null — read-only from outside this hook; needed by the caller's own
 *     handleSettingChange to mutate mesh properties directly.
 *   - `esiVolumeRef` (RefObject) — the current ESI NVImage volume in the scene (volume mode),
 *     or null — mutually exclusive with `esiMeshRef` at any given time; also read-only.
 *   - `clearEsiMesh` (Function) — call after the caller itself removes the mesh from nv (e.g.
 *     in handleDeleteLayer) to reset `esiMeshRef.current` to null; mutating it directly from
 *     outside this hook isn't allowed.
 *   - `clearEsiVolume` (Function) — same, for `esiVolumeRef.current`.
 */
export function useEsiLayer({
  esiLayer,
  isEsiVolumeMode,
  nvRef,
  orderedLayers,
  layerSettings,
  setOrderedLayers,
  setLayerSettings,
}) {
  const esiMeshRef = useRef(null); // current ESI connectome mesh in the scene (connectome mode)
  const esiVolumeRef = useRef(null); // current ESI NVImage volume in the scene (volume mode) — mutually exclusive with esiMeshRef
  const lastEsiLayerRef = useRef(null); // guards against rebuilding on unrelated re-renders — tracks whichever of the two is active

  // Sanctioned way for the caller to reset these refs after it removes the mesh/volume from nv
  // itself (e.g. handleDeleteLayer) — external code can read `.current` but isn't allowed to
  // write it directly, since the refs are owned by this hook.
  const clearEsiMesh = useCallback(() => {
    esiMeshRef.current = null;
  }, []);
  const clearEsiVolume = useCallback(() => {
    esiVolumeRef.current = null;
  }, []);

  // Merges the separately-tracked esiLayer prop into orderedLayers/layerSettings — same
  // pattern as the intracranialLayer merge effect, keyed on ESI_LAYER_URL.
  useEffect(() => {
    const activeEsiLayer = esiLayer
      ? isEsiVolumeMode
        ? esiLayer.sourcePowerVolume
        : esiLayer.sourcePowerConnectomes
      : esiLayer;

    // Add/replace/remove the ESI entry in orderedLayers to match activeEsiLayer
    setOrderedLayers(makeLayerMergeUpdater(activeEsiLayer, ESI_LAYER_URL));
    // Add/remove its settings entry (visible/opacity/isEsiVolume/etc.); leaves an existing entry untouched
    setLayerSettings(makeSettingsMergeUpdater(activeEsiLayer, ESI_LAYER_URL, isEsiVolumeMode));
  }, [esiLayer, isEsiVolumeMode, setOrderedLayers, setLayerSettings]);

  // Builds/rebuilds/removes the ESI source-power mesh (connectome mode) or NVImage volume
  // (volume mode) whenever esiLayer's data or the Connectome/Volume toggle changes. Same
  // rebuild-on-change pattern as the intracranialLayer build effect, but branches between the
  // two NiiVue object kinds depending on which one activeEsiLayer resolves to.
  useEffect(() => {
    const nv = nvRef.current; // guard — nothing to do before NiiVue has attached to a canvas
    if (!nv) return;

    const activeEsiLayer = esiLayer
      ? isEsiVolumeMode
        ? esiLayer.sourcePowerVolume
        : esiLayer.sourcePowerConnectomes
      : esiLayer;

    if (!activeEsiLayer) {
      // Nothing to show (e.g. no inverse solution loaded, iEEG mode, or empty flatSourceFilters)
      // — tear down whichever of mesh/volume is currently in the scene, if either actually is.
      const hadMesh = esiMeshRef.current;
      const hadVolume = esiVolumeRef.current;
      if (hadMesh) {
        nv.removeMesh(esiMeshRef.current); // drop it from the 3D scene
        esiMeshRef.current = null; // nothing left to track
      }
      if (hadVolume) {
        const staleIndex = nv.volumes.indexOf(esiVolumeRef.current);
        if (staleIndex !== -1) nv.removeVolumeByIndex(staleIndex);
        esiVolumeRef.current = null; // nothing left to track
      }
      lastEsiLayerRef.current = null; // so a future re-add isn't mistaken for "unchanged"
      if (hadMesh || hadVolume) nv.updateGLVolume(); // redraw only if something was actually removed
      return;
    }

    if (activeEsiLayer === lastEsiLayerRef.current) return; // unrelated re-render — data/mode hasn't changed

    if (activeEsiLayer.kind !== 'connectome') {
      // If other image volumes (e.g. the MRI) are known in orderedLayers but still loading
      // (useLayerLoader), don't add the ESI volume yet — it could win the race for
      // nv.volumes[0], NiiVue's base volume, and leave the scene resampled onto ESI's coarse
      // grid ("squares") until manually reordered. Checked before lastEsiLayerRef updates
      // below, so this effect retries once the MRI finishes loading.
      const expectedVolumesAheadOfEsi = orderedLayers.filter(
        (l) => isImageVolumeLayer(l) && l.url !== ESI_LAYER_URL
      ).length;
      if (nv.volumes.length < expectedVolumesAheadOfEsi) return;
    }

    lastEsiLayerRef.current = activeEsiLayer; // remember what this rebuild is based on

    // Apply whatever opacity/visibility is already set for this layer (preserved across
    // data refreshes by the sync effect above); fall back to the default on first appearance.
    const existingIndex = orderedLayers.findIndex((l) => l.url === ESI_LAYER_URL);
    const settings =
      layerSettings[existingIndex] ?? // existing settings, preserved across this rebuild
      getInitialLayerSettings([activeEsiLayer], orderedLayers.length)[0]; // fresh defaults on first appearance

    if (activeEsiLayer.kind === 'connectome') {
      // Connectome mode — drop any leftover volume from a previous volume-mode rebuild first.
      if (esiVolumeRef.current) {
        const staleIndex = nv.volumes.indexOf(esiVolumeRef.current);
        if (staleIndex !== -1) nv.removeVolumeByIndex(staleIndex);
        esiVolumeRef.current = null;
      }
      if (esiMeshRef.current) nv.removeMesh(esiMeshRef.current); // drop the stale mesh before building its replacement

      // Source power is always non-negative (squared magnitude) — use the positive colormap
      // for both slots; the negative colormap is never reached.
      // cal_min/cal_max on `settings` are the user's chosen fractions of this layer's own
      // boundMin/boundMax (see getCalBounds) — resolving them fresh here means a user-set
      // threshold survives into the next EEG click's new bound instead of resetting.
      const { boundMin: esiBoundMin, boundMax: esiBoundMax } = getCalBounds(activeEsiLayer);
      const esiCalMin = fractionToCalValue(settings.cal_min, esiBoundMin, esiBoundMax);
      const esiCalMax = fractionToCalValue(settings.cal_max, esiBoundMin, esiBoundMax);
      // NiiVue already skips below-threshold nodes when coloring, but its label builder warns
      // once per node when doing so — filter them out here to get the same result silently.
      const visibleNodes = activeEsiLayer.nodes.filter((node) => node.colorValue >= esiCalMin);
      const mesh = nv.loadConnectomeAsMesh({
        name: activeEsiLayer.name,
        nodeColormap: EEG_NODE_POS_KEY,
        nodeColormapNegative: EEG_NODE_POS_KEY, // unused — power is always ≥ 0
        nodeMinColor: esiCalMin,
        nodeMaxColor: esiCalMax,
        nodeScale: 4,
        edgeColormap: EEG_NODE_POS_KEY,
        edgeColormapNegative: EEG_NODE_POS_KEY,
        edgeMin: esiCalMin,
        edgeMax: esiCalMax,
        edgeScale: 0.5,
        showLegend: false,
        colorbarVisible: false, // suppresses the colorbar entry NiiVue would otherwise add
        nodes: visibleNodes,
        edges: activeEsiLayer.edges, // always [] for ESI — source points have no connecting structure
      });
      mesh.opacity = settings.visible ? settings.opacity : 0;

      nv.addMesh(mesh); // actually add it to the 3D scene
      esiMeshRef.current = mesh; // track it so the next change/removal can find it
      nv.updateGLVolume(); // redraw with the new mesh visible
    } else {
      // Volume mode — drop any leftover mesh from a previous connectome-mode rebuild first.
      if (esiMeshRef.current) {
        nv.removeMesh(esiMeshRef.current);
        esiMeshRef.current = null;
      }
      const staleVolume = esiVolumeRef.current; // remove after the new one lands, not before

      // activeEsiLayer.bytes is the raw NIfTI-1 Uint8Array (from NVImage.createNiftiArray) —
      // NVImage.loadFromUrl accepts raw bytes directly as `url`, same as a real file's blob URL.
      nv.addVolumesFromUrl([{ url: activeEsiLayer.bytes, name: activeEsiLayer.name }])
        .then(() => {
          const nvIndex = nv.volumes.length - 1; // just-appended volume is always last
          const nvVolume = nv.volumes[nvIndex];
          esiVolumeRef.current = nvVolume; // track it so the next change/removal can find it

          // nv.setColormap() calls updateGLVolume() internally, which re-triggers NiiVue's
          // own cal_min/cal_max auto-scan => cal_min/cal_max/colormapType MUST be set after
          // this block, not before, or they get silently fall back to the auto-scanned values.
          nv.setOpacity(nvIndex, settings.visible ? settings.opacity : 0);
          nv.setColormap(nvVolume.id, settings.colormap);
          if (settings.invert) nvVolume.colormapInvert = true;
          nvVolume.colorbarVisible = settings.showColorbar;

          // Fixed cal_min/cal_max (rather than NiiVue's auto-scan) keeps the color scale
          // consistent with connectome mode, and avoids a "% of voxels are zero" warning
          // from the auto-scan seeing this grid's mostly-empty background. Resolved from the
          // user's chosen fraction of this layer's own boundMin/boundMax, same as connectome
          // mode above — so it survives into the next click's new bound instead of resetting.
          const { boundMin: esiVolBoundMin, boundMax: esiVolBoundMax } =
            getCalBounds(activeEsiLayer);
          nvVolume.cal_min = fractionToCalValue(settings.cal_min, esiVolBoundMin, esiVolBoundMax);
          nvVolume.cal_max = fractionToCalValue(settings.cal_max, esiVolBoundMin, esiVolBoundMax);
          // 2 = ZERO_TO_MAX_TRANSLUCENT_BELOW_MIN (COLORMAP_TYPE isn't a runtime export of
          // @niivue/niivue, only a TS-only enum). Voxels below cal_min get a hard alpha=0
          // cutoff in NiiVue's shader — unlike type 1's smooth (f/cal_min)² ramp, there's no
          // continuous scaling near-zero values can land on unpredictably.
          nvVolume.colormapType = 2;

          if (staleVolume) {
            const staleIndex = nv.volumes.indexOf(staleVolume);
            if (staleIndex !== -1) nv.removeVolumeByIndex(staleIndex);
          }
          nv.updateGLVolume(); // redraw with the new volume visible
        })
        .catch((err) => console.error('ESI volume failed to load', err));
    }
  }, [esiLayer, isEsiVolumeMode, orderedLayers, layerSettings, nvRef]);

  return { esiMeshRef, esiVolumeRef, clearEsiMesh, clearEsiVolume };
}
