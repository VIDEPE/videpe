import { useRef, useEffect, useState } from 'react';
import { Niivue } from '@niivue/niivue';

export const NiiViewer = ({ imageUrl }) => {
  const canvas = useRef();
  const nvRef = useRef();
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!imageUrl) return;

    async function setupAndLoad() {
      try {
        const nv = new Niivue();
        nv.attachToCanvas(canvas.current);
        await nv.loadVolumes([{ url: imageUrl }]);
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
  }, [imageUrl]);

  return (
    <div style={{ width: '100%', height: '480px', position: 'relative' }}>
      {loading && !error && (
        <p className="text-foreground">Loading image...</p>
      )}
      {error && (
        <p className="text-red-500">{error}</p>
      )}
      <canvas ref={canvas} style={{ width: '100%', height: '100%' }} />
    </div>
  );
};
