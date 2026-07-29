import { useRef, useState, useCallback, useEffect } from 'react';
import { cn } from '../utils/utils';
import { SLICE_TYPE } from '@niivue/niivue';
import { move } from '@dnd-kit/helpers';
import toast from 'react-hot-toast';

const NII_LOADING_TOAST_ID = 'nii-viewer-loading'; // fixed id so loading/success toasts update in place rather than stacking
const MIN_CANVAS_HEIGHT = 350; // px — matches the canvas row's original fixed floor
// Static — doesn't depend on any component state/props — so it lives at module scope rather
// than being rebuilt on every render.
const SLICE_TYPE_OPTIONS = [
  { sliceType: SLICE_TYPE.AXIAL, label: 'Axial', buttonLabel: 'Ax' },
  { sliceType: SLICE_TYPE.CORONAL, label: 'Coronal', buttonLabel: 'Co' },
  { sliceType: SLICE_TYPE.SAGITTAL, label: 'Sagittal', buttonLabel: 'Sa' },
  { sliceType: SLICE_TYPE.MULTIPLANAR, label: 'Multiplanar', buttonLabel: 'MP' },
  { sliceType: SLICE_TYPE.RENDER, label: '3D', buttonLabel: '3D' },
];
import {
  getInitialLayerSettings,
  getCurrentMeshXRay,
  filesToLayers,
  isImageVolumeLayer,
  getCalBounds,
  fractionToCalValue,
  syncVolumesAndApplySettings,
  syncMeshesAndApplySettings,
  ESI_LAYER_URL,
  ELECTRODE_LAYER_URL,
} from '../utils/NiiViewer.utils';
import { ImagingControls } from './ImagingControls';
import { FileDropZone } from '../components/FileDropZone';
import { useCanvasAutoLayout } from '@/hooks/useCanvasAutoLayout';
import { useRowResize } from '@/hooks/useRowResize';
import { useSharedNiiVueInstance } from '@/hooks/useSharedNiiVueInstance';
import { useLoadingToast } from '@/hooks/useLoadingToast';
import { useLayerLoader } from '@/hooks/useLayerLoader';
import { useElectrodeConnectome } from '@/hooks/useElectrodeConnectome';
import { useEsiLayer } from '@/hooks/useEsiLayer';

// Re-exported so existing imports (e.g. NiiViewer.test.jsx) keep working — the implementations
// now live in NiiViewer.utils.js since useLayerLoader needs them too.
export { syncVolumesAndApplySettings, syncMeshesAndApplySettings };

// ─── handleSettingChange dispatch helpers ──────────────────────────────────────
// Image volumes are the default case — mapped from their position in orderedLayers to their
// index in nv.volumes by counting only the preceding image-volume entries (connectome and
// mesh layers occupy a slot in orderedLayers but not in nv.volumes).
function applyVolumeSettingChange({
  layer,
  layerIndex,
  orderedLayers,
  key,
  value,
  settings,
  nextLayerSettings,
  nv,
  opacityRafRef,
  thresholdRafRef,
}) {
  const nvIndex = orderedLayers.slice(0, layerIndex).filter(isImageVolumeLayer).length;
  const nvVolume = nv.volumes[nvIndex];
  if (!nvVolume) return;

  if (key === 'visible') {
    nv.setOpacity(nvIndex, value ? settings.opacity : 0);
  } else if (key === 'opacity') {
    // Throttle to one GL redraw per frame — cancels any pending rAF so only the latest drag value redraws
    if (settings.visible) {
      if (opacityRafRef.current) cancelAnimationFrame(opacityRafRef.current);
      opacityRafRef.current = requestAnimationFrame(() => nv.setOpacity(nvIndex, value));
    }
  } else if (key === 'colormap') {
    nv.setColormap(nvVolume.id, value);
    // setColormap's internal updateGLVolume() re-triggers NiiVue's own cal_min/cal_max
    // auto-scan, which would otherwise silently overwrite the user's chosen threshold right
    // after it's set (same requirement as syncVolumesAndApplySettings's initial-load path).
    const { boundMin, boundMax } = getCalBounds(layer, nvVolume);
    nvVolume.cal_min = fractionToCalValue(settings.cal_min, boundMin, boundMax);
    nvVolume.cal_max = fractionToCalValue(settings.cal_max, boundMin, boundMax);
    nv.updateGLVolume();
  } else if (key === 'invert') {
    nvVolume.colormapInvert = value;
    nv.updateGLVolume();
  } else if (key === 'showColorbar') {
    nvVolume.colorbarVisible = value;
    nv.opts.isColorbar = nextLayerSettings.some((layerSetting) => layerSetting.showColorbar);
    nv.updateGLVolume();
  } else if (key === 'cal_min' || key === 'cal_max' || key === 'cal_range') {
    // Throttle to one GL redraw per frame — cancels any pending rAF so only the latest drag value redraws
    if (settings.visible) {
      if (thresholdRafRef.current) cancelAnimationFrame(thresholdRafRef.current);
      thresholdRafRef.current = requestAnimationFrame(() => {
        // value alone (a 0-1 fraction) isn't a real cal_min/cal_max — it has to be resolved
        // against this volume's own data range first (see getCalBounds above).
        const { boundMin, boundMax } = getCalBounds(layer, nvVolume);
        nvVolume.cal_min = fractionToCalValue(settings.cal_min, boundMin, boundMax);
        nvVolume.cal_max = fractionToCalValue(settings.cal_max, boundMin, boundMax);
        nv.updateGLVolume();
      });
    }
  }
}

// Connectome layers (electrodes / ESI connectome mode) aren't in nv.volumes at
// all — they're a mesh, built/tracked by useElectrodeConnectome/useEsiLayer — so settings
// are applied to the mesh object directly instead of through nv.setOpacity/setColormap.
function applyConnectomeSettingChange({
  layer,
  key,
  value,
  settings,
  nv,
  esiMeshRef,
  electrodeMeshRef,
  thresholdRafRef,
  meshXRayRafRef,
}) {
  const mesh = layer.url === ESI_LAYER_URL ? esiMeshRef.current : electrodeMeshRef.current;
  if (!mesh) return;

  // ImagingControls only renders an Opacity slider for image volumes (`{isImageVolume && (...)}`)
  // — a connectome never gets one — so there's no 'opacity' branch here; key === 'opacity' can
  // never fire for this layer kind. 'visible' sets mesh.opacity directly instead.
  if (key === 'visible') {
    mesh.opacity = value ? settings.opacity : 0;
    nv.updateGLVolume();
  } else if (key === 'cal_min' || key === 'cal_max' || key === 'cal_range') {
    // Throttle to one GL redraw per frame — cancels any pending rAF so only the latest drag value redraws
    if (settings.visible) {
      if (thresholdRafRef.current) cancelAnimationFrame(thresholdRafRef.current);
      thresholdRafRef.current = requestAnimationFrame(() => {
        // Unlike cal_min/cal_max on an NVImage, a connectome mesh's color range is only read when
        // its color buffers are rebuilt — mutating nodeMinColor/edgeMin etc. alone has no visual
        // effect until mesh.updateMesh(gl) recomputes them.
        const { boundMin, boundMax } = getCalBounds(layer);
        const calMin = fractionToCalValue(settings.cal_min, boundMin, boundMax);
        const calMax = fractionToCalValue(settings.cal_max, boundMin, boundMax);
        mesh.nodeMinColor = calMin;
        mesh.nodeMaxColor = calMax;
        mesh.edgeMin = calMin;
        mesh.edgeMax = calMax;
        mesh.updateMesh(nv.gl);
        nv.updateGLVolume();
      });
    }
  } else if (key === 'meshXRay') {
    // Throttle to one GL redraw per frame — cancels any pending rAF so only the latest drag value redraws
    if (settings.visible) {
      if (meshXRayRafRef.current) cancelAnimationFrame(meshXRayRafRef.current);
      meshXRayRafRef.current = requestAnimationFrame(() => {
        nv.opts.meshXRay = value;
        nv.updateGLVolume();
      });
    }
  }
  // colormap/invert/showColorbar: ImagingControls doesn't render those controls for this
  // kind, so there's nothing to apply here.
}

// File-loaded surface meshes live in nv.meshes (tracked by fileMeshesRef), not nv.volumes —
// like connectomes, they only expose opacity/visibility; colormap/threshold/invert/showColorbar
// aren't rendered for this kind, so there's nothing to apply for those.
function applyFileMeshSettingChange({
  layer,
  key,
  value,
  settings,
  nv,
  fileMeshesRef,
  meshXRayRafRef,
}) {
  const mesh = fileMeshesRef.current.get(layer.url);
  if (!mesh) return;

  // ImagingControls only renders an Opacity slider for image volumes (`{isImageVolume && (...)}`)
  // — a file-loaded mesh never gets one — so there's no 'opacity' branch here; key === 'opacity'
  // can never fire for this layer kind. 'visible' sets mesh.opacity directly instead.
  if (key === 'visible') {
    mesh.opacity = value ? settings.opacity : 0;
    nv.updateGLVolume();
  } else if (key === 'meshXRay') {
    // Throttle to one GL redraw per frame — cancels any pending rAF so only the latest drag value redraws
    if (settings.visible) {
      if (meshXRayRafRef.current) cancelAnimationFrame(meshXRayRafRef.current);
      meshXRayRafRef.current = requestAnimationFrame(() => {
        nv.opts.meshXRay = value;
        nv.updateGLVolume();
      });
    }
  }
}

export const NiiViewer = ({
  nvRef,
  layers = [], // image volumes/meshes loaded from files — e.g. .nii/.mgz/.gii/.ply/.obj drops
  electrodeLayer = null, // kept separate from `layers` so a voltage-driven refresh never resets other layers' settings
  esiLayer = null, // same pattern — ESI source power connectome/volume layer
  onViewReady,
  onNiiNvReady,
  onHasContentChange, // reports orderedLayers.length > 0 — lets the parent see layers
  // dropped into this component's own dropzone, which never touch the layers/
  // electrodeLayer/esiLayer props, so it doesn't wrongly unmount this viewer when those go empty/null together.
  onHas3DExtentChange, // reports whether the scene has a volume/mesh (non-connectome) — gates the cross-panel rotation sync; see the effect below
  isFullscreen = false,
  onElectrodeLayerDismissed,
  onLoadError,
}) => {
  // ─── State ─────────────────────────────────────────────────────────────────
  const [layerSettings, setLayerSettings] = useState(() => getInitialLayerSettings(layers));
  const [orderedLayers, setOrderedLayers] = useState(layers); // mirrors `layers` + any merged connectome layers; user-reorderable
  const [isLoading, setIsLoading] = useState(true);
  const [activeSliceType, setActiveSliceType] = useState(SLICE_TYPE.MULTIPLANAR);
  // Connectome/Volume toggle for the ESI layer, split into two values, both read by the ESI
  // effects below: isEsiVolumeMode normally just mirrors the layerSettings entry, but that entry
  // briefly disappears whenever handleDeleteLayer deletes the ESI card — and falling back to a
  // hardcoded `true` in that gap would look like the user just switched from Connectome to
  // Volume mode. useEsiLayer reacts to that (fake) mode change by rebuilding the layer it was
  // just asked to delete. lastEsiVolumeMode is what isEsiVolumeMode falls back to instead: the
  // last mode the user actually chose (only handleSettingChange writes it, on the user's own
  // 'isEsiVolume' toggle), which keeps the value stable across the deletion so useEsiLayer sees
  // no change and leaves the deleted layer alone.
  const [lastEsiVolumeMode, setLastEsiVolumeMode] = useState(true);
  const isEsiVolumeMode =
    layerSettings.find((s) => s.url === ESI_LAYER_URL)?.isEsiVolume ?? lastEsiVolumeMode;

  // ─── Refs ───────────────────────────────────────────────────────────────────
  const opacityRafRef = useRef(null); // rAF id — cancelled on each drag so only the latest value redraws
  const thresholdRafRef = useRef(null); // rAF id — cancelled on each drag so only the latest value redraws
  const meshXRayRafRef = useRef(null); // rAF id — cancelled on each drag so only the latest value redraws
  const settingsCommitRafRef = useRef(null); // rAF id — throttles the layerSettings React commit itself to once per frame, so it matches the once-per-frame GL redraw above instead of re-rendering the whole card list on every Radix onValueChange tick
  const fileMeshesRef = useRef(new Map()); // url → NVMesh for surface meshes loaded from files; keyed by url since nv.meshes also holds connectome meshes

  // ─── Derived values ─────────────────────────────────────────────────────────
  // hasImageVolumes is derived from orderedLayers (not `layers`) to also catch files dropped
  // into this component's own zone, which never touches the `layers` prop.
  // Meshes and connectomes are both excluded — neither has 2D slices, so a mesh-only scene
  // is 3D-only just like a connectome-only one.
  const hasImageVolumes = orderedLayers.some(isImageVolumeLayer);

  // ─── Hooks: canvas + NiiVue lifecycle ────────────────────────────────────────
  // Tracks the canvas container's size and switches nv between AUTO/GRID multiplanar layout.
  const { canvasContainerRef } = useCanvasAutoLayout({ nvRef });
  // Drag-to-resize for the canvas row's min-height.
  const { rowRef, handleResizeStart } = useRowResize(MIN_CANVAS_HEIGHT);
  // Attaches the shared NiiVue instance to the canvas on mount, and clears it on unmount.
  const { canvasRef } = useSharedNiiVueInstance({
    nvRef,
    hasImageVolumes,
    activeSliceType,
    onNiiNvReady,
    fileMeshesRef,
    onHas3DExtentChange,
  });
  // Loading/success toast tracking isLoading.
  useLoadingToast(isLoading, NII_LOADING_TOAST_ID);

  // ─── Hooks: layer loading/syncing ────────────────────────────────────────────
  // Loads image volumes/meshes into nv whenever the `layers` prop changes.
  useLayerLoader({
    layers,
    nvRef,
    fileMeshesRef,
    setOrderedLayers,
    setLayerSettings,
    setIsLoading,
    onViewReady,
    onLoadError,
  });
  // Merges the electrode connectome into the card list and builds/rebuilds its mesh.
  const { electrodeMeshRef, clearElectrodeMesh, dismissElectrodeLayer } = useElectrodeConnectome({
    electrodeLayer,
    nvRef,
    orderedLayers,
    layerSettings,
    setOrderedLayers,
    setLayerSettings,
  });
  // Merges the ESI source-power layer into the card list and builds/rebuilds its mesh or volume.
  const { esiMeshRef, clearEsiMesh, clearEsiVolume, dismissEsiLayer } = useEsiLayer({
    esiLayer,
    isEsiVolumeMode,
    nvRef,
    orderedLayers,
    layerSettings,
    setOrderedLayers,
    setLayerSettings,
  });

  // ─── Handlers ───────────────────────────────────────────────────────────────
  // Switches the active 2D/3D slice view and syncs it to nv.
  const handleSliceTypeChange = (sliceType) => {
    setActiveSliceType(sliceType);
    nvRef.current?.setSliceType(sliceType);
  };

  // Applies a single ImagingControls setting change (opacity/colormap/threshold/etc.). Always
  // updates React state first, then dispatches to the right nv-mutation helper by layer kind —
  // volumes/meshes/connectomes each live in a different part of nv and support a different
  // subset of settings (see the three apply*SettingChange helpers above).
  const handleSettingChange = useCallback(
    (layerIndex, key, value) => {
      // 'cal_range' carries both fractions as a [min, max] pair in one call — the Threshold
      // slider's drag updates cal_min and cal_max together, and firing two separate
      // onSettingChange('cal_min', ...) / ('cal_max', ...) calls back-to-back would race: the
      // second call's nextLayerSettings would still be built from the layerSettings closure
      // captured before the first call's setLayerSettings took effect, silently discarding it.
      const layerUpdate =
        key === 'cal_range' ? { cal_min: value[0], cal_max: value[1] } : { [key]: value };

      // nv.opts.meshXRay is one scene-global value, not per-layer, so unlike every other
      // setting here, a meshXRay change has to be written onto every mesh/connectome layer's
      // settings entry — not just the layer whose slider was dragged — or their cards would
      // silently drift out of sync with each other.
      let nextLayerSettings;
      if (key === 'meshXRay') {
        nextLayerSettings = layerSettings.map((layerSetting, index) => {
          const isMeshOrConnectome = !isImageVolumeLayer(orderedLayers[index]);
          return isMeshOrConnectome ? { ...layerSetting, meshXRay: value } : layerSetting;
        });
      } else {
        nextLayerSettings = layerSettings.map((layerSetting, index) =>
          index === layerIndex ? { ...layerSetting, ...layerUpdate } : layerSetting
        );
      }
      // Throttled to once per animation frame — cancelling any pending commit and scheduling the
      // latest one, same pattern as the GL redraw below. This matters for slider drags
      // (opacity/threshold/meshXRay), which can call this several times per frame; it's a no-op
      // cost for single-fire changes (visible/colormap/isEsiVolume/...) since those only ever
      // call this once, so they still land on the very next frame either way.
      if (settingsCommitRafRef.current) cancelAnimationFrame(settingsCommitRafRef.current);
      settingsCommitRafRef.current = requestAnimationFrame(() => {
        settingsCommitRafRef.current = null;
        setLayerSettings(nextLayerSettings);
      });
      // Persisted independently of layerSettings so the Connectome/Volume toggle survives
      // handleDeleteLayer wiping the ESI settings entry — see lastEsiVolumeMode's declaration.
      // setLastEsiVolumeMode fires synchronously here (unlike the throttled setLayerSettings
      // above), but that's safe: the `?? lastEsiVolumeMode` fallback above only ever kicks in
      // when the ESI settings entry is entirely absent (deleted), not when it's merely one frame
      // stale, so the two being on different schedules doesn't produce a wrong intermediate value.
      if (key === 'isEsiVolume') setLastEsiVolumeMode(value);

      if (!nvRef.current) return;
      const nv = nvRef.current;
      const layer = orderedLayers[layerIndex];
      if (!layer) return;
      const settings = nextLayerSettings[layerIndex]; // this layer's own settings, post-update

      if (layer.kind === 'connectome') {
        applyConnectomeSettingChange({
          layer,
          key,
          value,
          settings,
          nv,
          esiMeshRef,
          electrodeMeshRef,
          thresholdRafRef,
          meshXRayRafRef,
        });
      } else if (layer.kind === 'mesh') {
        applyFileMeshSettingChange({
          layer,
          key,
          value,
          settings,
          nv,
          fileMeshesRef,
          meshXRayRafRef,
        });
      } else {
        applyVolumeSettingChange({
          layer,
          layerIndex,
          orderedLayers,
          key,
          value,
          settings,
          nextLayerSettings,
          nv,
          opacityRafRef,
          thresholdRafRef,
        });
      }
    },
    [layerSettings, orderedLayers, nvRef, esiMeshRef, electrodeMeshRef]
  );

  // Loads files dropped into this component's own drop zone, appending them alongside whatever's already loaded.
  const handleNiiFiles = async (files) => {
    if (!nvRef.current) return;
    setIsLoading(true);
    const newLayers = filesToLayers(files);
    const allLayers = [...orderedLayers, ...newLayers];
    // startIndex ensures new layers get 0.6 opacity rather than being treated as the first;
    // getCurrentMeshXRay keeps a newly-dropped mesh in sync with the scene's existing
    // meshXRay rather than resetting it back to the default (see that function's comment).
    const newLayerSettings = getInitialLayerSettings(
      newLayers,
      orderedLayers.length,
      undefined,
      getCurrentMeshXRay(orderedLayers, layerSettings)
    );
    const allLayerSettings = [...layerSettings, ...newLayerSettings];
    setOrderedLayers(allLayers);
    setLayerSettings(allLayerSettings);
    // Image volumes and surface meshes take separate NiiVue load paths (nv.loadVolumes vs
    // nv.addMeshesFromUrl); connectomes are handled by their own effects and excluded from both.
    const imageLayers = allLayers.filter(isImageVolumeLayer);
    const imageLayerSettings = allLayerSettings.filter((_, i) => isImageVolumeLayer(allLayers[i]));
    const meshLayers = allLayers.filter((l) => l.kind === 'mesh');
    const meshLayerSettings = allLayerSettings.filter((_, i) => allLayers[i].kind === 'mesh');

    // Load volumes and meshes independently (allSettled, not all) so one category failing
    // doesn't discard the other. Each NiiVue loader is all-or-nothing — it adds nothing to
    // the scene if any file in its batch fails — so on failure nv needs no cleanup; we only
    // roll back the optimistically-added cards for that category's newly-dropped files, by
    // url, leaving already-loaded layers untouched.
    const [volumeResult, meshResult] = await Promise.allSettled([
      syncVolumesAndApplySettings(nvRef.current, imageLayers, imageLayerSettings),
      syncMeshesAndApplySettings(
        nvRef.current,
        meshLayers,
        meshLayerSettings,
        fileMeshesRef.current
      ),
    ]);

    const failedUrls = new Set();
    if (volumeResult.status === 'rejected')
      newLayers.filter(isImageVolumeLayer).forEach((l) => failedUrls.add(l.url));
    if (meshResult.status === 'rejected')
      newLayers.filter((l) => l.kind === 'mesh').forEach((l) => failedUrls.add(l.url));

    if (failedUrls.size > 0) {
      setOrderedLayers((prev) => prev.filter((l) => !failedUrls.has(l.url)));
      setLayerSettings((prev) => prev.filter((s) => !failedUrls.has(s.url)));
      const reason = volumeResult.reason ?? meshResult.reason;
      toast.error({`Failed to load image: ${reason.message}`});
    }
    requestAnimationFrame(() => setIsLoading(false)); // wait one frame before clearing spinner
  };

  // Reorders orderedLayers/layerSettings after a card drag, and moves the matching NVImage in nv if an image volume was moved.
  const handleReorder = useCallback(
    (event) => {
      if (!nvRef.current) return; // Guard clause — if NiiVue isn't initialized yet, we can't reorder

      const urls = orderedLayers.map((layer) => layer.url); // Get the current order of URLs
      const newUrls = move(urls, event); // Get the new order of URLs based on the drag event
      if (newUrls === urls) return; // no change (canceled or same position)

      // Reorder the orderedLayers and layerSettings arrays to match the new order of URLs
      const newOrderedLayers = newUrls.map((url) =>
        orderedLayers.find((layer) => layer.url === url)
      );
      const newLayerSettings = newUrls.map((url) => {
        const oldIndex = orderedLayers.findIndex((layer) => layer.url === url);
        return layerSettings[oldIndex];
      });

      setOrderedLayers(newOrderedLayers);
      setLayerSettings(newLayerSettings);

      // Connectome and mesh layers have no slot in nv.volumes at all, and reordering a mesh
      // relative to volumes has no rendering effect anyway (3D meshes vs. 2D slice
      // compositing have no shared z-order) — only move the NVImage when an actual
      // image volume was dragged.
      const movedLayer = orderedLayers[event.operation.source.initialIndex];
      if (movedLayer && isImageVolumeLayer(movedLayer)) {
        const imagesBefore = orderedLayers.filter(isImageVolumeLayer);
        const imagesAfter = newOrderedLayers.filter(isImageVolumeLayer);
        const fromIndex = imagesBefore.indexOf(movedLayer);
        const toIndex = imagesAfter.indexOf(movedLayer);
        setIsLoading(true);
        nvRef.current.setVolume(nvRef.current.volumes[fromIndex], toIndex);
        nvRef.current.updateGLVolume();
        // updateGLVolume schedules a GL redraw but returns before it paints — wait one frame before clearing the spinner
        requestAnimationFrame(() => setIsLoading(false));
      }
    },
    [orderedLayers, layerSettings, nvRef]
  );

  // Removes a layer's card and its underlying nv volume/mesh, dispatching by kind.
  const handleDeleteLayer = useCallback(
    (index) => {
      if (!nvRef.current) return; // Guard clause — if NiiVue isn't initialized yet, we can't delete
      const nv = nvRef.current;
      const layer = orderedLayers[index];

      if (layer?.kind === 'connectome') {
        // Dispatch by URL — each connectome layer tracks its own mesh, owned by its own hook
        // (mutating `.current` directly isn't allowed from outside that hook, hence clear*Mesh).
        if (layer.url === ESI_LAYER_URL) {
          if (esiMeshRef.current) {
            nv.removeMesh(esiMeshRef.current);
            clearEsiMesh();
          }
          dismissEsiLayer();
        } else if (layer.url === ELECTRODE_LAYER_URL) {
          if (electrodeMeshRef.current) {
            nv.removeMesh(electrodeMeshRef.current);
            clearElectrodeMesh();
          }
          dismissElectrodeLayer();
          onElectrodeLayerDismissed?.(); // tells PatientView to flip the electrode toggle off
        }
      } else if (layer?.kind === 'mesh') {
        // File meshes live in nv.meshes, tracked by fileMeshesRef — drop it from both.
        const mesh = fileMeshesRef.current.get(layer.url);
        if (mesh) {
          nv.removeMesh(mesh);
          fileMeshesRef.current.delete(layer.url);
        }
      } else {
        const nvIndex = orderedLayers.slice(0, index).filter(isImageVolumeLayer).length;
        nv.removeVolumeByIndex(nvIndex);
        // The ESI volume (volume mode) is a non-connectome layer too — clear its ref so the
        // ESI build effect doesn't try to remove an already-gone NVImage on its next rebuild,
        // and dismiss it for the same reason as the connectome branch above.
        if (layer?.url === ESI_LAYER_URL) {
          clearEsiVolume();
          dismissEsiLayer();
        }
      }
      setOrderedLayers(orderedLayers.filter((_, i) => i !== index));
      setLayerSettings(layerSettings.filter((_, i) => i !== index));
    },
    [
      orderedLayers,
      layerSettings,
      nvRef,
      esiMeshRef,
      electrodeMeshRef,
      clearEsiMesh,
      clearEsiVolume,
      clearElectrodeMesh,
      dismissEsiLayer,
      dismissElectrodeLayer,
    ]
  );

  // ─── Effects: UI ────────────────────────────────────────────────────────────

  // Force 3D view when there are no image volumes — connectome-only scenes have no slices.
  // Only acts on the "no volumes" side: firing on re-appearance races with an in-flight
  // nv.loadVolumes() and can leave the spinner stuck.
  useEffect(() => {
    if (hasImageVolumes) return;
    // nv is never told to switch back to 2D when volumes reappear (deliberately, per above),
    // so activeSliceType has to be committed here rather than derived at render — otherwise the
    // buttons' pressed-state would drift out of sync with what nv is actually showing.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveSliceType(SLICE_TYPE.RENDER);
    nvRef.current?.setSliceType(SLICE_TYPE.RENDER);
  }, [hasImageVolumes, nvRef]);

  // Reports whether this viewer currently holds any layers at all — see onHasContentChange
  // above for why the parent needs this instead of inferring it from its own props.
  useEffect(() => {
    onHasContentChange?.(orderedLayers.length > 0);
  }, [orderedLayers, onHasContentChange]);

  // Reports whether the 3D scene has a usable spatial extent — i.e. at least one image
  // volume or surface mesh. A connectome-only scene (electrodes and/or the ESI
  // layer in connectome mode) leaves NiiVue's scene extent at zero, which makes its per-frame
  // sync() crash (createOnLocationChange → toFixed(Infinity)) if another instance is broadcast-
  // linked to it. PatientView uses this to keep the cross-panel rotation link off whenever this
  // viewer holds nothing but connectomes — see the sync effect in PatientView. Covers every
  // case where the component stays mounted; useSharedNiiVueInstance's unmount cleanup separately
  // reports `false` once nv is actually emptied, since this effect body can't fire on unmount.
  useEffect(() => {
    onHas3DExtentChange?.(orderedLayers.some((layer) => layer.kind !== 'connectome'));
  }, [orderedLayers, onHas3DExtentChange]);

  // ─── Effects: card ordering ─────────────────────────────────────────────────

  // Keep image volumes (reorderable) above meshes/connectomes (fixed) in the card list, so
  // the fixed layers cluster at the bottom — they have no meaningful z-order in the 3D scene
  // and aren't draggable, and grouping them out of the reorderable volumes makes that clear.
  // Runs whenever orderedLayers changes (a mesh dropped, a connectome merged in, or the ESI
  // layer flipping between volume/connectome kind) and re-sorts if needed. The partition is
  // stable, so each group's relative order is preserved — critically, the image volumes keep
  // their order, so the user's reordering and the image→nv.volumes index mapping both survive.
  // Bails when already sorted so it doesn't loop.
  useEffect(() => {
    const order = orderedLayers.map((_, i) => i);
    order.sort(
      (a, b) =>
        Number(!isImageVolumeLayer(orderedLayers[a])) -
        Number(!isImageVolumeLayer(orderedLayers[b]))
    );
    if (order.every((originalIndex, i) => originalIndex === i)) return; // already volumes-first — bails before setState, so this only ever commits one corrective render per actual reorder, never loops
    // orderedLayers is read positionally elsewhere (nv.volumes index mapping in
    // handleSettingChange/handleDeleteLayer, the layer hooks), so it must be the committed
    // source of truth — a derived-at-render sorted copy would desync from those index lookups.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrderedLayers(order.map((i) => orderedLayers[i]));
    setLayerSettings((prev) => order.map((i) => prev[i]));
  }, [orderedLayers]);

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col pb-2.5 px-2 gap-2">
      {/* Controls panel, with a compact drop zone below it for loading additional files while the NiiViewer is active */}
      <div className="flex flex-col">
        <ImagingControls
          layers={orderedLayers}
          layerSettings={layerSettings}
          onSettingChange={handleSettingChange}
          onReorder={handleReorder}
          onDeleteLayer={handleDeleteLayer}
        />
        <FileDropZone
          onFiles={handleNiiFiles}
          accepted_formats=".nii,.nii.gz,.mgh,.mgz,.gii,.ply,.obj"
          label="Drop additional files"
          compact
        />
      </div>

      {/* Canvas fills remaining height, min MIN_CANVAS_HEIGHT. Resize handle below can raise that floor. */}
      <div
        ref={rowRef}
        data-testid="nii-canvas-row"
        className="flex flex-row flex-1"
        style={{ minHeight: MIN_CANVAS_HEIGHT }}
      >
        {/* NiiVue Canvas */}
        <div ref={canvasContainerRef} className="relative flex-1 overflow-hidden">
          {/* Loading spinner overlay — absolute to cover the canvas, with a higher z-index so it appears on top */}
          {isLoading && (
            <div
              data-testid="loading-spinner"
              className="absolute inset-0 z-10 flex items-center justify-center"
            >
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-border border-t-primary" />
            </div>
          )}
          <canvas ref={canvasRef} className="absolute inset-0" />
        </div>
        <div className="">
          <div
            className={cn(
              'flex flex-col w-8 gap-0.5 pt-2 items-center',
              'rounded-r-md border-r-1 border-t-1 border-b-1 border-border'
            )}
          >
            {/* Viewer controls with Ax, Co, Sa, MP and 3D buttons — the 2D ones are greyed
                out and inert without an image volume loaded (3D/connectome-only scenes
                have no slices to show), per the hasImageVolumes effect above. */}
            {SLICE_TYPE_OPTIONS.map(({ sliceType, label, buttonLabel }) => {
              const disabled = sliceType !== SLICE_TYPE.RENDER && !hasImageVolumes;
              return (
                <button
                  key={sliceType}
                  type="button"
                  className="button size-xs disabled:opacity-40 disabled:pointer-events-none"
                  onClick={() => handleSliceTypeChange(sliceType)}
                  disabled={disabled}
                  title={
                    disabled
                      ? 'No image volume loaded — only the 3D view is available'
                      : `${label} view`
                  }
                  aria-label={`${label} view`}
                  aria-pressed={activeSliceType === sliceType}
                >
                  {buttonLabel}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Resize handle — drag down to grow canvas past flex size, drag up to shrink back.
          Once it reaches the row's natural flex size, further upward dragging has no effect,
          since min-height never shrinks a flex item below what it'd render at anyway. See handleCanvasResizeStart*/}
      <div
        data-testid="nii-canvas-resize-handle"
        className="h-1.5 w-full shrink-0 cursor-row-resize rounded-sm select-none bg-border hover:bg-secondary active:bg-primary"
        title="Drag to resize the canvas"
        onMouseDown={handleResizeStart}
      />
    </div>
  );
};
