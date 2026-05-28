import { useRef, useEffect, useState } from 'react';
import { Niivue, SHOW_RENDER, MULTIPLANAR_TYPE } from '@niivue/niivue';
import { move } from '@dnd-kit/helpers';
import { getInitialLayerSettings } from './NiiViewer.utils';
import { ImagingControls } from './ImagingControls';

// Loads volumes into an existing NiiVue instance and applies all layer settings.
// Extracted to avoid duplication between initial load and drag-to-reorder reload.
async function loadVolumesAndApplySettings(nv, volumes, layerSettings) {
  await nv.loadVolumes(volumes);
  layerSettings.forEach((layerSetting, index) => {
    nv.setColormap(nv.volumes[index].id, layerSetting.colormap);
    nv.setOpacity(index, layerSetting.visible ? layerSetting.opacity : 0);
    if (layerSetting.invert) {
      nv.volumes[index].colormapInvert = true;
    }
  });
  nv.opts.isColorbar = layerSettings.some((layerSetting) => layerSetting.showColorbar);
  nv.updateGLVolume();
}

export const NiiViewer = ({ volumes = [], onReady }) => {
  // layerSettings is an array with one settings object per loaded layer (volume or mesh)
  const [layerSettings, setLayerSettings] = useState(() => getInitialLayerSettings(volumes));
  // orderedVolumes mirrors volumes but can be rearranged by drag-to-reorder
  const [orderedVolumes, setOrderedVolumes] = useState(volumes);

  const canvas = useRef();
  const nvRef = useRef();
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const updateSetting = (layerIndex, key, value) => {
    const nextLayerSettings = layerSettings.map((layerSetting, index) =>
      index === layerIndex ? { ...layerSetting, [key]: value } : layerSetting
    );
    setLayerSettings(nextLayerSettings);

    if (nvRef.current) {
      const nv = nvRef.current;
      const nvVolume = nv.volumes.find((nvVol) => nvVol.url === orderedVolumes[layerIndex].url);
      if (!nvVolume) return;
      const nvIndex = nv.volumes.indexOf(nvVolume);

      if (key === 'visible') {
        nv.setOpacity(nvIndex, value ? nextLayerSettings[layerIndex].opacity : 0);
      } else if (key === 'opacity') {
        if (nextLayerSettings[layerIndex].visible) nv.setOpacity(nvIndex, value);
      } else if (key === 'colormap') {
        nv.setColormap(nvVolume.id, value);
      } else if (key === 'invert') {
        nvVolume.colormapInvert = value;
        nv.updateGLVolume();
      } else if (key === 'showColorbar') {
        nv.opts.isColorbar = nextLayerSettings.some((layerSetting) => layerSetting.showColorbar);
        nv.updateGLVolume();
      }
    }
  };

  const handleReorder = async (event) => {
    if (!nvRef.current) return;

    const urls = orderedVolumes.map((volume) => volume.url);
    const newUrls = move(urls, event);
    if (newUrls === urls) return; // no change (canceled or same position)

    const newOrderedVolumes = newUrls.map((url) => orderedVolumes.find((volume) => volume.url === url));
    const newLayerSettings = newUrls.map((url) => {
      const oldIndex = orderedVolumes.findIndex((volume) => volume.url === url);
      return layerSettings[oldIndex];
    });

    setOrderedVolumes(newOrderedVolumes);
    setLayerSettings(newLayerSettings);

    setLoading(true);
    try {
      await loadVolumesAndApplySettings(nvRef.current, newOrderedVolumes, newLayerSettings);
    } catch (reorderError) {
      setError(`Failed to reload after reorder: ${reorderError.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Guard clause — if no volumes provided, don't even try to initialize NiiVue
    if (!volumes.length) return;

    const initialLayerSettings = getInitialLayerSettings(volumes);
    setLayerSettings(initialLayerSettings);
    setOrderedVolumes(volumes); // Reset order whenever the volumes prop changes
    setLoading(true);
    setError(null);

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

        nvRef.current = nv;
        setLoading(false);
        onReady?.();
      } catch (loadError) {
        setError(`Failed to load image: ${loadError.message}`);
        setLoading(false);
      }
    }

    setupAndLoad();

    return () => {
      nvRef.current = null;
    };
  }, [volumes]);

  return (
    <div className="">
      {/* Controls panel */}
      <ImagingControls
        volumes={orderedVolumes}
        layerSettings={layerSettings}
        onSettingChange={updateSetting}
        onReorder={handleReorder}
      />
      {/* NiiVue Canvas */}
      <div style={{ width: '100%', height: '480px', position: 'relative' }}>
        {loading && !error && <p className="text-foreground">Loading image...</p>}
        {error && <p className="text-red-500">{error}</p>}
        <canvas ref={canvas} style={{ width: '100%', height: '100%' }} />
      </div>
    </div>
  );
};
