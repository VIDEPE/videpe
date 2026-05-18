import { useRef, useEffect, useState } from 'react';
import { Niivue, SHOW_RENDER } from '@niivue/niivue';
import { cn } from '@/lib/utils';

const getInitialVisibility = (volumes) => {
  const visible = volumes.map(() => true);
  visible[1] = false; // PET starts hidden — MRI (0) and PET (1) are mutually exclusive
  return visible;
};

export const NiiViewer = ({ volumes = [] }) => {
  const [visible, setVisible] = useState(() => getInitialVisibility(volumes));

  const toggleVolume = (index) => {
    // Toggles visibility of the volume at the given index, and if it's MRI or PET, also toggles the other one off

    // Guard clause — if NiiVue hasn't finished loading yet, nvRef.current is null. Calling .setOpacity() on null would crash, so we exit early.
    if (!nvRef.current) return;

    // Create a copy of the visible array using the spread operator.
    // In React you never mutate state directly — you create a new array, modify that, then pass it to setVisible.
    //  If you did visible[index] = !visible[index] directly, React wouldn't detect the change and the UI wouldn't update.
    const newVisible = [...visible];
    //Flip visibility
    newVisible[index] = !newVisible[index];
    nvRef.current.setOpacity(index, newVisible[index] ? 1 : 0);

    // MRI (0) and PET (1) are mutually exclusive — turning one on turns the other off
    const linked_index = index === 0 ? 1 : index === 1 ? 0 : null;
    if (linked_index !== null) {
      newVisible[linked_index] = false;
      nvRef.current.setOpacity(linked_index, 0);
    }

    setVisible(newVisible);
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
      } catch (e) {
        setError(`Failed to load image: ${e.message}`);
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
            aria-label={`Toggle ${volume.label} visibility`}
          >
            {volume.label ?? `Volume ${i + 1}`}
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
