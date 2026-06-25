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
  connectomeLayer = null, // intracranial electrode connectome layer — kept separate from `layers`
  // (see the connectome-sync effect below) so a voltage-driven data refresh never resets
  // every other layer's settings.
  onViewReady,
  onNiiNvReady,
  isFullscreen = false,
}) => {
  // layerSettings is an array with one settings object per loaded layer (image volume,
  // connectome, or other mesh).
  const [layerSettings, setLayerSettings] = useState(() => getInitialLayerSettings(layers));
  // orderedLayers mirrors the `layers` prop (plus the merged-in connectomeLayer, if any)
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
  const connectomeMeshRef = useRef(null); // the single intracranial-electrode connectome mesh currently in the scene, or null
  const lastConnectomeLayerRef = useRef(null); // the connectomeLayer the mesh above was built from — guards against rebuilding on unrelated re-renders
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  const [activeSliceType, setActiveSliceType] = useState(SLICE_TYPE.MULTIPLANAR);
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
        const mesh = connectomeMeshRef.current;
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

    // Load only the new layers into the existing NiiVue instance and reapply all layer settings
    await syncVolumesAndApplySettings(nvRef.current, allLayers, allLayerSettings);
    // updateGLVolume schedules a GL redraw but returns before it paints — wait one frame before clearing the spinner
    requestAnimationFrame(() => setIsLoading(false));
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
        if (connectomeMeshRef.current) {
          nv.removeMesh(connectomeMeshRef.current);
          connectomeMeshRef.current = null;
        }
        // Note: PatientView keeps re-deriving connectomeLayer from live EEG state, so this
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
    onNiiNvReady?.();
  }, []);

  // Load and sync volumes whenever the layers prop changes.
  // loadingLayersRef serves two purposes:
  //   1. Guard at the top: same array reference means this exact load is already in flight
  //      (StrictMode double-invoke). Bail out before touching NiiVue so nv.loadVolumes is
  //      never called twice, which would leave nv.volumes in a corrupted empty state.
  //   2. Guard in the async callback: if loadingLayersRef has moved on to a different
  //      layers array by the time the load completes, this load has been superseded and
  //      must not update React state (setIsLoading / onViewReady).
  // connectomeLayer deliberately is NOT a dependency here — it's merged into orderedLayers
  // by the dedicated sync effect below instead, so a voltage-driven connectome refresh never
  // re-triggers this image-loading effect or resets every other layer's settings.
  useEffect(() => {
    if (!layers.length) {
      loadingLayersRef.current = null; // reset so the next non-empty load can proceed
      // Nothing to load on the image side (e.g. a connectome-only scene with no NIfTI
      // files) — without this, isLoading would stay stuck at its initial `true` forever.
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

  // Merges the separately-tracked connectomeLayer prop into orderedLayers/layerSettings by
  // matching its fixed sentinel URL — keeps it in the same draggable ImagingControls list as
  // image volumes without ever touching their settings when only the connectome's own data
  // (nodes/edges/calMax) refreshes (which produces a new connectomeLayer object on every
  // EEG voltage update).
  useEffect(() => {
    setOrderedLayers((prevLayers) => {
      const idx = prevLayers.findIndex((l) => l.url === INTRACRANIAL_CONNECTOME_URL);
      if (!connectomeLayer) {
        if (idx === -1) return prevLayers;
        setLayerSettings((prevSettings) => prevSettings.filter((_, i) => i !== idx));
        return prevLayers.filter((_, i) => i !== idx);
      }
      if (idx === -1) {
        setLayerSettings((prevSettings) => [
          ...prevSettings,
          ...getInitialLayerSettings([connectomeLayer], prevSettings.length),
        ]);
        return [...prevLayers, connectomeLayer];
      }
      if (prevLayers[idx] === connectomeLayer) return prevLayers; // no change
      const next = prevLayers.slice();
      next[idx] = connectomeLayer;
      return next;
    });
  }, [connectomeLayer]);

  // Builds/rebuilds/removes the actual NiiVue connectome mesh whenever connectomeLayer's
  // data changes. Rebuilt wholesale on every change rather than mutated in place — mirrors
  // how EegTopoViewer rebuilds its own mesh on every topoTimepoint click.
  useEffect(() => {
    const nv = nvRef.current; // guard clause — nothing to do before NiiVue has attached to a canvas
    if (!nv) return;

    if (!connectomeLayer) {
      // No connectome to show anymore (e.g. positions/EEG cleared) — tear down the existing mesh, if any.
      if (connectomeMeshRef.current) {
        nv.removeMesh(connectomeMeshRef.current); // drop it from the 3D scene
        connectomeMeshRef.current = null; // nothing left to track
        lastConnectomeLayerRef.current = null; // so a future re-add isn't mistaken for "unchanged"
        nv.updateGLVolume(); // redraw without it
      }
      return;
    }

    if (connectomeLayer === lastConnectomeLayerRef.current) return; // unrelated re-render (e.g. another layer's settings changed)
    lastConnectomeLayerRef.current = connectomeLayer; // remember what this rebuild is based on

    if (connectomeMeshRef.current) nv.removeMesh(connectomeMeshRef.current); // drop the stale mesh before building its replacement

    // Build the new connectome mesh in memory — not yet added to the scene.
    const mesh = nv.loadConnectomeAsMesh({
      name: connectomeLayer.name,
      nodeColormap: EEG_NODE_POS_KEY,
      nodeColormapNegative: EEG_NODE_NEG_KEY,
      nodeMinColor: 0,
      nodeMaxColor: connectomeLayer.calMax,
      nodeScale: 4,
      edgeColormap: EEG_NODE_POS_KEY,
      edgeColormapNegative: EEG_NODE_NEG_KEY,
      edgeMin: 0,
      edgeMax: connectomeLayer.calMax,
      edgeScale: 0.5,
      showLegend: false,
      colorbarVisible: false, // suppresses the node+edge colorbar entries NiiVue would otherwise add for a populated `edges` array
      nodes: connectomeLayer.nodes,
      edges: connectomeLayer.edges,
    });

    // Apply whatever opacity/visibility is already set for this layer (preserved across
    // data refreshes by the sync effect above); fall back to the same default that effect
    // would compute if it hasn't run yet this render pass (e.g. the connectome's first
    // appearance, before orderedLayers/layerSettings have caught up).
    const existingIndex = orderedLayers.findIndex((l) => l.url === INTRACRANIAL_CONNECTOME_URL); // its current position in the card list, if it has one yet
    const settings =
      layerSettings[existingIndex] ?? // its existing settings, preserved across this rebuild
      getInitialLayerSettings([connectomeLayer], orderedLayers.length)[0]; // or computed fresh on first appearance
    mesh.opacity = settings.visible ? settings.opacity : 0; // 0 opacity is how a hidden mesh is represented, same convention as image volumes

    nv.addMesh(mesh); // actually add it to the 3D scene
    connectomeMeshRef.current = mesh; // track it so the next change/removal can find it
    nv.updateGLVolume(); // redraw with the new mesh visible
  }, [connectomeLayer, orderedLayers, layerSettings, nvRef]);

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
            {/* Viewer controls with Ax, Co, Sa, MP and 3D buttons */}
            {sliceTypeOptions.map(({ sliceType, label, buttonLabel }) => (
              <button
                key={sliceType}
                type="button"
                className="button size-xs"
                onClick={() => handleSliceTypeChange(sliceType)}
                title={`${label} view`}
                aria-label={`${label} view`}
                aria-pressed={activeSliceType === sliceType}
              >
                {buttonLabel}
              </button>
            ))}
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
