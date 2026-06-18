import { useRef, useEffect, useState, useCallback } from 'react';
import { NVMesh, NVMeshUtilities, SLICE_TYPE } from '@niivue/niivue';
import { X, Maximize2, Minimize2 } from 'lucide-react';
import { buildEegMesh, averageReference, medianReference } from '@/utils/eegTopography';

export function EegTopoViewer({
  nvRef,
  electrodes,
  matched,
  voltages,
  totalChannels,
  onClose,
  onTopoNvReady,
}) {
  const canvasRef = useRef(null);
  const [reference, setReference] = useState('average'); // 'none' | 'average' | 'median'
  const [isMaximized, setIsMaximized] = useState(false);
  const [position, setPosition] = useState({ x: 80, y: 80 });
  const dragOffset = useRef(null);

  // Initialise NiiVue once on mount
  useEffect(() => {
    const nv = nvRef.current;
    nv.setSliceType(SLICE_TYPE.RENDER); // force slicetype to render for a 3D view
    // Attach to a canvas and signal PatientView it is ready for synchronising to the EegTopoViewer
    nv.attachToCanvas(canvasRef.current);
    onTopoNvReady?.();
  }, []);

  // Rebuild and reload the mesh whenever electrodes, matched channels, voltages, or
  // re-referencing mode change. Clears any previously loaded mesh first.
  useEffect(() => {
    const nv = nvRef.current;
    if (!nv || !electrodes?.length || !voltages?.length) return;

    const refVoltages =
      reference === 'median'
        ? medianReference(voltages)
        : reference === 'average'
          ? averageReference(voltages)
          : voltages; // 'none' — use raw voltages without re-referencing

    const { vertices, indices, scalars } = buildEegMesh(electrodes, matched, refVoltages);
    const buffer = NVMeshUtilities.createMZ3(vertices, indices, false, null, scalars);

    // Symmetric colormap range so blue/red are equal distance from zero
    const calMax = Math.max(...refVoltages.map(Math.abs));

    nv.meshes = [];

    const loadMesh = async () => {
      try {
        // url must be non-empty and carry the .mz3 extension — NiiVue derives the mesh
        // format from url when name is absent; the buffer is used for actual data so no
        // network request is made.
        const mesh = await NVMesh.loadFromUrl({
          url: 'eeg-topo.mz3',
          buffer,
          gl: nv.gl,
          // name intentionally omitted — NiiVue derives 'eeg-topo.mz3' from url, giving
          // readMesh the .mz3 extension it needs for format detection. Passing a name
          // without an extension causes readMesh to throw on ext.toUpperCase().
        });
        if (!nvRef.current) return;

        // Override the auto-created scalar layer's colormap before the mesh is rendered
        if (mesh.layers.length > 0) {
          Object.assign(mesh.layers[0], {
            colormap: 'blue2red',
            cal_min: -calMax,
            cal_max: calMax,
            opacity: 1,
          });
          mesh.updateMesh(nv.gl); // rebuild GL color buffers with the new colormap
        }

        nvRef.current.addMesh(mesh);
        nvRef.current.updateGLVolume();
      } catch (err) {
        console.error('[EegTopoViewer] mesh load failed:', err);
      }
    };

    loadMesh();
  }, [electrodes, matched, voltages, reference]);

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
          ? 'fixed inset-0 z-50 flex flex-col bg-surface'
          : 'fixed z-50 flex flex-col w-96 h-80 rounded-lg border border-border bg-surface'
      }
      style={
        isMaximized
          ? { boxShadow: 'none' }
          : { left: position.x, top: position.y, boxShadow: 'var(--c-shadow)' }
      }
    >
      {/* Title bar — drag handle; explicit bg-surface so NiiVue's black canvas doesn't bleed through */}
      <div
        className="flex items-center justify-between px-2 py-1 border-b border-border cursor-grab select-none shrink-0 bg-surface"
        onMouseDown={handleDragStart}
      >
        <span className="text-sm font-medium text-heading">EEG Topography</span>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setIsMaximized((v) => !v)}
            className="text-foreground hover:text-heading cursor-pointer"
            aria-label={isMaximized ? 'Restore' : 'Maximize'}
            title={isMaximized ? 'Restore' : 'Maximize'}
          >
            {isMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-foreground hover:text-alert cursor-pointer"
            aria-label="Close"
            title="Close"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* NiiVue positions its canvas absolutely inside whatever element it attaches to.
          This wrapper is the containing block so the canvas stays within the middle zone. */}
      <div className="relative flex-1 min-h-0">
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
      </div>

      {/* Footer — explicit bg-surface for the same reason as the title bar */}
      <div className="flex items-center justify-between px-2 py-1 text-xs border-t border-border shrink-0 bg-surface">
        <span className="text-foreground">
          {matched.length} / {totalChannels} channels mapped
        </span>
        <div className="flex items-center gap-3">
          <span className="text-foreground select-none pointer-events-none">Re-referencing</span>
          <select
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            aria-label="Re-referencing"
            className="bg-background border border-border rounded px-2 py-0.5 text-xs text-heading cursor-pointer"
          >
            <option value="none">None</option>
            <option value="average">Average</option>
            <option value="median">Median</option>
          </select>
        </div>
      </div>
    </div>
  );
}
