import { useRef, useEffect } from 'react';
import toast from 'react-hot-toast';
import {
  isImageVolumeLayer,
  syncVolumesAndApplySettings,
  syncMeshesAndApplySettings,
  revokeLayerUrls,
} from '@/utils/NiiViewer.utils';
import { layerReducer, selectEntry, LOAD_FILE_LAYERS, REMOVE_LAYERS } from '@/state/layerState';

/**
 * Loads image volumes/meshes into nv whenever the `layers` prop changes, and clears them back
 * out (keeping only the electrode/ESI cards) when `layers` goes empty.
 *
 * loadingLayersRef has two guards: (1) same reference at the top → StrictMode double-invoke,
 * bail before touching nv; (2) stale reference in the async callback → a newer load superseded
 * this one, don't update state. Connectome layers are intentionally excluded from deps — their
 * own merge effects (see useElectrodeConnectome/useEsiLayer) handle them.
 *
 * @param {Object} params
 * @param {Array} params.layers - image volume/mesh layers to load, e.g. from the `layers` prop
 *   (files dropped into a parent's own drop zone). An empty array clears volumes/meshes instead
 *   of loading.
 * @param {React.RefObject} params.nvRef - the shared, long-lived NiiVue instance ref.
 * @param {React.RefObject} params.fileMeshesRef - url→NVMesh map for file-loaded surface
 *   meshes; read/written so already-loaded meshes aren't reloaded, and cleared when `layers`
 *   goes empty.
 * @param {Object} params.layerState - NiiViewer's layer state (see layerState.js), read to
 *   compute the settings the new file layers get, so nv is loaded with exactly those.
 * @param {Function} params.dispatchLayers - layerState's dispatch: LOAD_FILE_LAYERS on load or
 *   clear, REMOVE_LAYERS for files that failed to load.
 * @param {Function} params.setIsLoading - React setState toggled true while a load is in
 *   flight, false once it settles (success or failure).
 * @param {Function} [params.onViewReady] - called once a non-empty load finishes without error,
 *   so the caller can react to the scene actually having content.
 * @param {Function} [params.onLoadError] - called once a non-empty load finishes with an error,
 *   so PatientView knows whether to reset the neuroimaging FileDropZone.
 * @returns {void} — side-effecting only, nothing to read back.
 */
export function useLayerLoader({
  layers,
  nvRef,
  fileMeshesRef,
  layerState,
  dispatchLayers,
  setIsLoading,
  onViewReady,
  onLoadError,
}) {
  const loadingLayersRef = useRef(null); // guards nv.loadVolumes against StrictMode double-invoke

  useEffect(() => {
    if (!layers.length) {
      loadingLayersRef.current = null; // reset so the next non-empty load can proceed
      // No image volumes or meshes from the layers prop — clear any stale ones from nv and
      // remove their ImagingControls cards. The electrode/ESI cards (managed by their own hooks)
      // are kept, whole — including an ESI layer in volume mode.
      const nv = nvRef.current;
      let needsRedraw = false;
      if (nv?.volumes.length) {
        // Defensive backstop — normally already revoked right after load (see syncVolumesAndApplySettings).
        revokeLayerUrls(nv.volumes);
        while (nv.volumes.length > 0) nv.removeVolumeByIndex(0);
        needsRedraw = true;
      }
      if (nv && fileMeshesRef.current.size > 0) {
        // Same backstop for meshes — normally already revoked by syncMeshesAndApplySettings.
        revokeLayerUrls(fileMeshesRef.current.values());
        fileMeshesRef.current.forEach((mesh) => nv.removeMesh(mesh));
        fileMeshesRef.current.clear();
        needsRedraw = true;
      }
      if (needsRedraw) nv.updateGLVolume();
      dispatchLayers({ type: LOAD_FILE_LAYERS, layers: [] });
      setIsLoading(false);
      return;
    }
    if (loadingLayersRef.current === layers) return; // StrictMode: already loading these layers
    loadingLayersRef.current = layers;

    // Replace the file cards (the reducer seeds their default settings), and load nv with the
    // settings from that same resulting state.
    const loadAction = { type: LOAD_FILE_LAYERS, layers };
    const loadedState = layerReducer(layerState, loadAction);
    dispatchLayers(loadAction);
    setIsLoading(true);

    // Image volumes and surface meshes take separate NiiVue load paths — split by kind so
    // each goes to the right loader, each layer with its own settings.
    const imageLayers = layers.filter(isImageVolumeLayer);
    const imageLayerSettings = imageLayers.map((l) => selectEntry(loadedState, l.url).settings);
    const meshLayers = layers.filter((l) => l.kind === 'mesh');
    const meshLayerSettings = meshLayers.map((l) => selectEntry(loadedState, l.url).settings);

    const loadAndSync = async () => {
      // allSettled (not all) so a failing category doesn't abort the other. Each NiiVue
      // loader is all-or-nothing, so on failure nv needs no cleanup — we just drop the
      // failed category's cards (by url) so nothing lingers for a file that never loaded.
      const [volumeResult, meshResult] = await Promise.allSettled([
        syncVolumesAndApplySettings(nvRef.current, imageLayers, imageLayerSettings),
        syncMeshesAndApplySettings(
          nvRef.current,
          meshLayers,
          meshLayerSettings,
          fileMeshesRef.current
        ),
      ]);
      if (loadingLayersRef.current !== layers) return; // superseded by a newer load

      const failedUrls = new Set();
      if (volumeResult.status === 'rejected') imageLayers.forEach((l) => failedUrls.add(l.url));
      if (meshResult.status === 'rejected') meshLayers.forEach((l) => failedUrls.add(l.url));

      if (failedUrls.size > 0) {
        // A rejected load never reaches syncVolumesAndApplySettings/syncMeshesAndApplySettings's
        // own revoke, so these blobs are still live — free them here instead.
        if (volumeResult.status === 'rejected') revokeLayerUrls(imageLayers);
        if (meshResult.status === 'rejected') revokeLayerUrls(meshLayers);
        dispatchLayers({ type: REMOVE_LAYERS, urls: [...failedUrls] });
        // One toast per failed layer, named by file rather than by its abstract blob: url
        // Each NiiVue loader is all-or-nothing, so every layer in a failed category is reported
        // (volume failure and mesh failure can have different reasons => don't share error message).
        if (volumeResult.status === 'rejected') {
          imageLayers.forEach((layer) =>
            toast.error(`Failed to load image ${layer.name}:\n${volumeResult.reason.message}`)
          );
        }
        if (meshResult.status === 'rejected') {
          meshLayers.forEach((layer) =>
            toast.error(`Failed to load image ${layer.name}:\n${meshResult.reason.message}`)
          );
        }
        onLoadError?.(failedUrls);
      } else {
        onViewReady?.();
      }
      setIsLoading(false);
    };

    loadAndSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers]);
}
