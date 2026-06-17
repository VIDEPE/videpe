import { useRef, useEffect, useState, useCallback } from 'react';
import { Niivue, NVMesh, NVMeshUtilities, SLICE_TYPE } from '@niivue/niivue';
import { X, Maximize2, Minimize2 } from 'lucide-react';
import { buildEegMesh, averageReference, medianReference } from '@/utils/eegTopography';

export function EegTopoViewer({ electrodes, matched, voltages, totalChannels, onClose }) {
  const canvasRef = useRef(null);
  const nvRef = useRef(null);
  const [useMedian, setUseMedian] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [position, setPosition] = useState({ x: 80, y: 80 });
  const dragOffset = useRef(null);

  // Initialise NiiVue once on mount
  useEffect(() => {
    const nv = new Niivue();
    nv.attachToCanvas(canvasRef.current);
    nv.setSliceType(SLICE_TYPE.RENDER);
    nvRef.current = nv;
    return () => {
      nvRef.current = null;
    };
  }, []);

  // Rebuild and reload the mesh whenever electrodes, matched channels, voltages, or
  // reference mode change. Clears any previously loaded mesh first.
  useEffect(() => {
    const nv = nvRef.current;
    if (!nv || !electrodes?.length || !voltages?.length) return;

    const refVoltages = useMedian ? medianReference(voltages) : averageReference(voltages);

    const { vertices, indices, scalars } = buildEegMesh(electrodes, matched, refVoltages);
    const buffer = NVMeshUtilities.createMZ3(vertices, indices, false, null, scalars);

    // Symmetric colormap range so blue/red are equal distance from zero
    const calMax = Math.max(...refVoltages.map(Math.abs));

    nv.meshes = [];

    NVMesh.loadFromUrl({
      buffer,
      gl: nv.gl,
      name: 'eeg-topo',
      layers: [{ colormap: 'redblue', cal_min: -calMax, cal_max: calMax }],
    }).then((mesh) => {
      if (nvRef.current) nvRef.current.addMesh(mesh);
    });
  }, [electrodes, matched, voltages, useMedian]);

  // Drag the floating window by its title bar
  const handleDragStart = useCallback(
    (e) => {
      dragOffset.current = { x: e.clientX - position.x, y: e.clientY - position.y };
      const onMove = (e) =>
        setPosition({ x: e.clientX - dragOffset.current.x, y: e.clientY - dragOffset.current.y });
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [position]
  );

  return (
    <div
      className={
        isMaximized
          ? 'fixed inset-0 z-50 flex flex-col bg-card'
          : 'fixed z-50 flex flex-col w-96 h-80 rounded-lg border border-border shadow-xl bg-card'
      }
      style={isMaximized ? {} : { left: position.x, top: position.y }}
    >
      {/* Title bar — drag handle */}
      <div
        className="flex items-center justify-between px-2 py-1 border-b border-border cursor-grab select-none shrink-0"
        onMouseDown={handleDragStart}
      >
        <span className="text-sm font-medium">EEG Topography</span>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setIsMaximized((v) => !v)}
            aria-label={isMaximized ? 'Restore' : 'Maximize'}
            title={isMaximized ? 'Restore' : 'Maximize'}
          >
            {isMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button type="button" onClick={onClose} aria-label="Close" title="Close">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* NiiVue canvas — fills remaining space between title bar and footer */}
      <canvas ref={canvasRef} className="flex-1 w-full" />

      {/* Footer — channel count + reference mode toggle */}
      <div className="flex items-center justify-between px-2 py-1 text-xs border-t border-border shrink-0">
        <span>
          {matched.length} / {totalChannels} channels mapped
        </span>
        <div className="flex gap-1">
          <button
            type="button"
            className={`button size-xs${!useMedian ? ' active' : ''}`}
            onClick={() => setUseMedian(false)}
            aria-label="Avg ref"
          >
            Avg ref
          </button>
          <button
            type="button"
            className={`button size-xs${useMedian ? ' active' : ''}`}
            onClick={() => setUseMedian(true)}
            aria-label="Med ref"
          >
            Med ref
          </button>
        </div>
      </div>
    </div>
  );
}
