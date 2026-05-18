import { useRef, useEffect, useState } from 'react';
import { Niivue, SHOW_RENDER } from '@niivue/niivue';
import { getInitialVisibility, applyToggle } from './NiiViewer.utils';

export const NiiViewer = ({ volumes = [] }) => {
  // visible is an array of booleans indicating whether each volume is currently visible
  const [visible, setVisible] = useState(() => getInitialVisibility(volumes));

  const toggleVolume = (index) => {
    const next = applyToggle(volumes, visible, index);
    setVisible(next);
    if (nvRef.current) {
      // Only update opacity for volumes whose visibility changed
      next.forEach((isVisible, i) => {
        if (isVisible !== visible[i]) nvRef.current.setOpacity(i, isVisible ? 1 : 0);
      });
    }
  };

  const canvas = useRef();
  const nvRef = useRef();
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    // Guard clause — if no volumes provided, don't even try to initialize NiiVue
    if (!volumes.length) return;

    async function setupAndLoad() {
      try {
        const nv = new Niivue({
          isOrientCube: true,
          dragAndDropEnabled: true,
          clipToVolumeBox: true,
          clipPlaneEnabled: false,
        });
        nv.setSliceType(nv.sliceTypeMultiplanar); // show all 3 planes + 3D render
        nv.opts.multiplanarShowRender = SHOW_RENDER.ALWAYS;
        nv.attachToCanvas(canvas.current);
        await nv.loadVolumes(volumes);
        // Set initial visibility based on getInitialVisibility
        getInitialVisibility(volumes).forEach((visibility, i) => {
          if (!visibility) nv.setOpacity(i, 0);
        });
        nvRef.current = nv;
        setLoading(false);
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
        {volumes.map((volume, i) => (
          <button
            key={volume.label}
            type="button"
            onClick={() => toggleVolume(i)}
            className={'thin-button' + (visible[i] ? '' : ' thin-button-toggled')}
            aria-label={`Toggle ${volume.type} visibility`}
          >
            {volume.type ?? `Volume ${i + 1}`}
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
