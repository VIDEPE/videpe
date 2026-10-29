import { useRef, useEffect, useCallback } from 'react';
import {
  getCalBounds,
  fractionToCalValue,
  isImageVolumeLayer,
  getAziElev,
  ESI_LAYER_URL,
} from '@/utils/NiiViewer.utils';
import { selectEntry, SYNC_GENERATED_LAYER } from '@/state/layerState';
import { EEG_NODE_POS_KEY } from '@/utils/eegColormaps';

/**
 * Merges the ESI (Electrical Source Imaging) source-power layer into NiiViewer's layer state
 * by its sentinel URL, and builds/rebuilds/removes the NiiVue object
 * representing it whenever its data or the Connectome/Volume toggle changes. Same
 * merge-then-rebuild pattern as useElectrodeConnectome, but branches between two NiiVue
 * object kinds — a connectome mesh or an NVImage volume — depending on `isEsiVolumeMode`.
 *
 * @param {Object} params
 * @param {Object|null} params.esiLayer - the layer carrying both representations of the
 *   current ESI click (`sourcePowerConnectomes` and `sourcePowerVolume`), or null when there's
 *   nothing to show (e.g. no inverse solution loaded, a needed channel typed SEEG, empty
 *   flatSourceFilters).
 * @param {boolean} params.isEsiVolumeMode - true to render `esiLayer.sourcePowerVolume` (an
 *   NVImage), false to render `esiLayer.sourcePowerConnectomes` (a connectome mesh).
 * @param {React.RefObject} params.nvRef - the shared, long-lived NiiVue instance ref; both
 *   effects no-op until it's set.
 * @param {Object} params.layerState - NiiViewer's layer state (see layerState.js), read for
 *   this layer's own settings (by sentinel URL, incl. the user's cal_min/cal_max fractions) and
 *   for how many other image volumes have to land in nv.volumes first.
 * @param {Function} params.dispatchLayers - layerState's dispatch, sent SYNC_GENERATED_LAYER
 *   each time the active ESI representation changes.
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
 *   - `dismissEsiLayer` (Function) — call from handleDeleteLayer alongside clearEsiMesh/
 *     clearEsiVolume so the merge effect stops resurrecting the just-deleted card until esiLayer
 *     actually changes upstream.
 */
export function useEsiLayer({
  esiLayer,
  isEsiVolumeMode,
  nvRef,
  layerState,
  dispatchLayers,
  nvTopoRef,
}) {
  const esiMeshRef = useRef(null); // current ESI connectome mesh in the scene (connectome mode)
  const esiVolumeRef = useRef(null); // current ESI NVImage volume in the scene (volume mode) — mutually exclusive with esiMeshRef
  const lastEsiLayerRef = useRef(null); // guards against rebuilding on unrelated re-renders — tracks whichever of the two is active
  // The specific activeEsiLayer object dismissed via handleDeleteLayer, if any. Not a boolean:
  // esiLayer is a prop that PatientView keeps recomputing (new EEG click), so a plain "dismissed
  // = true" flag could never be un-set. Storing the reference lets the merge effect below tell
  // "still that same stale layer" from "genuinely new data" by identity — the dismissal
  // auto-expires the moment a new object arrives, no explicit undo needed.
  const dismissedEsiLayerRef = useRef(null);

  // Sanctioned way for the caller to reset these refs after it removes the mesh/volume from nv
  // itself (e.g. handleDeleteLayer) — external code can read `.current` but isn't allowed to
  // write it directly, since the refs are owned by this hook.
  const clearEsiMesh = useCallback(() => {
    esiMeshRef.current = null;
  }, []);
  const clearEsiVolume = useCallback(() => {
    esiVolumeRef.current = null;
  }, []);
  // Snapshots whichever of mesh/volume is currently on screen (lastEsiLayerRef, kept current by
  // the build effect below) as dismissed, so the merge effect recognizes and ignores it.
  const dismissEsiLayer = useCallback(() => {
    dismissedEsiLayerRef.current = lastEsiLayerRef.current;
  }, []);

  // Merges the separately-tracked esiLayer prop into the layer state — same pattern as the
  // electrodeLayer merge effect, keyed on ESI_LAYER_URL.
  useEffect(() => {
    const activeEsiLayer = esiLayer
      ? isEsiVolumeMode
        ? esiLayer.sourcePowerVolume
        : esiLayer.sourcePowerConnectomes
      : esiLayer;
    // Treat a just-dismissed layer as absent until esiLayer actually changes upstream.
    const effectiveEsiLayer =
      activeEsiLayer && activeEsiLayer === dismissedEsiLayerRef.current ? null : activeEsiLayer;

    // Add/replace/remove the ESI card to match effectiveEsiLayer. A new card gets fresh defaults
    // from the reducer (in the last chosen mode); an existing card keeps its settings. Re-runs on
    // every layerState change — a no-op (same state) when nothing differs.
    dispatchLayers({ type: SYNC_GENERATED_LAYER, url: ESI_LAYER_URL, layer: effectiveEsiLayer });
  }, [esiLayer, isEsiVolumeMode, layerState, dispatchLayers]);

  // Builds/rebuilds/removes the ESI source-power mesh (connectome mode) or NVImage volume
  // (volume mode) whenever esiLayer's data or the Connectome/Volume toggle changes. Same
  // rebuild-on-change pattern as the electrodeLayer build effect, but branches between the
  // two NiiVue object kinds depending on which one activeEsiLayer resolves to.
  useEffect(() => {
    const nv = nvRef.current; // guard — nothing to do before NiiVue has attached to a canvas
    if (!nv) return;
    const nvTopo = nvTopoRef?.current;
    const activeEsiLayer = esiLayer
      ? isEsiVolumeMode
        ? esiLayer.sourcePowerVolume
        : esiLayer.sourcePowerConnectomes
      : esiLayer;

    if (!activeEsiLayer) {
      // Nothing to show (e.g. no inverse solution loaded, a needed channel typed SEEG, or
      // empty flatSourceFilters) — tear down whichever of mesh/volume is currently in the
      // scene, if either actually is.
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

    // If the data hasn't changed, and (only for connectome mode) the thing we built is still
    // really there — do nothing. Otherwise, rebuild. "Still there" means: does NiiVue's live
    // list (nv.meshes) still contain the specific mesh object we think we built? On first
    // mount, React briefly mounts, tears down, and mounts again (StrictMode) — the teardown
    // step secretly removes the mesh, even though the data still looks unchanged. Volume mode
    // skips this check: its load is async, so it finishes on its own after the remount either
    // way — checking here would instead trigger a second, duplicate load.
    if (activeEsiLayer === lastEsiLayerRef.current) {
      const stillInScene =
        activeEsiLayer.kind !== 'connectome' || nv.meshes.includes(esiMeshRef.current);
      if (stillInScene) return;
    }

    if (activeEsiLayer.kind !== 'connectome') {
      // If other image volumes (e.g. the MRI) are known in the layer state but still loading
      // (useLayerLoader), don't add the ESI volume yet — it could win the race for
      // nv.volumes[0], NiiVue's base volume, and leave the scene resampled onto ESI's coarse
      // grid ("squares") until manually reordered. Checked before lastEsiLayerRef updates
      // below, so this effect retries once the MRI finishes loading.
      const expectedVolumesAheadOfEsi = layerState.entries.filter(
        (entry) => isImageVolumeLayer(entry.layer) && entry.url !== ESI_LAYER_URL
      ).length;
      if (nv.volumes.length < expectedVolumesAheadOfEsi) return;
    }

    // Apply whatever opacity/visibility is set on this layer's card (preserved across data
    // refreshes by the sync effect above), looked up by url. On first appearance the card isn't
    // in layerState yet (the sync effect has only just dispatched it) — wait for it: this effect
    // re-runs once it's there, so the layer is always built from the card's own settings, never
    // from separate defaults. Checked before lastEsiLayerRef updates below, so it retries.
    const settings = selectEntry(layerState, ESI_LAYER_URL)?.settings;
    if (!settings) return;

    lastEsiLayerRef.current = activeEsiLayer; // remember what this rebuild is based on

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
        nodeScale: settings.nodeScale,
        edgeColormap: EEG_NODE_POS_KEY,
        edgeColormapNegative: EEG_NODE_POS_KEY,
        edgeMin: esiCalMin,
        edgeMax: esiCalMax,
        edgeScale: settings.edgeScale,
        showLegend: false,
        colorbarVisible: false, // suppresses the colorbar entry NiiVue would otherwise add
        nodes: visibleNodes,
        edges: activeEsiLayer.edges, // always [] for ESI — source points have no connecting structure
      });
      mesh.opacity = settings.visible ? settings.opacity : 0;
      // nv.opts.meshXRay is a scene-global NiiVue option, not a per-mesh property, and NiiVue's
      // own default (0) doesn't match this app's default (DEFAULT_MESH_XRAY, see getInitialLayerSettings) —
      // apply it here on build, or the card's slider would show 75% while the mesh actually
      // renders opaque until the user drags the slider once.
      nv.opts.meshXRay = settings.meshXRay;

      nv.addMesh(mesh); // actually add it to the 3D scene
      esiMeshRef.current = mesh; // track it so the next change/removal can find it
      nv.scene.crosshairPos = nv.mm2frac(esiLayer.maxSourcePowerLocation); // move the crosshair to the location where the ESI source power is max
      // change the 3D view to align the view to the max ESI
      const [azi, elev] = getAziElev(esiLayer.maxSourcePowerLocation);
      nv.setRenderAzimuthElevation(azi, elev);
      nv.updateGLVolume(); // redraw with the new mesh visible
      if (nvTopo) {
        nvTopo.setRenderAzimuthElevation(azi, elev);
        nvTopo.updateGLVolume();
      }
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

          nv.scene.crosshairPos = nv.mm2frac(esiLayer.maxSourcePowerLocation); // move the crosshair to the location where the ESI source power is max
          // change the 3D view to align the view to the max ESI
          const [azi, elev] = getAziElev(esiLayer.maxSourcePowerLocation);
          nv.setRenderAzimuthElevation(azi, elev);
          nv.updateGLVolume(); // redraw with the new volume visible
          if (nvTopo) {
            nvTopo.setRenderAzimuthElevation(azi, elev);
            nvTopo.updateGLVolume();
          }
        })
        .catch((err) => console.error('ESI volume failed to load', err));
    }
  }, [esiLayer, isEsiVolumeMode, layerState, nvRef]);

  return { esiMeshRef, esiVolumeRef, clearEsiMesh, clearEsiVolume, dismissEsiLayer };
}
