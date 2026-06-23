import { useRef, useEffect, useState, useCallback } from 'react';
import { NVMesh, NVMeshUtilities, SLICE_TYPE } from '@niivue/niivue';
import { TrafficLightButtons } from './TrafficLightButtons';
import { buildEegMesh } from '@/utils/eegTopographyUtils';

// Custom diverging colormap: blue (negative) -> white (zero) -> red (positive).
// (NiiVue's built-in 'blue2red' passes through green/yellow at the midpoint which is undesired)
const EEG_TOPO_COLORMAP_KEY = 'eegBlueWhiteRed';
const EEG_TOPO_COLORMAP = {
  R: [0, 255, 255],
  G: [0, 255, 0],
  B: [255, 255, 0],
  A: [255, 255, 255],
  I: [0, 128, 255],
};

export function EegTopoViewer({
  nvRef,
  electrodes,
  matched,
  voltages,
  totalChannels,
  onClose,
  onTopoNvReady,
  isStandardElectrodes = true,
  onElcFile,
}) {
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const [customFileName, setCustomFileName] = useState(null); // filename (no extension) of the loaded custom positions file
  const [isMaximized, setIsMaximized] = useState(false);
  const [position, setPosition] = useState({ x: 80, y: 80 });
  const dragOffset = useRef(null);
  const meshLoadRef = useRef(null); // tracks the in-flight load so StrictMode's double-invoke can't add two meshes (and so two colorbars)

  // Initialise NiiVue once on mount
  useEffect(() => {
    const nv = nvRef.current;
    nv.setSliceType(SLICE_TYPE.RENDER); // force slicetype to render for a 3D view
    nv.addColormap(EEG_TOPO_COLORMAP_KEY, EEG_TOPO_COLORMAP);
    // Attach to a canvas and signal PatientView it is ready for synchronising to the EegTopoViewer
    nv.attachToCanvas(canvasRef.current);
    onTopoNvReady?.();
  }, []);

  // Rebuild and reload the mesh whenever electrodes, matched channels, voltages, or
  // re-referencing mode change. Clears any previously loaded mesh first.
  useEffect(() => {
    const nv = nvRef.current;
    if (!nv || !electrodes?.length || !voltages?.length) return;

    const { vertices, indices, scalars } = buildEegMesh(electrodes, matched, voltages);
    const buffer = NVMeshUtilities.createMZ3(vertices, indices, false, null, scalars);

    // Symmetric colormap range so blue/red are equal distance from zero
    const calMax = Math.max(...voltages.map(Math.abs));

    // Identifies this specific load — StrictMode double-invokes this effect in dev,
    // which would otherwise let a stale call add a second, overlapping mesh once the
    // earlier (superseded) call's loadFromUrl resolves.
    const loadToken = {};
    meshLoadRef.current = loadToken;
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
        if (!nvRef.current || meshLoadRef.current !== loadToken) return; // superseded by a newer load

        // Override the auto-created scalar layer's colormap before the mesh is rendered
        if (mesh.layers.length > 0) {
          Object.assign(mesh.layers[0], {
            colormap: EEG_TOPO_COLORMAP_KEY,
            cal_min: -calMax,
            cal_max: calMax,
            opacity: 1,
          });
          mesh.updateMesh(nv.gl); // rebuild GL color buffers with the new colormap
        }

        nv.opts.isColorbar = true;
        nv.addMesh(mesh);
        nv.updateGLVolume();
      } catch (err) {
        console.error('[EegTopoViewer] mesh load failed:', err);
      }
    };

    // Generate mesh for current electrode layout and load into NiiVue canvas
    loadMesh();
  }, [electrodes, matched, voltages]);

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
        <TrafficLightButtons
          onMaximize={() => setIsMaximized((v) => !v)}
          isMaximized={isMaximized}
          onClose={onClose}
        />
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
      </div>

      {/* Electrode source row */}
      <div className="flex items-center justify-between px-2 py-1 text-xs border-t border-border shrink-0 bg-surface">
        <span className="text-foreground/60">
          {isStandardElectrodes ? 'Default: Standard 10-05' : (customFileName ?? 'Custom')}
        </span>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="text-foreground/60 hover:text-heading cursor-pointer underline underline-offset-2"
          aria-label="Use custom positions"
        >
          Use custom positions
        </button>
        {/* accept is .elc only for now — more parsers will extend this list later */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".elc"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              setCustomFileName(file.name.replace(/\.[^.]+$/, ''));
              onElcFile?.(file);
            }
            e.target.value = ''; // reset so the same file can be re-selected
          }}
        />
      </div>
    </div>
  );
}
