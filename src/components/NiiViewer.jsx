import { useRef, useEffect, useState } from 'react';
import { Niivue, SHOW_RENDER, MULTIPLANAR_TYPE } from '@niivue/niivue';
import { getInitialLayerSettings } from './NiiViewer.utils';
import { ImagingControls } from './ImagingControls';

export const NiiViewer = ({ volumes = [], onReady }) => {
  // layerSettings is an array with one settings object per loaded layer (volume or mesh)
  const [layerSettings, setLayerSettings] = useState(() => getInitialLayerSettings(volumes));

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
      const nvVolume = nv.volumes.find((nvVol) => nvVol.url === volumes[layerIndex].url);
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

  useEffect(() => {
    // Guard clause — if no volumes provided, don't even try to initialize NiiVue
    if (!volumes.length) return;

    const initialLayerSettings = getInitialLayerSettings(volumes);
    setLayerSettings(initialLayerSettings);
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
        nv.opts.multiplanarShowRender = SHOW_RENDER.ALWAYS; // Always show volume render with slices
        nv.setMultiplanarLayout(MULTIPLANAR_TYPE.GRID); // Set to grid layout (2x2)
        nv.opts.multiplanarEqualSize = false; // disable equal size tiles to have crosshairs align in views
        nv.setCornerOrientationText(false); // Show orientation text centered (default)

        nv.attachToCanvas(canvas.current);
        await nv.loadVolumes(volumes);

        // Apply colormaps from initialLayerSettings — volumes no longer carry a colormap field
        initialLayerSettings.forEach((layerSetting, index) => {
          nv.setColormap(nv.volumes[index].id, layerSetting.colormap);
        });

        nvRef.current = nv;
        setLoading(false);
        onReady?.();
      } catch (error) {
        setError(`Failed to load image: ${error.message}`);
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
      <ImagingControls
        volumes={volumes}
        layerSettings={layerSettings}
        onSettingChange={updateSetting}
      />
      <div style={{ width: '100%', height: '480px', position: 'relative' }}>
        {loading && !error && <p className="text-foreground">Loading image...</p>}
        {error && <p className="text-red-500">{error}</p>}
        <canvas ref={canvas} style={{ width: '100%', height: '100%' }} />
      </div>
    </div>
  );
};
