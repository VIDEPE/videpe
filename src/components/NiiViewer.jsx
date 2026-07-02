import { useRef, useEffect, useState, useCallback } from 'react';
import { cn } from '../utils/utils';
import { SHOW_RENDER, MULTIPLANAR_TYPE, SLICE_TYPE } from '@niivue/niivue';
import { move } from '@dnd-kit/helpers';
import toast from 'react-hot-toast';

const NII_LOADING_TOAST_ID = 'nii-viewer-loading'; // fixed id so loading/success toasts update in place rather than stacking
const MIN_CANVAS_HEIGHT = 350; // px — matches the canvas row's original fixed floor
import {
  getInitialLayerSettings,
  filesToLayers,
  INTRACRANIAL_CONNECTOME_URL,
} from './NiiViewer.utils';
import { ImagingControls } from './ImagingControls';
import { FileDropZone } from '../components/FileDropZone';
import {
  EEG_NODE_POS_KEY,
  EEG_NODE_POS,
  EEG_NODE_NEG_KEY,
  EEG_NODE_NEG,
} from '@/utils/eegColormaps';

// Loads image volumes into an existing NiiVue instance and applies all layer settings.
// layers/layerSettings are the FULL desired lists (existing + new) — any volumes already
// present in nv.volumes are left in place and only the new ones are loaded.
// Reordering uses setVolume instead, since that doesn't need a re-fetch.
// Connectome (and other mesh) layers never flow through here — see the dedicated
// connectome-sync/build effects below, which track that layer separately so a
// voltage-driven data refresh never resets every other layer's settings.
export async function syncVolumesAndApplySettings(nv, layers, layerSettings) {
  const indexOffset = nv.volumes.length; // Volumes before this index are already loaded into nv.
  const newLayers = layers.slice(indexOffset);
  if (newLayers.length > 0) {
    if (indexOffset === 0) {
      await nv.loadVolumes(newLayers);
    } else {
      await nv.addVolumesFromUrl(newLayers);
    }
  }

  // nv.volumes now matches layers 1:1, so settings can be applied by index directly.
  layerSettings.forEach((layerSetting, index) => {
    const nvVolume = nv.volumes[index];
    nv.setColormap(nvVolume.id, layerSetting.colormap);
    nv.setOpacity(index, layerSetting.visible ? layerSetting.opacity : 0);
    if (layerSetting.invert) nvVolume.colormapInvert = true;
    nvVolume.colorbarVisible = layerSetting.showColorbar;
  });
  nv.opts.isColorbar = layerSettings.some((layerSetting) => layerSetting.showColorbar);
  // GL redraw to apply settings
  nv.updateGLVolume();
}

export const NiiViewer = ({
  nvRef,
  layers = [], // image volumes/meshes loaded from files — e.g. .nii/.mgz/.gii/.ply/.obj drops
  intracranialLayer = null, // intracranial electrode connectome layer — kept separate from `layers`
  // (see the connectome-sync effect below) so a voltage-driven data refresh never resets
  // every other layer's settings.
  onViewReady,
  onNiiNvReady,
  isFullscreen = false,
}) => {
  // layerSettings is an array with one settings object per loaded layer (image volume,
  // connectome, or other mesh).
  const [layerSettings, setLayerSettings] = useState(() => getInitialLayerSettings(layers));
  // orderedLayers mirrors the `layers` prop (plus the merged-in intracranialLayer, if any)
  // but can be rearranged by drag-to-reorder.
  const [orderedLayers, setOrderedLayers] = useState(layers);
  const [isLoading, setIsLoading] = useState(true);

  // Show a loading toast while volumes load, then update to success — self-contained
  // so NiiViewer reports its own status regardless of where it's embedded.
  useEffect(() => {
    if (isLoading) {
      toast.loading('Loading imaging data…', { id: NII_LOADING_TOAST_ID });
    } else {
      toast.success('Imaging data loaded!', { id: NII_LOADING_TOAST_ID });
    }
  }, [isLoading]);

  // Dismiss the toast if the viewer unmounts mid-load (e.g. resetting the imaging panel)
  useEffect(() => {
    return () => toast.dismiss(NII_LOADING_TOAST_ID);
  }, []);

  const canvas = useRef();
  const canvasContainerRef = useRef();
  const canvasRowRef = useRef(); // the canvas + slice-type sidebar row — its min-height is dragged by the resize handle below it
  const canvasReadyRef = useRef(false); // guards attachToCanvas so StrictMode's double-invoke doesn't reinitialise the GL context
  const loadingLayersRef = useRef(null); // reference to the layers array currently being loaded — prevents StrictMode's double-invoke from firing nv.loadVolumes twice
  const opacityRafRef = useRef(null); // pending rAF id for opacity updates — cancelled on each new drag event so only the latest value redraws
  const canvasSizeTimeoutRef = useRef(null); // pending debounce timeout for canvas size updates
  const intracranialMeshRef = useRef(null); // the single intracranial-electrode connectome mesh currently in the scene, or null
  const lastIntracranialLayerRef = useRef(null); // the intracranialLayer the mesh above was built from — guards against rebuilding on unrelated re-renders
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  const [activeSliceType, setActiveSliceType] = useState(SLICE_TYPE.MULTIPLANAR);
  // 2D slice views have no volume data to cut through without an actual image volume —
  // a connectome-only scene (e.g. intracranial electrodes with no MRI loaded) always
  // renders as 3D regardless of opts.sliceType, per NiiVue's drawSceneCore. Derived from
  // orderedLayers (not the `layers` prop) since a volume can also arrive via this
  // component's own "Drop additional files" zone, which never touches `layers`.
  const hasImageVolumes = orderedLayers.some((l) => l.kind !== 'connectome');
  const sliceTypeOptions = [
    { sliceType: SLICE_TYPE.AXIAL, label: 'Axial', buttonLabel: 'Ax' },
    { sliceType: SLICE_TYPE.CORONAL, label: 'Coronal', buttonLabel: 'Co' },
    { sliceType: SLICE_TYPE.SAGITTAL, label: 'Sagittal', buttonLabel: 'Sa' },
    { sliceType: SLICE_TYPE.MULTIPLANAR, label: 'Multiplanar', buttonLabel: 'MP' },
    { sliceType: SLICE_TYPE.RENDER, label: '3D', buttonLabel: '3D' },
  ];

  const handleSliceTypeChange = (sliceType) => {
    setActiveSliceType(sliceType);
    nvRef.current?.setSliceType(sliceType);
  };

  // Keep the UI in sync with what NiiVue actually draws — force the 3D view (and grey
  // out the others below) whenever there's no image volume to show 2D slices of. Only
  // acts on the "no volumes" side deliberately: it must not also fire a redundant
  // nv.setSliceType() the moment a volume (re)appears — that call previously landed
  // concurrently with an in-flight nv.loadVolumes()/addVolumesFromUrl() triggered by this
  // component's own "Drop additional files" handler, which could leave the load hanging.
  // The mount effect above already syncs nv's starting slice type once; ongoing
  // user-driven changes go through handleSliceTypeChange directly.
  useEffect(() => {
    if (hasImageVolumes) return;
    setActiveSliceType(SLICE_TYPE.RENDER);
    nvRef.current?.setSliceType(SLICE_TYPE.RENDER);
  }, [hasImageVolumes, nvRef]);

  const handleSettingChange = useCallback(
    (layerIndex, key, value) => {
      const nextLayerSettings = layerSettings.map((layerSetting, index) =>
        index === layerIndex ? { ...layerSetting, [key]: value } : layerSetting
      );
      setLayerSettings(nextLayerSettings);

      if (!nvRef.current) return;
      const nv = nvRef.current;
      const layer = orderedLayers[layerIndex];
      if (!layer) return;

      // Connectome layers aren't in nv.volumes at all (they're a mesh, built/tracked
      // separately above) — update the mesh object directly instead of going through
      // nv.setOpacity/setColormap, which index into nv.volumes.
      if (layer.kind === 'connectome') {
        const mesh = intracranialMeshRef.current;
        if (!mesh) return;
        if (key === 'visible') {
          mesh.opacity = value ? nextLayerSettings[layerIndex].opacity : 0;
          nv.updateGLVolume();
        } else if (key === 'opacity') {
          if (nextLayerSettings[layerIndex].visible) {
            mesh.opacity = value;
            nv.updateGLVolume();
          }
        }
        // colormap/invert/showColorbar: ImagingControls doesn't render those controls for
        // this kind, so there's nothing to apply here.
        return;
      }

      // Map layerIndex (position in the combined orderedLayers list) to its index in
      // nv.volumes by counting only the preceding image-kind entries — the connectome
      // layer, if present, occupies a slot in orderedLayers but not in nv.volumes.
      const nvIndex = orderedLayers
        .slice(0, layerIndex)
        .filter((l) => l.kind !== 'connectome').length;
      const nvVolume = nv.volumes[nvIndex];
      if (!nvVolume) return;

      if (key === 'visible') {
        nv.setOpacity(nvIndex, value ? nextLayerSettings[layerIndex].opacity : 0);
      } else if (key === 'opacity') {
        // Throttle to one GL redraw per frame — cancels any pending rAF so only the latest drag value redraws
        if (nextLayerSettings[layerIndex].visible) {
          if (opacityRafRef.current) cancelAnimationFrame(opacityRafRef.current);
          opacityRafRef.current = requestAnimationFrame(() => nv.setOpacity(nvIndex, value));
        }
      } else if (key === 'colormap') {
        nv.setColormap(nvVolume.id, value);
      } else if (key === 'invert') {
        nvVolume.colormapInvert = value;
        nv.updateGLVolume();
      } else if (key === 'showColorbar') {
        nvVolume.colorbarVisible = value;
        nv.opts.isColorbar = nextLayerSettings.some((layerSetting) => layerSetting.showColorbar);
        nv.updateGLVolume();
      }
    },
    [layerSettings, orderedLayers]
  );

  // Handler for when imaging files are dropped or selected. It reads the files as ArrayBuffers and prepares them for visualization, updating state accordingly.
  const handleNiiFiles = async (files) => {
    if (!nvRef.current) return; // Guard clause — if NiiVue isn't initialized yet, there's nothing to append to

    // show loading spinner
    setIsLoading(true);
    // Convert the FileList to an array of layer objects with { url, name, type, subtype }
    const newLayers = filesToLayers(files);
    const allLayers = [...orderedLayers, ...newLayers];

    // startIndex tells getInitialLayerSettings these layers aren't the first ones overall,
    // so the first new layer gets 0.6 opacity instead of being treated as layer 0
    const newLayerSettings = getInitialLayerSettings(newLayers, orderedLayers.length);
    const allLayerSettings = [...layerSettings, ...newLayerSettings];
    setOrderedLayers(allLayers);
    setLayerSettings(allLayerSettings);

    // syncVolumesAndApplySettings only knows about image volumes (nv.volumes) — strip out
    // the connectome layer, if present, before handing the list off. Otherwise it tries to
    // nv.loadVolumes() the connectome's sentinel url as if it were a real image file, which
    // never resolves, and (with no try/catch) leaves the spinner stuck forever.
    const imageLayers = allLayers.filter((l) => l.kind !== 'connectome');
    const imageLayerSettings = allLayerSettings.filter(
      (_, i) => allLayers[i].kind !== 'connectome'
    );

    try {
      // Load only the new layers into the existing NiiVue instance and reapply all layer settings
      await syncVolumesAndApplySettings(nvRef.current, imageLayers, imageLayerSettings);
    } catch (loadError) {
      toast.error(`Failed to load image: ${loadError.message}`);
    } finally {
      // updateGLVolume schedules a GL redraw but returns before it paints — wait one frame before clearing the spinner
      requestAnimationFrame(() => setIsLoading(false));
    }
  };

  // Track the canvas container's dimensions so the layout effect can react to resizes
  // (browser window resize, split-pane drag, etc.). Disconnects on unmount to avoid leaks.
  useEffect(() => {
    const canvasContainer = canvasContainerRef.current;
    if (!canvasContainer) return;
    const canvasSizeObserver = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      // Debounce — fires on every frame during the SplitPane resize/maximize transition;
      // wait for it to settle before triggering a multiplanar layout switch
      if (canvasSizeTimeoutRef.current) clearTimeout(canvasSizeTimeoutRef.current);
      canvasSizeTimeoutRef.current = setTimeout(() => {
        setCanvasSize({ width, height });
      }, 150);
    });
    canvasSizeObserver.observe(canvasContainer); // Start observing the canvas container for size changes
    return () => {
      canvasSizeObserver.disconnect(); // Clean up the observer on unmount
      if (canvasSizeTimeoutRef.current) clearTimeout(canvasSizeTimeoutRef.current); // Clear any pending debounce timeout on unmount
    };
  }, []);

  // Switch between AUTO (panels in a row) and GRID (2×2) based on aspect ratio.
  // AUTO is used when the canvas is at least twice as wide as it is tall.
  // height > 0 guards against the initial {0,0} state incorrectly triggering AUTO.
  useEffect(() => {
    if (!nvRef.current) return;
    const isWide = canvasSize.height > 0 && canvasSize.width >= 1.75 * canvasSize.height;
    nvRef.current.setMultiplanarLayout(isWide ? MULTIPLANAR_TYPE.AUTO : MULTIPLANAR_TYPE.GRID);
  }, [canvasSize]);

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

      // A connectome layer has no slot in nv.volumes at all, and reordering a mesh
      // relative to volumes has no rendering effect anyway (3D meshes vs. 2D slice
      // compositing have no shared z-order) — only move the NVImage when an actual
      // image volume was dragged.
      const movedLayer = orderedLayers[event.operation.source.initialIndex];
      if (movedLayer?.kind !== 'connectome') {
        const imagesBefore = orderedLayers.filter((l) => l.kind !== 'connectome');
        const imagesAfter = newOrderedLayers.filter((l) => l.kind !== 'connectome');
        const fromIndex = imagesBefore.indexOf(movedLayer);
        const toIndex = imagesAfter.indexOf(movedLayer);
        setIsLoading(true);
        nvRef.current.setVolume(nvRef.current.volumes[fromIndex], toIndex);
        nvRef.current.updateGLVolume();
        // updateGLVolume schedules a GL redraw but returns before it paints — wait one frame before clearing the spinner
        requestAnimationFrame(() => setIsLoading(false));
      }
    },
    [orderedLayers, layerSettings]
  );

  const handleDeleteLayer = useCallback(
    (index) => {
      if (!nvRef.current) return; // Guard clause — if NiiVue isn't initialized yet, we can't delete
      const nv = nvRef.current;
      const layer = orderedLayers[index];

      if (layer?.kind === 'connectome') {
        if (intracranialMeshRef.current) {
          nv.removeMesh(intracranialMeshRef.current);
          intracranialMeshRef.current = null;
        }
        // Note: PatientView keeps re-deriving intracranialLayer from live EEG state, so this
        // card reappears on the next voltage update unless that upstream state also clears —
        // acceptable for now, not a locked-in requirement to support a persistent dismissal.
      } else {
        const nvIndex = orderedLayers.slice(0, index).filter((l) => l.kind !== 'connectome').length;
        nv.removeVolumeByIndex(nvIndex);
      }
      setOrderedLayers(orderedLayers.filter((_, i) => i !== index));
      setLayerSettings(layerSettings.filter((_, i) => i !== index));
    },
    [orderedLayers, layerSettings]
  );

  // Drag the handle below the canvas to raise its min-height past whatever the flex layout
  // would otherwise give it — pushing the rest of the panel into scroll instead of letting a
  // long volume list keep squeezing the canvas down to MIN_CANVAS_HEIGHT. Dragging back up
  // lowers that floor; once it drops below what the flex layout already provides, the row
  // simply renders at its natural (auto) size and stops shrinking any further.
  // Writes directly to the DOM (like SplitPane's divider) instead of React state, since this
  // component already re-renders the canvas/controls tree on every drag-frame would be wasteful.
  const handleCanvasResizeStart = useCallback((e) => {
    e.preventDefault();
    const row = canvasRowRef.current;
    if (!row) return;
    const startY = e.clientY;
    const startHeight = row.getBoundingClientRect().height;

    const onMove = (moveEvent) => {
      const nextHeight = Math.max(MIN_CANVAS_HEIGHT, startHeight + (moveEvent.clientY - startY));
      row.style.minHeight = `${nextHeight}px`;
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  // Attach the NiiVue instance to the canvas once when the viewer mounts.
  // Separated from volume loading so that React StrictMode's double-invoke of effects
  // (which runs every effect twice in development) does not call attachToCanvas twice.
  // A second attachToCanvas call reinitialises the WebGL context, wiping all loaded
  // volumes and colormaps — causing them to turn grey. The canvasReadyRef guard ensures
  // the setup only runs once even when StrictMode re-invokes the effect.
  useEffect(() => {
    if (!nvRef.current || canvasReadyRef.current) return;
    canvasReadyRef.current = true;
    const nv = nvRef.current;
    nv.opts.multiplanarShowRender = SHOW_RENDER.ALWAYS;
    nv.setMultiplanarLayout(MULTIPLANAR_TYPE.GRID);
    nv.opts.multiplanarEqualSize = false;
    nv.setCornerOrientationText(false);
    // Registered here (rather than where the connectome mesh is built) so they exist
    // before the connectome-build effect can ever run on this instance.
    nv.addColormap(EEG_NODE_POS_KEY, EEG_NODE_POS);
    nv.addColormap(EEG_NODE_NEG_KEY, EEG_NODE_NEG);
    nv.attachToCanvas(canvas.current);
    // Sync nv's slice type to this fresh mount's starting state, rather than leaving it
    // at whatever it was last set to on this long-lived instance (e.g. RENDER, forced
    // during an earlier connectome-only phase) — which would otherwise silently diverge
    // from React's own (different) default of MULTIPLANAR. Read once, at mount, only —
    // later additions are handled by the hasImageVolumes effect below (false side only),
    // so this never fires again concurrently with an in-flight volume load.
    nv.setSliceType(hasImageVolumes ? activeSliceType : SLICE_TYPE.RENDER);
    onNiiNvReady?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // nv is a single long-lived instance owned by the parent, reused across this component's
  // mount/unmount cycles (e.g. the Neuroimaging pane unmounts to a drop-zone placeholder
  // when there's nothing to show, then remounts later). Without this, volumes/meshes loaded
  // before an unmount stay in nv and silently reappear fully rendered on the next mount
  // (attachToCanvas re-uploads whatever's still in nv.volumes/nv.meshes) — with no matching
  // card in ImagingControls, since this component's own state resets on every fresh mount.
  useEffect(() => {
    return () => {
      const nv = nvRef.current;
      if (!nv) return;
      while (nv.volumes.length > 0) nv.removeVolumeByIndex(0);
      (nv.meshes ?? []).slice().forEach((mesh) => nv.removeMesh(mesh));
    };
  }, [nvRef]);

  // Load and sync volumes whenever the layers prop changes.
  // loadingLayersRef serves two purposes:
  //   1. Guard at the top: same array reference means this exact load is already in flight
  //      (StrictMode double-invoke). Bail out before touching NiiVue so nv.loadVolumes is
  //      never called twice, which would leave nv.volumes in a corrupted empty state.
  //   2. Guard in the async callback: if loadingLayersRef has moved on to a different
  //      layers array by the time the load completes, this load has been superseded and
  //      must not update React state (setIsLoading / onViewReady).
  // intracranialLayer deliberately is NOT a dependency here — it's merged into orderedLayers
  // by the dedicated sync effect below instead, so a voltage-driven connectome refresh never
  // re-triggers this image-loading effect or resets every other layer's settings.
  useEffect(() => {
    if (!layers.length) {
      loadingLayersRef.current = null; // reset so the next non-empty load can proceed
      // Nothing to load on the image side (e.g. a connectome-only scene with no NIfTI
      // files, or an imaging-only reset while a connectome keeps this component mounted)
      // — clear any volumes left over from before so stale imaging never lingers behind
      // the electrodes, then stop the spinner (else it'd stay stuck `true` forever).
      const nv = nvRef.current;
      if (nv?.volumes.length) {
        while (nv.volumes.length > 0) nv.removeVolumeByIndex(0);
        nv.updateGLVolume();
      }
      // Drop the now-stale image-kind cards from ImagingControls too — otherwise they
      // keep showing even though the volumes behind them were just removed above. The
      // connectome's own card (if any) is left alone. Each filter is self-contained (a
      // layer's own kind, a settings entry's own url) rather than cross-referencing the
      // other array by position — that stays correct regardless of what order this effect
      // and the intracranialLayer sync effect happen to run in within the same commit.
      setOrderedLayers((prev) => prev.filter((l) => l.kind === 'connectome'));
      setLayerSettings((prev) => prev.filter((s) => s.url === INTRACRANIAL_CONNECTOME_URL));
      setIsLoading(false);
      return;
    }
    if (loadingLayersRef.current === layers) return; // StrictMode: already loading these layers
    loadingLayersRef.current = layers;

    const initialLayerSettings = getInitialLayerSettings(layers);
    setLayerSettings(initialLayerSettings);
    setOrderedLayers(layers);
    setIsLoading(true);

    const loadAndSync = async () => {
      try {
        await syncVolumesAndApplySettings(nvRef.current, layers, initialLayerSettings);
        if (loadingLayersRef.current !== layers) return; // superseded by a newer load
        setIsLoading(false);
        onViewReady?.();
      } catch (loadError) {
        if (loadingLayersRef.current !== layers) return;
        toast.error(`Failed to load image: ${loadError.message}`);
        setIsLoading(false);
      }
    };

    loadAndSync();
  }, [layers]);

  // Merges the separately-tracked intracranialLayer prop into orderedLayers/layerSettings by
  // matching its fixed sentinel URL — keeps it in the same draggable ImagingControls list as
  // image volumes without ever touching their settings when only the connectome's own data
  // (nodes/edges/calMax) refreshes (which produces a new intracranialLayer object on every
  // EEG voltage update).
  // Two independent, self-contained updater-function calls — deliberately not one nested
  // inside the other. setLayerSettings used to be called from inside setOrderedLayers's
  // updater; StrictMode's purity-check double-invocation then fired that nested call twice,
  // silently appending the connectome's settings entry twice while orderedLayers only got it
  // once, permanently misaligning the two arrays (which later crashed handleNiiFiles when
  // adding an image volume). Each updater here instead locates the connectome independently
  // within its own prev array (layerSettings via the url tag getInitialLayerSettings now
  // attaches to every entry) and is idempotent on its own: re-running it against its own
  // already-updated result (exactly what happens on a double-invoke, or when another effect's
  // update is processed first in the same commit) finds the entry already in place and
  // returns prev unchanged, rather than appending again.
  useEffect(() => {
    setOrderedLayers((prevLayers) => {
      const idx = prevLayers.findIndex((l) => l.url === INTRACRANIAL_CONNECTOME_URL);
      if (!intracranialLayer) {
        if (idx === -1) return prevLayers;
        return prevLayers.filter((_, i) => i !== idx);
      }
      if (idx === -1) return [...prevLayers, intracranialLayer];
      if (prevLayers[idx] === intracranialLayer) return prevLayers; // no change
      const next = prevLayers.slice();
      next[idx] = intracranialLayer;
      return next;
    });
    setLayerSettings((prevSettings) => {
      const idx = prevSettings.findIndex((s) => s.url === INTRACRANIAL_CONNECTOME_URL);
      if (!intracranialLayer)
        return idx === -1 ? prevSettings : prevSettings.filter((_, i) => i !== idx);
      if (idx !== -1) return prevSettings; // already has an entry — a data-only refresh never touches settings
      return [
        ...prevSettings,
        ...getInitialLayerSettings([intracranialLayer], prevSettings.length),
      ];
    });
  }, [intracranialLayer]);

  // Builds/rebuilds/removes the actual NiiVue connectome mesh whenever intracranialLayer's
  // data changes. Rebuilt wholesale on every change rather than mutated in place — mirrors
  // how EegTopoViewer rebuilds its own mesh on every topoTimepoint click.
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
      getInitialLayerSettings([intracranialLayer], orderedLayers.length)[0]; // or computed fresh on first appearance
    mesh.opacity = settings.visible ? settings.opacity : 0; // 0 opacity is how a hidden mesh is represented, same convention as image volumes

    nv.addMesh(mesh); // actually add it to the 3D scene
    intracranialMeshRef.current = mesh; // track it so the next change/removal can find it
    nv.updateGLVolume(); // redraw with the new mesh visible
  }, [intracranialLayer, orderedLayers, layerSettings, nvRef]);

  return (
    <div className="h-full flex flex-col pb-3 px-2 gap-2">
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

      {/* The canvas + loading spinner are in a flex item that fills the remaining height, but never shrinks
          below MIN_CANVAS_HEIGHT. If the controls panel above expands past the point where that much height
          remains, the parent scrolls. Dragging the resize handle below raises that floor past whatever the
          flex layout would naturally give it, locking the canvas at a taller size instead of letting a long
          volume list keep squeezing it down — see handleCanvasResizeStart. */}
      <div
        ref={canvasRowRef}
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
          <canvas ref={canvas} className="absolute inset-0" />
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
            {sliceTypeOptions.map(({ sliceType, label, buttonLabel }) => {
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

      {/* Drag down to grow the canvas row past its natural size (forces the parent pane to scroll);
          drag up to shrink it back — once it reaches the row's natural flex size, further upward
          dragging has no effect, since min-height never shrinks a flex item below what it'd render
          at anyway. See handleCanvasResizeStart. */}
      <div
        data-testid="nii-canvas-resize-handle"
        className="h-1.5 w-full shrink-0 cursor-row-resize rounded-sm select-none bg-border hover:bg-secondary active:bg-primary"
        title="Drag to resize the canvas"
        onMouseDown={handleCanvasResizeStart}
      />
    </div>
  );
};
