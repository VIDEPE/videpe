import { useRef, useState, useCallback, useEffect, useMemo, useReducer } from 'react';
import { cn } from '../utils/utils';
import { SLICE_TYPE } from '@niivue/niivue';
import { move } from '@dnd-kit/helpers';
import toast from 'react-hot-toast';
import { BoomBox, Slice } from 'lucide-react';

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
  filesToLayers,
  isImageVolumeLayer,
  getCalBounds,
  fractionToCalValue,
  syncVolumesAndApplySettings,
  syncMeshesAndApplySettings,
  revokeLayerUrls,
  isAnyColorbarActive,
  ESI_LAYER_URL,
  ELECTRODE_LAYER_URL,
  applyColormap,
  computeAzimuthElevation,
} from '../utils/NiiViewer.utils';
import {
  layerReducer,
  initLayerState,
  selectOrderedLayers,
  selectLayerSettings,
  selectEntry,
  selectNvVolumeIndex,
  APPEND_FILE_LAYERS,
  REMOVE_LAYERS,
  REORDER,
  UPDATE_SETTINGS,
} from '@/state/layerState';
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
// Image volumes are the default case — addressed by their index in nv.volumes (nvIndex, see
// selectNvVolumeIndex: connectome and mesh layers have a card but no slot in nv.volumes).
function applyVolumeSettingChange({
  layer,
  nvIndex,
  key,
  value,
  settings,
  nextLayerSettings,
  nv,
  opacityRafRef,
  thresholdRafRef,
}) {
  const nvVolume = nv.volumes[nvIndex];
  if (!nvVolume) return;

  if (key === 'visible') {
    nv.setOpacity(nvIndex, value ? settings.opacity : 0);
    // A hidden volume must not keep drawing its colorbar either — NiiVue only checks
    // colorbarVisible, never opacity, when deciding what to draw. Don't touch
    // settings.showColorbar itself (the persisted preference) — just mirror visibility onto
    // colorbarVisible, so the colorbar reappears on its own once the volume is shown again.
    nvVolume.colorbarVisible = value && settings.showColorbar;
    nv.opts.isColorbar = isAnyColorbarActive(nextLayerSettings);
    nv.updateGLVolume();
  } else if (key === 'opacity') {
    // Throttle to one GL redraw per frame — cancels any pending rAF so only the latest drag value redraws
    if (settings.visible) {
      if (opacityRafRef.current) cancelAnimationFrame(opacityRafRef.current);
      opacityRafRef.current = requestAnimationFrame(() => nv.setOpacity(nvIndex, value));
    }
  } else if (key === 'colormap') {
    applyColormap(nv, nvVolume, value);

    // setColormap's internal updateGLVolume() re-triggers NiiVue's own cal_min/cal_max
    // auto-scan, which would otherwise silently overwrite the user's chosen threshold right
    // after it's set (same requirement as syncVolumesAndApplySettings's initial-load path).
    const { boundMin, boundMax } = getCalBounds(layer, nvVolume, settings.colormap);
    nvVolume.cal_min = fractionToCalValue(settings.cal_min, boundMin, boundMax);
    nvVolume.cal_max = fractionToCalValue(settings.cal_max, boundMin, boundMax);
    nv.updateGLVolume();
  } else if (key === 'invert') {
    nvVolume.colormapInvert = value;
    nv.updateGLVolume();
  } else if (key === 'showColorbar') {
    // Same principle as the 'visible' branch above, the other direction: toggling the
    // preference on while the volume happens to be hidden shouldn't draw anything until it's
    // shown again.
    nvVolume.colorbarVisible = value && settings.visible;
    nv.opts.isColorbar = isAnyColorbarActive(nextLayerSettings);
    nv.updateGLVolume();
  } else if (key === 'cal_min' || key === 'cal_max' || key === 'cal_range') {
    // Throttle to one GL redraw per frame — cancels any pending rAF so only the latest drag value redraws
    if (settings.visible) {
      if (thresholdRafRef.current) cancelAnimationFrame(thresholdRafRef.current);
      thresholdRafRef.current = requestAnimationFrame(() => {
        // value alone (a 0-1 fraction) isn't a real cal_min/cal_max — it has to be resolved
        // against this volume's own data range first (see getCalBounds above).
        const { boundMin, boundMax } = getCalBounds(layer, nvVolume, settings.colormap);
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
  nodeScaleRafRef,
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
  } else if (key === 'nodeScale' || key === 'edgeScale') {
    // Throttle to one GL redraw per frame — cancels any pending rAF so only the latest drag value redraws
    if (nodeScaleRafRef.current) cancelAnimationFrame(nodeScaleRafRef.current);
    nodeScaleRafRef.current = requestAnimationFrame(() => {
      // Like nodeMinColor/edgeMin above, node/edge radii are only recomputed when the
      // color/size buffers are rebuilt — mutating mesh.nodeScale/edgeScale alone has no visual
      // effect until mesh.updateMesh(gl) recomputes them.
      mesh[key] = value;
      mesh.updateMesh(nv.gl);
      nv.updateGLVolume();
    });
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
  onElectrodeLayerDismissed,
  onLoadError,
  clickedEegChannelPos, // {pos: {x,y,z}, clickId} The location of the clicked Eeg Channel the niiviewer cursor should move to
  nvTopoRef,
}) => {
  // ─── State ─────────────────────────────────────────────────────────────────
  // layerState holds every layer (the `layers` prop's files, files dropped here, the electrode
  // connectome, the ESI layer) with its own settings, in display order. It changes only through
  // dispatchLayers(action): useReducer then runs the reducer on the latest state, stores the
  // result and re-renders (see layerState.js for the actions and the invariants they keep).
  //   layerReducer   — computes the next state from the current state and an action
  //   layers         — the starting input: the `layers` prop's file layers
  //   initLayerState — turns that input into the first state (called once, on the first render)
  const [layerState, dispatchLayers] = useReducer(layerReducer, layers, initLayerState);
  // The layers alone, in display order — for positional reads (the drag-reorder event's indices,
  // has-content checks). Derived from the one state, so it can't get out of step with it.
  const orderedLayers = useMemo(() => selectOrderedLayers(layerState), [layerState]);
  const [isLoading, setIsLoading] = useState(true);
  // Whether the load that just finished (or is about to start) ended in an error — isLoading
  // alone can't distinguish success from failure (it's just "in flight" vs "not"), so this is
  // what tells useLoadingToast below not to show its misleading "Imaging data loaded!" success
  // toast right alongside the real error toast(s) for the same failure. Reset to false whenever
  // a new `layers` prop load starts (see the effect below) or handleNiiFiles starts a new
  // internal-dropzone load, then flipped true by whichever failure branch actually hits.
  const [hasLoadError, setHasLoadError] = useState(false);
  const [activeSliceType, setActiveSliceType] = useState(SLICE_TYPE.MULTIPLANAR);
  const [isRadiologicalConvention, setIsRadiologicalConvention] = useState(false);
  const [isClipPlaneOn, setIsClipPlaneOn] = useState(false);
  // Connectome/Volume toggle for the ESI layer, read by the ESI effects below. Normally it just
  // mirrors the ESI entry's settings, but that entry disappears whenever handleDeleteLayer
  // deletes the ESI card — and falling back to a hardcoded `true` in that gap would look like
  // the user just switched from Connectome to Volume mode, making useEsiLayer rebuild the layer
  // it was just asked to delete. layerState.lastEsiVolumeMode is the fallback instead: the last
  // mode the user actually chose, which outlives the entry, so useEsiLayer sees no change.
  const isEsiVolumeMode =
    selectEntry(layerState, ESI_LAYER_URL)?.settings.isEsiVolume ?? layerState.lastEsiVolumeMode;

  // ─── Refs ───────────────────────────────────────────────────────────────────
  const opacityRafRef = useRef(null); // rAF id — cancelled on each drag so only the latest value redraws
  const thresholdRafRef = useRef(null); // rAF id — cancelled on each drag so only the latest value redraws
  const meshXRayRafRef = useRef(null); // rAF id — cancelled on each drag so only the latest value redraws
  const nodeScaleRafRef = useRef(null); // rAF id — shared by nodeScale/edgeScale (only one slider can be dragged at a time), cancelled on each drag so only the latest value redraws
  const settingsCommitRafRef = useRef(null); // rAF id — throttles the settings React commit itself to once per frame, so it matches the once-per-frame GL redraw above instead of re-rendering the whole card list on every Radix onValueChange tick
  const pendingSettingPatchesRef = useRef(new Map()); // url → settings patch waiting for that once-per-frame commit, merged per url
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
  const { rowRef, handleResizeStart, isDragging: isRowResizing } = useRowResize(MIN_CANVAS_HEIGHT);
  // Attaches the shared NiiVue instance to the canvas on mount, and clears it on unmount.
  const { canvasRef } = useSharedNiiVueInstance({
    nvRef,
    hasImageVolumes,
    activeSliceType,
    onNiiNvReady,
    fileMeshesRef,
    onHas3DExtentChange,
  });
  // Loading/success toast tracking isLoading, suppressed in favor of the error toast(s) below
  // when the load that just finished failed.
  useLoadingToast(isLoading, NII_LOADING_TOAST_ID, hasLoadError);

  // A new `layers` prop value means useLayerLoader below is about to start a new load (or clear
  // down to empty, which isn't a failure either) — reset ahead of that so a stale hasLoadError
  // from a previous failed load doesn't wrongly suppress this one's success toast. Can't derive
  // this at render instead: hasLoadError's whole purpose is to persist past this point, through
  // the async load that follows, until the matching success/failure callback fires.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHasLoadError(false);
  }, [layers]);

  // Wraps the parent-facing onLoadError so this component also learns locally that its current
  // load failed (for the toast-suppression above), without changing what the parent itself
  // receives.
  const handleLayerLoadError = useCallback(
    (failedUrls) => {
      setHasLoadError(true);
      onLoadError?.(failedUrls);
    },
    [onLoadError]
  );

  // ─── Hooks: layer loading/syncing ────────────────────────────────────────────
  // Loads image volumes/meshes into nv whenever the `layers` prop changes.
  useLayerLoader({
    layers,
    nvRef,
    fileMeshesRef,
    layerState,
    dispatchLayers,
    setIsLoading,
    onViewReady,
    onLoadError: handleLayerLoadError,
  });
  // Merges the electrode connectome into the card list and builds/rebuilds its mesh.
  const { electrodeMeshRef, clearElectrodeMesh, dismissElectrodeLayer } = useElectrodeConnectome({
    electrodeLayer,
    nvRef,
    layerState,
    dispatchLayers,
  });
  // Merges the ESI source-power layer into the card list and builds/rebuilds its mesh or volume.
  const { esiMeshRef, clearEsiMesh, clearEsiVolume, dismissEsiLayer } = useEsiLayer({
    esiLayer,
    isEsiVolumeMode,
    nvRef,
    layerState,
    dispatchLayers,
    nvTopoRef,
  });

  // ─── Handlers ───────────────────────────────────────────────────────────────
  // Switches the active 2D/3D slice view and syncs it to nv.
  const handleSliceTypeChange = (sliceType) => {
    setActiveSliceType(sliceType);
    nvRef.current?.setSliceType(sliceType);
  };

  // Toggles between neurological (left-is-left) and radiological (left-is-right) display convention.
  const handleRadiologicalConventionToggle = () => {
    const next = !isRadiologicalConvention;
    setIsRadiologicalConvention(next);
    nvRef.current?.setRadiologicalConvention(next);
  };

  // Toggles nv's clip plane on/off directly via its public setClipPlane API. Depth 2 is
  // niivue's own "disabled" sentinel (see DEFAULT_DEPTH_AZI_ELEV in its ClipPlaneManager) —
  // any depth past ~1.8 turns clipping off entirely, whereas depth 0 (its POSTERIOR preset
  // orientation) shows a clip plane through the volume's center. Only visible in the 3D
  // render view — clip planes have no effect on 2D slices.
  const handleClipPlaneToggle = () => {
    const nv = nvRef.current;
    if (!nv) return;
    const next = !isClipPlaneOn;
    setIsClipPlaneOn(next);
    nv.setClipPlane(next ? [0, 180, 0] : [2, 0, 0]); // depth 2 is niivue's default "disabled" value
  };

  // Applies a single ImagingControls setting change (opacity/colormap/threshold/etc.) to the
  // layer at `url`: commits it to React state, then dispatches to the right nv-mutation helper by
  // layer kind — volumes/meshes/connectomes each live in a different part of nv and support a
  // different subset of settings (see the three apply*SettingChange helpers above).
  const handleSettingChange = useCallback(
    (url, key, value) => {
      // 'cal_range' carries both fractions as a [min, max] pair in one call — the Threshold
      // slider's drag updates cal_min and cal_max together in a single patch.
      const patch =
        key === 'cal_range' ? { cal_min: value[0], cal_max: value[1] } : { [key]: value };
      // The settings as they'll be once this patch lands — the same reducer computes them, so
      // what nv gets now matches what React commits below (including meshXRay being written
      // onto every mesh/connectome, see UPDATE_SETTINGS in layerState.js).
      const nextState = layerReducer(layerState, { type: UPDATE_SETTINGS, url, patch });

      // The React commit is throttled to once per animation frame, which matters for slider
      // drags (opacity/threshold/meshXRay) that fire several times per frame. It only ever
      // commits a url-keyed patch, merged per url and applied by the reducer to whatever the
      // state is by then — never a whole settings array built now, which would overwrite any
      // layer merged in or re-sorted before the frame fires (the electrode/ESI black-render bug).
      const pending = pendingSettingPatchesRef.current;
      pending.set(url, { ...pending.get(url), ...patch });
      if (!settingsCommitRafRef.current) {
        settingsCommitRafRef.current = requestAnimationFrame(() => {
          settingsCommitRafRef.current = null;
          const patches = pendingSettingPatchesRef.current;
          pendingSettingPatchesRef.current = new Map();
          patches.forEach((urlPatch, patchUrl) =>
            dispatchLayers({ type: UPDATE_SETTINGS, url: patchUrl, patch: urlPatch })
          );
        });
      }

      if (!nvRef.current) return;
      const nv = nvRef.current;
      const entry = selectEntry(nextState, url);
      if (!entry) return;
      const { layer, settings } = entry; // this layer's own settings, post-update
      const nextLayerSettings = selectLayerSettings(nextState);

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
          nodeScaleRafRef,
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
          nvIndex: selectNvVolumeIndex(nextState, url),
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
    [layerState, nvRef, esiMeshRef, electrodeMeshRef]
  );

  // Loads files dropped into this component's own drop zone, appending them alongside whatever's already loaded.
  const handleNiiFiles = async (files) => {
    if (!nvRef.current) return;
    setIsLoading(true);
    setHasLoadError(false); // this internal-dropzone path never touches `layers`, so the effect above won't reset it
    let newLayers;
    try {
      // A dropped .dcm file runs dcm2niix conversion inside filesToLayers, which can reject on
      // corrupt/unsupported data — every other format just wraps the File in a blob: URL and
      // can't fail. PatientView's own handleNiiFiles guards the same call for the same reason.
      newLayers = await filesToLayers(files);
    } catch (err) {
      setHasLoadError(true);
      toast.error(`Error loading imaging data:\n${err.message}`);
      requestAnimationFrame(() => setIsLoading(false));
      return;
    }
    // Add the cards right away (the reducer seeds their defaults: not the first layer's full
    // opacity, and the scene's current meshXRay), and load from the same resulting state.
    const appendAction = { type: APPEND_FILE_LAYERS, layers: newLayers };
    const nextState = layerReducer(layerState, appendAction);
    dispatchLayers(appendAction);
    // Image volumes and surface meshes take separate NiiVue load paths (nv.loadVolumes vs
    // nv.addMeshesFromUrl); connectomes are handled by their own effects and excluded from both.
    const imageEntries = nextState.entries.filter((entry) => isImageVolumeLayer(entry.layer));
    const meshEntries = nextState.entries.filter((entry) => entry.layer.kind === 'mesh');
    const imageLayers = imageEntries.map((entry) => entry.layer);
    const imageLayerSettings = imageEntries.map((entry) => entry.settings);
    const meshLayers = meshEntries.map((entry) => entry.layer);
    const meshLayerSettings = meshEntries.map((entry) => entry.settings);

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
      newLayers.filter((layer) => layer.kind === 'mesh').forEach((l) => failedUrls.add(l.url));

    if (failedUrls.size > 0) {
      // A rejected load never reaches syncVolumesAndApplySettings/syncMeshesAndApplySettings's
      // own revoke, so these blobs are still live — free them here instead.
      if (volumeResult.status === 'rejected') revokeLayerUrls(newLayers.filter(isImageVolumeLayer));
      if (meshResult.status === 'rejected')
        revokeLayerUrls(newLayers.filter((l) => l.kind === 'mesh'));
      dispatchLayers({ type: REMOVE_LAYERS, urls: [...failedUrls] });
      setHasLoadError(true); // suppresses useLoadingToast's success toast once setIsLoading(false) below fires
      // One toast per failed layer, named by file rather than by its opaque blob: url — mirrors
      // useLayerLoader's failure handling (see its comment) for the same reason: each NiiVue
      // loader is all-or-nothing, so every layer in a failed category is reported, and a volume
      // failure and a mesh failure can have different reasons so they can't share one message.
      if (volumeResult.status === 'rejected') {
        newLayers
          .filter(isImageVolumeLayer)
          .forEach((layer) =>
            toast.error(`Failed to load image ${layer.name}:\n${volumeResult.reason.message}`)
          );
      }
      if (meshResult.status === 'rejected') {
        newLayers
          .filter((l) => l.kind === 'mesh')
          .forEach((layer) =>
            toast.error(`Failed to load image ${layer.name}:\n${meshResult.reason.message}`)
          );
      }
    }
    requestAnimationFrame(() => setIsLoading(false)); // wait one frame before clearing spinner
  };

  // Reorders the cards after a drag, and moves the matching NVImage in nv if an image volume was moved.
  const handleReorder = useCallback(
    (event) => {
      if (!nvRef.current) return; // Guard clause — if NiiVue isn't initialized yet, we can't reorder

      const urls = orderedLayers.map((layer) => layer.url); // Get the current order of URLs
      const newUrls = move(urls, event); // Get the new order of URLs based on the drag event
      if (newUrls === urls) return; // no change (canceled or same position)

      // Reorder the cards (each layer moves together with its settings)
      const reorderAction = { type: REORDER, urls: newUrls };
      const nextState = layerReducer(layerState, reorderAction);
      dispatchLayers(reorderAction);

      // Connectome and mesh layers have no slot in nv.volumes at all, and reordering a mesh
      // relative to volumes has no rendering effect anyway (3D meshes vs. 2D slice
      // compositing have no shared z-order) — only move the NVImage when an actual
      // image volume was dragged.
      const movedLayer = orderedLayers[event.operation.source.initialIndex];
      if (movedLayer && isImageVolumeLayer(movedLayer)) {
        const fromIndex = selectNvVolumeIndex(layerState, movedLayer.url);
        const toIndex = selectNvVolumeIndex(nextState, movedLayer.url);
        setIsLoading(true);
        nvRef.current.setVolume(nvRef.current.volumes[fromIndex], toIndex);
        nvRef.current.updateGLVolume();
        // updateGLVolume schedules a GL redraw but returns before it paints — wait one frame before clearing the spinner
        requestAnimationFrame(() => setIsLoading(false));
      }
    },
    [orderedLayers, layerState, nvRef]
  );

  // Removes a layer's card and its underlying nv volume/mesh, dispatching by kind.
  const handleDeleteLayer = useCallback(
    (url) => {
      if (!nvRef.current) return; // Guard clause — if NiiVue isn't initialized yet, we can't delete
      const nv = nvRef.current;
      const layer = selectEntry(layerState, url)?.layer;
      // Defensive backstop — normally already revoked right after load; no-op for sentinel URLs.
      if (layer) revokeLayerUrls([layer]);

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
        nv.removeVolumeByIndex(selectNvVolumeIndex(layerState, url));
        // The ESI volume (volume mode) is a non-connectome layer too — clear its ref so the
        // ESI build effect doesn't try to remove an already-gone NVImage on its next rebuild,
        // and dismiss it for the same reason as the connectome branch above.
        if (layer?.url === ESI_LAYER_URL) {
          clearEsiVolume();
          dismissEsiLayer();
        }
      }
      dispatchLayers({ type: REMOVE_LAYERS, urls: [url] });
    },
    [
      layerState,
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

  // Syncs the convention toggle to nv's actual current setting once on mount — nv is long-lived
  // and shared across remounts (see useSharedNiiVueInstance), so a hardcoded default here could
  // silently disagree with what's actually being displayed (e.g. after a fullscreen remount).
  useEffect(() => {
    if (!nvRef.current) return;
    setIsRadiologicalConvention(nvRef.current.getRadiologicalConvention());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // ─── Effects: Nii Vue interactions ─────────────────────────────────────────────────

  // move the main niivue canvas cursor to the position that is packed inside clickedEegChannelPos
  useEffect(() => {
    const nv = nvRef.current;
    const nvTopo = nvTopoRef?.current;
    const pos = clickedEegChannelPos?.pos;
    if (!nv || !pos) return; // if nv or pos is null / undefined
    nv.scene.crosshairPos = nv.mm2frac([pos.x, pos.y, pos.z]);
    // change the 3D view to align the view to the max ESI
    const [azi, elev] = computeAzimuthElevation([pos.x, pos.y, pos.z], nv.pivot3D);
    nv.setRenderAzimuthElevation(azi, elev);
    nv.updateGLVolume();
    if (nvTopo) {
      nvTopo.setRenderAzimuthElevation(azi, elev);
      nvTopo.updateGLVolume();
    }
  }, [clickedEegChannelPos, nvRef, nvTopoRef]);

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col pb-2.5 px-2 gap-2">
      {/* Controls panel, with a compact drop zone below it for loading additional files while the NiiViewer is active */}
      <div className="flex flex-col">
        <ImagingControls
          entries={layerState.entries}
          onSettingChange={handleSettingChange}
          onReorder={handleReorder}
          onDeleteLayer={handleDeleteLayer}
        />
        <FileDropZone
          onFiles={handleNiiFiles}
          accepted_formats=".nii,.nii.gz,.mgh,.mgz,.gii,.ply,.obj,.dcm"
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
        <div className="flex flex-col gap-2">
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

          {/* Radio/Clip buttons */}
          <div
            className={cn(
              'flex flex-col w-8 gap-0.5 py-2 items-center',
              'rounded-r-md border-r-1 border-t-1 border-b-1 border-border'
            )}
          >
            {/* Radiological/neurological display convention toggle. button-icon-xs (rather than
              size-xs) keeps a single icon glyph circular — size-xs's padding is asymmetric,
              tuned for the 2-character text labels in the slice-type group above. */}
            <button
              type="button"
              className="button button-icon-xs"
              onClick={handleRadiologicalConventionToggle}
              title={
                isRadiologicalConvention
                  ? 'Radiological convention — click for neurological'
                  : 'Neurological convention — click for radiological'
              }
              aria-label="Toggle radiological/neurological convention"
              aria-pressed={isRadiologicalConvention}
            >
              <BoomBox size={16} />
            </button>
            {/* Clip plane on/off toggle — only visible in the 3D render view (see handleClipPlaneToggle). */}
            <button
              type="button"
              className="button button-icon-xs"
              onClick={handleClipPlaneToggle}
              title={isClipPlaneOn ? 'Disable clip plane' : 'Enable clip plane (3D view only)'}
              aria-label="Toggle clip plane"
              aria-pressed={isClipPlaneOn}
            >
              <Slice size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Resize handle — drag down to grow canvas past flex size, drag up to shrink back.
          Once it reaches the row's natural flex size, further upward dragging has no effect,
          since min-height never shrinks a flex item below what it'd render at anyway. See handleCanvasResizeStart*/}
      <div
        data-testid="nii-canvas-resize-handle"
        className={`h-1.5 pointer-coarse:h-3 w-full shrink-0 cursor-row-resize rounded-sm select-none touch-none ${isRowResizing ? 'bg-primary' : 'bg-border hover:bg-secondary'}`}
        title="Drag to resize the canvas"
        onMouseDown={handleResizeStart}
        onTouchStart={handleResizeStart}
      />
    </div>
  );
};
