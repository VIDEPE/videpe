import { useRef, useEffect, useState, useCallback } from 'react';
import { Niivue, SHOW_RENDER, MULTIPLANAR_TYPE } from '@niivue/niivue';
import { move } from '@dnd-kit/helpers';
import toast from 'react-hot-toast';
import { getInitialLayerSettings } from './NiiViewer.utils';
import { ImagingControls } from './ImagingControls';

// Loads volumes into an existing NiiVue instance and applies all layer settings.
// Used for initial load; reordering uses setVolume instead to avoid re-fetching.
export async function loadVolumesAndApplySettings(nv, volumes, layerSettings) {
  await nv.loadVolumes(volumes);
  layerSettings.forEach((layerSetting, index) => {
    nv.setColormap(nv.volumes[index].id, layerSetting.colormap);
    nv.setOpacity(index, layerSetting.visible ? layerSetting.opacity : 0);
    if (layerSetting.invert) nv.volumes[index].colormapInvert = true;
    nv.volumes[index].colorbarVisible = layerSetting.showColorbar;
  });
  nv.opts.isColorbar = layerSettings.some((layerSetting) => layerSetting.showColorbar);
  nv.updateGLVolume();
}

export const NiiViewer = ({ volumes = [], onReady, isFullscreen = false }) => {
  // layerSettings is an array with one settings object per loaded layer (volume or mesh)
  const [layerSettings, setLayerSettings] = useState(() => getInitialLayerSettings(volumes));
  // orderedVolumes mirrors volumes but can be rearranged by drag-to-reorder
  const [orderedVolumes, setOrderedVolumes] = useState(volumes);
  const [loading, setLoading] = useState(true);

  const canvas = useRef();
  const nvRef = useRef();
  const opacityRafRef = useRef(null); // pending rAF id for opacity updates — cancelled on each new drag event so only the latest value redraws

  const handleSettingChange = useCallback(
    (layerIndex, key, value) => {
      const nextLayerSettings = layerSettings.map((layerSetting, index) =>
        index === layerIndex ? { ...layerSetting, [key]: value } : layerSetting
      );
      setLayerSettings(nextLayerSettings);

      if (nvRef.current) {
        const nv = nvRef.current;
        // Find the corresponding NVVolume for this layer index — we have to do this by URL since layer order can change
        // Note that due to object referencing changing nVVolume properties updates same properties inside nv for that specific volume
        const nvVolume = nv.volumes.find((nvVol) => nvVol.url === orderedVolumes[layerIndex].url);
        if (!nvVolume) return;
        const nvIndex = nv.volumes.indexOf(nvVolume);

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

  useEffect(() => {
    if (!nvRef.current) return;
    nvRef.current.setMultiplanarLayout(
      isFullscreen ? MULTIPLANAR_TYPE.AUTO : MULTIPLANAR_TYPE.GRID
    );
  }, [isFullscreen]);

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
      setLoading(true);
      nvRef.current.setVolume(nvRef.current.volumes[fromIndex], toIndex);
      nvRef.current.updateGLVolume();
      // updateGLVolume schedules a GL redraw but returns before it paints — wait one frame before clearing the spinner
      requestAnimationFrame(() => setLoading(false));
    },
    [orderedVolumes, layerSettings]
  );

  useEffect(() => {
    // Guard clause — if no volumes provided, don't even try to initialize NiiVue
    if (!volumes.length) return;

    const initialLayerSettings = getInitialLayerSettings(volumes);
    setLayerSettings(initialLayerSettings);
    setOrderedVolumes(volumes); // Reset order whenever the volumes prop changes
    setLoading(true);

    async function setupAndLoad() {
      try {
        const nv = new Niivue({
          isOrientCube: true,
          dragAndDropEnabled: false,
          show3Dcrosshair: true,
        });
        // Always show volume render with slices
        nv.opts.multiplanarShowRender = SHOW_RENDER.ALWAYS;
        nv.setMultiplanarLayout(MULTIPLANAR_TYPE.GRID); // Set to grid layout (2x2)
        nv.opts.multiplanarEqualSize = false; // disable equal size tiles to have crosshairs align in views
        nv.setCornerOrientationText(false); // Show orientation text centered (default)

        nv.attachToCanvas(canvas.current);
        await loadVolumesAndApplySettings(nv, volumes, initialLayerSettings);

        // Store the NiiVue instance in a ref so we can call methods on it later (e.g. to update settings or reorder layers)
        nvRef.current = nv;
        setLoading(false);
        onReady?.();
      } catch (loadError) {
        toast.error(`Failed to load image: ${loadError.message}`);
        setLoading(false);
      }
    }

    setupAndLoad();

    return () => {
      nvRef.current = null;
    };
  }, [volumes]);

  return (
    <div className="h-full flex flex-col pb-3 px-2">
      {/* Controls panel */}
      <ImagingControls
        volumes={orderedVolumes}
        layerSettings={layerSettings}
        onSettingChange={handleSettingChange}
        onReorder={handleReorder}
      />
      {/* NiiVue Canvas — fills remaining height */}
      <div className="relative flex-1 min-h-0 overflow-hidden">
        {loading && (
          <div
            data-testid="loading-spinner"
            className="absolute inset-0 z-10 flex items-center justify-center"
          >
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-border border-t-primary" />
          </div>
        )}
        <canvas ref={canvas} className="absolute inset-0" />
      </div>
    </div>
  );
};
