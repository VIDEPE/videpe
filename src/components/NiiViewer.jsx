import { useRef, useEffect, useState, useCallback } from 'react';
import { cn } from '../utils/utils';
import { SHOW_RENDER, MULTIPLANAR_TYPE, SLICE_TYPE } from '@niivue/niivue';
import { move } from '@dnd-kit/helpers';
import toast from 'react-hot-toast';

const NII_LOADING_TOAST_ID = 'nii-viewer-loading'; // fixed id so loading/success toasts update in place rather than stacking
const MIN_CANVAS_HEIGHT = 350; // px — matches the canvas row's original fixed floor
import { getInitialLayerSettings, filesToVolumes } from './NiiViewer.utils';
import { ImagingControls } from './ImagingControls';
import { FileDropZone } from '../components/FileDropZone';

// Loads volumes into an existing NiiVue instance and applies all layer settings.
// volumes/layerSettings are the FULL desired lists (existing + new) — any volumes
// already present in nv.volumes are left in place and only the new ones are loaded.
// Reordering uses setVolume instead, since that doesn't need a re-fetch.
export async function syncVolumesAndApplySettings(nv, volumes, layerSettings) {
  const indexOffset = nv.volumes.length; // Volumes before this index are already loaded into nv.
  const newVolumes = volumes.slice(indexOffset);
  if (newVolumes.length > 0) {
    if (indexOffset === 0) {
      await nv.loadVolumes(newVolumes);
    } else {
      await nv.addVolumesFromUrl(newVolumes);
    }
  }

  // nv.volumes now matches volumes 1:1, so settings can be applied by index directly.
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
  volumes = [],
  onViewReady,
  onNiiNvReady,
  isFullscreen = false,
}) => {
  // layerSettings is an array with one settings object per loaded layer (volume or mesh)
  const [layerSettings, setLayerSettings] = useState(() => getInitialLayerSettings(volumes));
  // orderedVolumes mirrors volumes but can be rearranged by drag-to-reorder
  const [orderedVolumes, setOrderedVolumes] = useState(volumes);
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
  const loadingVolumesRef = useRef(null); // reference to the volumes array currently being loaded — prevents StrictMode's double-invoke from firing nv.loadVolumes twice
  const opacityRafRef = useRef(null); // pending rAF id for opacity updates — cancelled on each new drag event so only the latest value redraws
  const canvasSizeTimeoutRef = useRef(null); // pending debounce timeout for canvas size updates
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

      if (nvRef.current) {
        const nv = nvRef.current;
        // Use the layer index directly — load, reorder, and delete operations update both
        // orderedVolumes and nv.volumes together, so their positions always match.
        const nvVolume = nv.volumes[layerIndex];
        if (!nvVolume) return;
        const nvIndex = layerIndex;

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
      }
    },
    [layerSettings, orderedVolumes]
  );

  // Handler for when imaging files are dropped or selected. It reads the files as ArrayBuffers and prepares them for visualization, updating state accordingly.
  const handleNiiFiles = async (files) => {
    if (!nvRef.current) return; // Guard clause — if NiiVue isn't initialized yet, there's nothing to append to

    // show loading spinner
    setIsLoading(true);
    // Convert the FileList to an array of volume objects with { url, name, type, subtype }
    const newVolumes = filesToVolumes(files);
    const allVolumes = [...orderedVolumes, ...newVolumes];

    // startIndex tells getInitialLayerSettings these volumes aren't the first layers overall,
    // so the first new volume gets 0.6 opacity instead of being treated as layer 0
    const newLayerSettings = getInitialLayerSettings(newVolumes, orderedVolumes.length);
    const allLayerSettings = [...layerSettings, ...newLayerSettings];
    setOrderedVolumes(allVolumes);
    setLayerSettings(allLayerSettings);

    // Load only the new volumes into the existing NiiVue instance and reapply all layer settings
    await syncVolumesAndApplySettings(nvRef.current, allVolumes, allLayerSettings);
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

      const urls = orderedVolumes.map((volume) => volume.url); // Get the current order of URLs
      const newUrls = move(urls, event); // Get the new order of URLs based on the drag event
      if (newUrls === urls) return; // no change (canceled or same position)

      // Reorder the orderedVolumes and layerSettings arrays to match the new order of URLs
      const newOrderedVolumes = newUrls.map((url) =>
        orderedVolumes.find((volume) => volume.url === url)
      );
      const newLayerSettings = newUrls.map((url) => {
        const oldIndex = orderedVolumes.findIndex((volume) => volume.url === url);
        return layerSettings[oldIndex];
      });

      setOrderedVolumes(newOrderedVolumes);
      setLayerSettings(newLayerSettings);

      // Move the already-loaded NVImage to its new position in-memory — no re-fetch needed
      const fromIndex = event.operation.source.initialIndex;
      const toIndex = event.operation.source.index;
      setIsLoading(true);
      nvRef.current.setVolume(nvRef.current.volumes[fromIndex], toIndex);
      nvRef.current.updateGLVolume();
      // updateGLVolume schedules a GL redraw but returns before it paints — wait one frame before clearing the spinner
      requestAnimationFrame(() => setIsLoading(false));
    },
    [orderedVolumes, layerSettings]
  );

  const handleDeleteVolume = useCallback(
    (index) => {
      if (!nvRef.current) return; // Guard clause — if NiiVue isn't initialized yet, we can't delete

      nvRef.current.removeVolumeByIndex(index);
      setOrderedVolumes(orderedVolumes.filter((_, i) => i !== index));
      setLayerSettings(layerSettings.filter((_, i) => i !== index));
    },
    [orderedVolumes, layerSettings]
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
    nv.attachToCanvas(canvas.current);
    onNiiNvReady?.();
  }, []);

  // Load and sync volumes whenever the volumes prop changes.
  // loadingVolumesRef serves two purposes:
  //   1. Guard at the top: same array reference means this exact load is already in flight
  //      (StrictMode double-invoke). Bail out before touching NiiVue so nv.loadVolumes is
  //      never called twice, which would leave nv.volumes in a corrupted empty state.
  //   2. Guard in the async callback: if loadingVolumesRef has moved on to a different
  //      volumes array by the time the load completes, this load has been superseded and
  //      must not update React state (setIsLoading / onViewReady).
  useEffect(() => {
    if (!volumes.length) {
      loadingVolumesRef.current = null; // reset so the next non-empty load can proceed
      return;
    }
    if (loadingVolumesRef.current === volumes) return; // StrictMode: already loading these volumes
    loadingVolumesRef.current = volumes;

    const initialLayerSettings = getInitialLayerSettings(volumes);
    setLayerSettings(initialLayerSettings);
    setOrderedVolumes(volumes);
    setIsLoading(true);

    const loadAndSync = async () => {
      try {
        await syncVolumesAndApplySettings(nvRef.current, volumes, initialLayerSettings);
        if (loadingVolumesRef.current !== volumes) return; // superseded by a newer load
        setIsLoading(false);
        onViewReady?.();
      } catch (loadError) {
        if (loadingVolumesRef.current !== volumes) return;
        toast.error(`Failed to load image: ${loadError.message}`);
        setIsLoading(false);
      }
    };

    loadAndSync();
  }, [volumes]);

  return (
    <div className="h-full flex flex-col pb-3 px-2 gap-2">
      {/* Controls panel, with a compact drop zone below it for loading additional files while the NiiViewer is active */}
      <div className="flex flex-col">
        <ImagingControls
          volumes={orderedVolumes}
          layerSettings={layerSettings}
          onSettingChange={handleSettingChange}
          onReorder={handleReorder}
          onDeleteVolume={handleDeleteVolume}
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
