import { useRef, useEffect } from 'react';
import { SHOW_RENDER, MULTIPLANAR_TYPE, SLICE_TYPE } from '@niivue/niivue';
import {
  EEG_NODE_POS_KEY,
  EEG_NODE_POS,
  EEG_NODE_NEG_KEY,
  EEG_NODE_NEG,
} from '@/utils/eegColormaps';

/**
 * Attaches the shared, long-lived NiiVue instance to the canvas once on mount, and clears its
 * volumes/meshes on unmount so they don't silently reappear (as ghost layers with no
 * ImagingControls card) the next time this component mounts.
 *
 * @param {Object} params
 * @param {React.RefObject} params.nvRef - the shared, long-lived NiiVue instance ref; both
 *   effects no-op if it isn't set yet.
 * @param {boolean} params.hasImageVolumes - whether there are slices to show right now; decides
 *   whether the mount-time slice-type sync uses `activeSliceType` or falls back to 3D.
 * @param {number} params.activeSliceType - the slice type to sync to on mount when
 *   `hasImageVolumes` is true. Later changes are the caller's responsibility (e.g. via its own
 *   `handleSliceTypeChange`) — this hook only syncs once, on mount.
 * @param {Function} [params.onNiiNvReady] - called once `attachToCanvas` has run, so the caller
 *   can react to the canvas becoming usable.
 * @param {React.RefObject} params.fileMeshesRef - url→NVMesh map for file-loaded surface
 *   meshes; cleared alongside `nv.meshes` on unmount so a later remount starts from empty.
 * @param {Function} [params.onHas3DExtentChange] - called with `false` on unmount, once `nv`'s
 *   volumes/meshes have actually been cleared — the caller's own has-3D-extent reporting (driven
 *   by `orderedLayers`) can't fire on unmount since its effect body simply stops running, so it
 *   would otherwise stay stale at whatever it last reported.
 * @returns {Object}
 *   - `canvasRef` (RefObject) — attach to the `<canvas>` element NiiVue should render into.
 */
export function useNiiVueLifecycle({
  nvRef,
  hasImageVolumes,
  activeSliceType,
  onNiiNvReady,
  fileMeshesRef,
  onHas3DExtentChange,
}) {
  const canvasRef = useRef();
  const canvasReadyRef = useRef(false); // guards attachToCanvas against StrictMode double-invoke

  // Attach NiiVue to the canvas once on mount. canvasReadyRef guards against StrictMode's
  // double-invoke — a second attachToCanvas would reinitialise WebGL, wiping all volumes.
  useEffect(() => {
    if (!nvRef.current || canvasReadyRef.current) return;
    canvasReadyRef.current = true;
    const nv = nvRef.current;
    nv.opts.multiplanarShowRender = SHOW_RENDER.ALWAYS;
    nv.setMultiplanarLayout(MULTIPLANAR_TYPE.GRID);
    nv.opts.multiplanarEqualSize = false;
    nv.setCornerOrientationText(false);
    // Registered here (rather than where the connectome mesh is built) so they exist
    // before the connectome-build effects can ever run on this instance.
    nv.addColormap(EEG_NODE_POS_KEY, EEG_NODE_POS);
    nv.addColormap(EEG_NODE_NEG_KEY, EEG_NODE_NEG);
    nv.attachToCanvas(canvasRef.current);
    // Sync slice type on mount — nv is long-lived and may have been left in RENDER from
    // a previous connectome-only phase. Later changes go through handleSliceTypeChange.
    nv.setSliceType(hasImageVolumes ? activeSliceType : SLICE_TYPE.RENDER);
    onNiiNvReady?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // nv is long-lived and reused across remounts — clear volumes/meshes on unmount so they
  // don't silently reappear on the next mount.
  useEffect(() => {
    return () => {
      const nv = nvRef.current;
      if (!nv) return;
      while (nv.volumes.length > 0) nv.removeVolumeByIndex(0);
      (nv.meshes ?? []).slice().forEach((mesh) => nv.removeMesh(mesh));
      fileMeshesRef.current.clear(); // drop tracked file meshes so they aren't re-applied on remount
      onHas3DExtentChange?.(false); // nv is now genuinely empty — report that before it goes stale
    };
  }, [nvRef, fileMeshesRef, onHas3DExtentChange]);

  return { canvasRef };
}
