import { useRef, useEffect, useState } from 'react';
import { Niivue, SHOW_RENDER } from '@niivue/niivue';
import { getInitialLayerSettings } from './NiiViewer.utils';

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

    setLayerSettings(getInitialLayerSettings(volumes));
    setLoading(true);
    setError(null);

    async function setupAndLoad() {
      try {
        const nv = new Niivue({
          isOrientCube: true,
          dragAndDropEnabled: false,
          show3Dcrosshair: true,
        });
        nv.setSliceType(nv.sliceTypeMultiplanar); // show all 3 planes + 3D render
        nv.opts.multiplanarShowRender = SHOW_RENDER.ALWAYS; // force the 3D render to show

        nv.attachToCanvas(canvas.current);
        await nv.loadVolumes(volumes);
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
      <div className="flex gap-2 justify-end py-2">
        {volumes.map((volume, index) => (
          <button
            key={volume.type}
            type="button"
            onClick={() => updateSetting(index, 'visible', !layerSettings[index].visible)}
            className={'button' + (layerSettings[index].visible ? '' : ' button-toggled')}
            aria-label={`Toggle ${volume.type} visibility`}
          >
            {volume.type ?? `Volume ${index + 1}`}
          </button>
        ))}
      </div>
      <div style={{ width: '100%', height: '480px', position: 'relative' }}>
        {loading && !error && <p className="text-foreground">Loading image...</p>}
        {error && <p className="text-red-500">{error}</p>}
        <canvas ref={canvas} style={{ width: '100%', height: '100%' }} />
      </div>
    </div>
  );
};
