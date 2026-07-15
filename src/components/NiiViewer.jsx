import { useRef, useEffect, useState, useCallback } from 'react';
import { cn } from '../utils/utils';
import { SHOW_RENDER, MULTIPLANAR_TYPE, SLICE_TYPE } from '@niivue/niivue';
import { move } from '@dnd-kit/helpers';
import toast from 'react-hot-toast';

const NII_LOADING_TOAST_ID = 'nii-viewer-loading'; // fixed id so loading/success toasts update in place rather than stacking
const MIN_CANVAS_HEIGHT = 350; // px — matches the canvas row's original fixed floor
import {
  getInitialLayerSettings,
  filesToLayers,
  INTRACRANIAL_CONNECTOME_URL,
  ESI_LAYER_URL,
} from '../utils/NiiViewer.utils';
import { ImagingControls } from './ImagingControls';
import { FileDropZone } from '../components/FileDropZone';
import {
  EEG_NODE_POS_KEY,
  EEG_NODE_POS,
  EEG_NODE_NEG_KEY,
  EEG_NODE_NEG,
} from '@/utils/eegColormaps';

// layerSettings.cal_min/cal_max are 0-1 *fractions* of a layer's own data range (same
// "fraction, not absolute value" convention opacity already uses), not literal NiiVue
// cal_min/cal_max values — those depend on the specific volume/source-power data, so a
// raw 0-1 slider value would be meaningless applied directly. This resolves a layer's
// actual bounds so a fraction can be converted to a real value:
//  - ESI layers: power is always non-negative and layer.calMax is the observed ceiling
//    for the current click, so bounds are simply [0, layer.calMax].
//  - Regular volumes: bounds come from NiiVue's own robust_min/robust_max (percentile-
//    clipped range) on the loaded NVImage — global_min/global_max would let one outlier
//    voxel blow out the whole scale.
function getCalBounds(layer, nvVolume) {
  if (layer.url === ESI_LAYER_URL) return { boundMin: 0, boundMax: layer.calMax };
  return { boundMin: nvVolume?.robust_min ?? 0, boundMax: nvVolume?.robust_max ?? 1 };
}

function fractionToCalValue(fraction, boundMin, boundMax) {
  return boundMin + fraction * (boundMax - boundMin);
}

// Loads only new image volumes into nv (existing ones stay) and applies all settings.
// Connectome/mesh layers are excluded — they're tracked separately by the build effects.
export async function syncVolumesAndApplySettings(nv, layers, layerSettings) {
  const indexOffset = nv.volumes.length; // Volumes before this index are already loaded into nv.
  const newLayers = layers.slice(indexOffset);
  if (newLayers.length > 0) {
    if (indexOffset === 0) {
      await nv.loadVolumes(newLayers);
    } else {
      await nv.addVolumesFromUrl(newLayers);
    }
  }

  // nv.volumes now matches layers 1:1, so settings can be applied by index directly.
  layerSettings.forEach((layerSetting, index) => {
    const nvVolume = nv.volumes[index];
    nv.setColormap(nvVolume.id, layerSetting.colormap);
    nv.setOpacity(index, layerSetting.visible ? layerSetting.opacity : 0);
    if (layerSetting.invert) nvVolume.colormapInvert = true;
    nvVolume.colorbarVisible = layerSetting.showColorbar;
    // Applied after setColormap, same requirement as the ESI volume build effect below:
    // setColormap's internal updateGLVolume() re-triggers NiiVue's own cal_min/cal_max
    // auto-scan, which would otherwise silently overwrite these right after they're set.
    const { boundMin, boundMax } = getCalBounds(layers[index], nvVolume);
    nvVolume.cal_min = fractionToCalValue(layerSetting.cal_min, boundMin, boundMax);
    nvVolume.cal_max = fractionToCalValue(layerSetting.cal_max, boundMin, boundMax);
  });
  nv.opts.isColorbar = layerSettings.some((layerSetting) => layerSetting.showColorbar);
  // GL redraw to apply settings
  nv.updateGLVolume();
}

// Pure updater functions for merging a connectome layer into orderedLayers/layerSettings
// by its sentinel URL. Used by both the intracranialLayer and esiLayer merge effects.
// Five possible cases, based on whether `layer` is present and whether an entry
// already exists at `sentinelUrl`:
//   no layer   + not present  → no-op
//   no layer   + present      → remove it
//   has layer  + not present  → append it
//   has layer  + present, same object      → no-op (data unchanged)
//   has layer  + present, different object → replace it in place
function makeLayerMergeUpdater(layer, sentinelUrl) {
  return (prevLayers) => {
    const existingIndex = prevLayers.findIndex((l) => l.url === sentinelUrl);
    const alreadyPresent = existingIndex !== -1;

    if (!layer) {
      // Nothing to show — remove the existing entry, or leave the array as-is if there wasn't one.
      return alreadyPresent ? prevLayers.filter((_, i) => i !== existingIndex) : prevLayers;
    }

    if (!alreadyPresent) {
      // First appearance — append as a new layer.
      return [...prevLayers, layer];
    }

    if (prevLayers[existingIndex] === layer) {
      // Same object reference — data hasn't changed, avoid an unnecessary update.
      return prevLayers;
    }

    // Data changed — replace the existing entry in place, preserving its position.
    const next = prevLayers.slice();
    next[existingIndex] = layer;
    return next;
  };
}

function makeSettingsMergeUpdater(layer, sentinelUrl) {
  return (prevSettings) => {
    const existingIndex = prevSettings.findIndex((s) => s.url === sentinelUrl);
    const alreadyPresent = existingIndex !== -1;

    if (!layer) {
      // Nothing to show — remove its settings entry, or leave the array as-is if there wasn't one.
      return alreadyPresent ? prevSettings.filter((_, i) => i !== existingIndex) : prevSettings;
    }

    if (alreadyPresent) {
      // Already has a settings entry — a data-only refresh (e.g. new sourcePowers) never touches
      // user-chosen settings like opacity/visibility, so leave it untouched.
      return prevSettings;
    }

    // First appearance — seed default settings for it.
    return [...prevSettings, ...getInitialLayerSettings([layer], prevSettings.length)];
  };
}

export const NiiViewer = ({
  nvRef,
  layers = [], // image volumes/meshes loaded from files — e.g. .nii/.mgz/.gii/.ply/.obj drops
  intracranialLayer = null, // kept separate from `layers` so a voltage-driven refresh never resets other layers' settings
  esiLayer = null, // same pattern — ESI source power connectome/volume layer
  onViewReady,
  onNiiNvReady,
  isFullscreen = false,
}) => {
  // ─── State ─────────────────────────────────────────────────────────────────
  const [layerSettings, setLayerSettings] = useState(() => getInitialLayerSettings(layers));
  const [orderedLayers, setOrderedLayers] = useState(layers); // mirrors `layers` + any merged connectome layers; user-reorderable
  const [isLoading, setIsLoading] = useState(true);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [activeSliceType, setActiveSliceType] = useState(SLICE_TYPE.MULTIPLANAR);

  // ─── Refs ───────────────────────────────────────────────────────────────────
  const canvas = useRef();
  const canvasContainerRef = useRef();
  const canvasRowRef = useRef(); // min-height dragged by the resize handle below
  const canvasReadyRef = useRef(false); // guards attachToCanvas against StrictMode double-invoke
  const loadingLayersRef = useRef(null); // guards nv.loadVolumes against StrictMode double-invoke
  const opacityRafRef = useRef(null); // rAF id — cancelled on each drag so only the latest value redraws
  const canvasSizeTimeoutRef = useRef(null); // debounce timeout for canvas size updates
  const intracranialMeshRef = useRef(null); // current intracranial connectome mesh in the scene
  const lastIntracranialLayerRef = useRef(null); // guards against rebuilding on unrelated re-renders
  const esiMeshRef = useRef(null); // current ESI connectome mesh in the scene (connectome mode)
  const esiVolumeRef = useRef(null); // current ESI NVImage volume in the scene (volume mode) — mutually exclusive with esiMeshRef
  const lastEsiLayerRef = useRef(null); // guards against rebuilding on unrelated re-renders — tracks whichever of the two is active

  // ─── Derived values ─────────────────────────────────────────────────────────
  // Derived from orderedLayers (not `layers`) to also catch files dropped into this
  // component's own zone, which never touches the `layers` prop.
  const hasImageVolumes = orderedLayers.some((l) => l.kind !== 'connectome');
  // Connectome/Volume toggle state for the ESI layer — read by both ESI effects below.
  const isEsiVolumeMode = layerSettings.find((s) => s.url === ESI_LAYER_URL)?.isEsiVolume;
  const sliceTypeOptions = [
    { sliceType: SLICE_TYPE.AXIAL, label: 'Axial', buttonLabel: 'Ax' },
    { sliceType: SLICE_TYPE.CORONAL, label: 'Coronal', buttonLabel: 'Co' },
    { sliceType: SLICE_TYPE.SAGITTAL, label: 'Sagittal', buttonLabel: 'Sa' },
    { sliceType: SLICE_TYPE.MULTIPLANAR, label: 'Multiplanar', buttonLabel: 'MP' },
    { sliceType: SLICE_TYPE.RENDER, label: '3D', buttonLabel: '3D' },
  ];

  // ─── Handlers ───────────────────────────────────────────────────────────────
  const handleSliceTypeChange = (sliceType) => {
    setActiveSliceType(sliceType);
    nvRef.current?.setSliceType(sliceType);
  };

  const handleSettingChange = useCallback(
    (layerIndex, key, value) => {
      const nextLayerSettings = layerSettings.map((layerSetting, index) =>
        index === layerIndex ? { ...layerSetting, [key]: value } : layerSetting
      );
      setLayerSettings(nextLayerSettings);

      if (!nvRef.current) return;
      const nv = nvRef.current;
      const layer = orderedLayers[layerIndex];
      if (!layer) return;

      // Connectome layers aren't in nv.volumes at all (they're a mesh, built/tracked
      // separately above) — update the mesh object directly instead of going through
      // nv.setOpacity/setColormap, which index into nv.volumes.
      if (layer.kind === 'connectome') {
        const mesh = layer.url === ESI_LAYER_URL ? esiMeshRef.current : intracranialMeshRef.current;
        if (!mesh) return;
        if (key === 'visible') {
          mesh.opacity = value ? nextLayerSettings[layerIndex].opacity : 0;
          nv.updateGLVolume();
        } else if (key === 'opacity') {
          if (nextLayerSettings[layerIndex].visible) {
            mesh.opacity = value;
            nv.updateGLVolume();
          }
        } else if (key === 'cal_min' || key === 'cal_max') {
          // Unlike cal_min/cal_max on an NVImage, a connectome mesh's color range is only
          // read when its color buffers are rebuilt — mutating nodeMinColor/edgeMin etc.
          // alone has no visual effect until mesh.updateMesh(gl) recomputes them.
          const { boundMin, boundMax } = getCalBounds(layer);
          const calMin = fractionToCalValue(
            nextLayerSettings[layerIndex].cal_min,
            boundMin,
            boundMax
          );
          const calMax = fractionToCalValue(
            nextLayerSettings[layerIndex].cal_max,
            boundMin,
            boundMax
          );
          mesh.nodeMinColor = calMin;
          mesh.nodeMaxColor = calMax;
          mesh.edgeMin = calMin;
          mesh.edgeMax = calMax;
          mesh.updateMesh(nv.gl);
          nv.updateGLVolume();
        }
        // colormap/invert/showColorbar: ImagingControls doesn't render those controls for
        // this kind, so there's nothing to apply here.
        return;
      }

      // Map layerIndex (position in the combined orderedLayers list) to its index in
      // nv.volumes by counting only the preceding image-kind entries — the connectome
      // layer, if present, occupies a slot in orderedLayers but not in nv.volumes.
      const nvIndex = orderedLayers
        .slice(0, layerIndex)
        .filter((l) => l.kind !== 'connectome').length;
      const nvVolume = nv.volumes[nvIndex];
      if (!nvVolume) return;

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
      } else if (key === 'cal_min' || key === 'cal_max') {
        // value alone (a 0-1 fraction) isn't a real cal_min/cal_max — it has to be resolved
        // against this volume's own data range first (see getCalBounds above).
        const { boundMin, boundMax } = getCalBounds(layer, nvVolume);
        nvVolume.cal_min = fractionToCalValue(
          nextLayerSettings[layerIndex].cal_min,
          boundMin,
          boundMax
        );
        nvVolume.cal_max = fractionToCalValue(
          nextLayerSettings[layerIndex].cal_max,
          boundMin,
          boundMax
        );
        nv.updateGLVolume();
      }
    },
    [layerSettings, orderedLayers]
  );

  const handleNiiFiles = async (files) => {
    if (!nvRef.current) return;
    setIsLoading(true);
    const newLayers = filesToLayers(files);
    const allLayers = [...orderedLayers, ...newLayers];
    // startIndex ensures new layers get 0.6 opacity rather than being treated as the first
    const newLayerSettings = getInitialLayerSettings(newLayers, orderedLayers.length);
    const allLayerSettings = [...layerSettings, ...newLayerSettings];
    setOrderedLayers(allLayers);
    setLayerSettings(allLayerSettings);
    // Strip connectome layers — syncVolumesAndApplySettings only handles nv.volumes (image files)
    const imageLayers = allLayers.filter((l) => l.kind !== 'connectome');
    const imageLayerSettings = allLayerSettings.filter(
      (_, i) => allLayers[i].kind !== 'connectome'
    );
    try {
      await syncVolumesAndApplySettings(nvRef.current, imageLayers, imageLayerSettings);
    } catch (loadError) {
      toast.error(`Failed to load image: ${loadError.message}`);
    } finally {
      requestAnimationFrame(() => setIsLoading(false)); // wait one frame before clearing spinner
    }
  };

  const handleReorder = useCallback(
    (event) => {
      if (!nvRef.current) return; // Guard clause — if NiiVue isn't initialized yet, we can't reorder

      const urls = orderedLayers.map((layer) => layer.url); // Get the current order of URLs
      const newUrls = move(urls, event); // Get the new order of URLs based on the drag event
      if (newUrls === urls) return; // no change (canceled or same position)

      // Reorder the orderedLayers and layerSettings arrays to match the new order of URLs
      const newOrderedLayers = newUrls.map((url) =>
        orderedLayers.find((layer) => layer.url === url)
      );
      const newLayerSettings = newUrls.map((url) => {
        const oldIndex = orderedLayers.findIndex((layer) => layer.url === url);
        return layerSettings[oldIndex];
      });

      setOrderedLayers(newOrderedLayers);
      setLayerSettings(newLayerSettings);

      // A connectome layer has no slot in nv.volumes at all, and reordering a mesh
      // relative to volumes has no rendering effect anyway (3D meshes vs. 2D slice
      // compositing have no shared z-order) — only move the NVImage when an actual
      // image volume was dragged.
      const movedLayer = orderedLayers[event.operation.source.initialIndex];
      if (movedLayer?.kind !== 'connectome') {
        const imagesBefore = orderedLayers.filter((l) => l.kind !== 'connectome');
        const imagesAfter = newOrderedLayers.filter((l) => l.kind !== 'connectome');
        const fromIndex = imagesBefore.indexOf(movedLayer);
        const toIndex = imagesAfter.indexOf(movedLayer);
        setIsLoading(true);
        nvRef.current.setVolume(nvRef.current.volumes[fromIndex], toIndex);
        nvRef.current.updateGLVolume();
        // updateGLVolume schedules a GL redraw but returns before it paints — wait one frame before clearing the spinner
        requestAnimationFrame(() => setIsLoading(false));
      }
    },
    [orderedLayers, layerSettings]
  );

  const handleDeleteLayer = useCallback(
    (index) => {
      if (!nvRef.current) return; // Guard clause — if NiiVue isn't initialized yet, we can't delete
      const nv = nvRef.current;
      const layer = orderedLayers[index];

      if (layer?.kind === 'connectome') {
        // Dispatch to the right mesh ref by URL — each connectome layer tracks its own mesh
        const meshRef = layer.url === ESI_LAYER_URL ? esiMeshRef : intracranialMeshRef;
        if (meshRef.current) {
          nv.removeMesh(meshRef.current);
          meshRef.current = null;
        }
        // Note: PatientView keeps re-deriving intracranialLayer from live EEG state, so this
        // card reappears on the next voltage update unless that upstream state also clears —
        // acceptable for now, not a locked-in requirement to support a persistent dismissal.
      } else {
        const nvIndex = orderedLayers.slice(0, index).filter((l) => l.kind !== 'connectome').length;
        nv.removeVolumeByIndex(nvIndex);
        // The ESI volume (volume mode) is a non-connectome layer too — clear its ref so the
        // ESI build effect doesn't try to remove an already-gone NVImage on its next rebuild.
        if (layer?.url === ESI_LAYER_URL) esiVolumeRef.current = null;
      }
      setOrderedLayers(orderedLayers.filter((_, i) => i !== index));
      setLayerSettings(layerSettings.filter((_, i) => i !== index));
    },
    [orderedLayers, layerSettings]
  );

  // Drag to raise the canvas row's min-height, pushing the volume list into scroll.
  // Writes to DOM directly (not React state) to avoid re-rendering on every drag frame.
  const handleCanvasResizeStart = useCallback((e) => {
    e.preventDefault();
    const row = canvasRowRef.current;
    if (!row) return;
    const startY = e.clientY;
    const startHeight = row.getBoundingClientRect().height;

    const onMove = (moveEvent) => {
      const nextHeight = Math.max(MIN_CANVAS_HEIGHT, startHeight + (moveEvent.clientY - startY));
      row.style.minHeight = `${nextHeight}px`;
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  // ─── Effects: UI ────────────────────────────────────────────────────────────

  // Loading toast — self-contained so NiiViewer reports its own status regardless of where it's embedded.
  useEffect(() => {
    if (isLoading) {
      toast.loading('Loading imaging data…', { id: NII_LOADING_TOAST_ID });
    } else {
      toast.success('Imaging data loaded!', { id: NII_LOADING_TOAST_ID });
    }
  }, [isLoading]);

  // Dismiss the toast if the viewer unmounts mid-load.
  useEffect(() => {
    return () => toast.dismiss(NII_LOADING_TOAST_ID);
  }, []);

  // Force 3D view when there are no image volumes — connectome-only scenes have no slices.
  // Only acts on the "no volumes" side: firing on re-appearance races with an in-flight
  // nv.loadVolumes() and can leave the spinner stuck.
  useEffect(() => {
    if (hasImageVolumes) return;
    setActiveSliceType(SLICE_TYPE.RENDER);
    nvRef.current?.setSliceType(SLICE_TYPE.RENDER);
  }, [hasImageVolumes, nvRef]);

  // ─── Effects: canvas setup ───────────────────────────────────────────────────

  // Track canvas container dimensions; debounced to avoid thrashing during resize transitions.
  useEffect(() => {
    const canvasContainer = canvasContainerRef.current;
    if (!canvasContainer) return;
    const canvasSizeObserver = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (canvasSizeTimeoutRef.current) clearTimeout(canvasSizeTimeoutRef.current);
      canvasSizeTimeoutRef.current = setTimeout(() => setCanvasSize({ width, height }), 150);
    });
    canvasSizeObserver.observe(canvasContainer);
    return () => {
      canvasSizeObserver.disconnect();
      if (canvasSizeTimeoutRef.current) clearTimeout(canvasSizeTimeoutRef.current);
    };
  }, []);

  // Switch between AUTO (panels in a row) and GRID (2×2) based on aspect ratio.
  useEffect(() => {
    if (!nvRef.current) return;
    const isWide = canvasSize.height > 0 && canvasSize.width >= 1.75 * canvasSize.height;
    nvRef.current.setMultiplanarLayout(isWide ? MULTIPLANAR_TYPE.AUTO : MULTIPLANAR_TYPE.GRID);
  }, [canvasSize]);

  // Attach NiiVue to the canvas once on mount. canvasReadyRef guards against StrictMode's
  // double-invoke — a second attachToCanvas would reinitialise WebGL, wiping all volumes.
  useEffect(() => {
    if (!nvRef.current || canvasReadyRef.current) return;
    canvasReadyRef.current = true;
    const nv = nvRef.current;
    nv.opts.multiplanarShowRender = SHOW_RENDER.ALWAYS;
    nv.setMultiplanarLayout(MULTIPLANAR_TYPE.GRID);
    nv.opts.multiplanarEqualSize = false;
    nv.setCornerOrientationText(false);
    // Registered here (rather than where the connectome mesh is built) so they exist
    // before the connectome-build effect can ever run on this instance.
    nv.addColormap(EEG_NODE_POS_KEY, EEG_NODE_POS);
    nv.addColormap(EEG_NODE_NEG_KEY, EEG_NODE_NEG);
    nv.attachToCanvas(canvas.current);
    // Sync slice type on mount — nv is long-lived and may have been left in RENDER from
    // a previous connectome-only phase. Later changes go through handleSliceTypeChange.
    nv.setSliceType(hasImageVolumes ? activeSliceType : SLICE_TYPE.RENDER);
    onNiiNvReady?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // nv is long-lived and reused across remounts — clear volumes/meshes on unmount so they
  // don't silently reappear (as ghost layers with no ImagingControls card) on the next mount.
  useEffect(() => {
    return () => {
      const nv = nvRef.current;
      if (!nv) return;
      while (nv.volumes.length > 0) nv.removeVolumeByIndex(0);
      (nv.meshes ?? []).slice().forEach((mesh) => nv.removeMesh(mesh));
    };
  }, [nvRef]);

  // ─── Effects: image volume loading ──────────────────────────────────────────

  // Load image volumes when the layers prop changes. loadingLayersRef has two guards:
  // (1) same reference at the top → StrictMode double-invoke, bail before touching nv;
  // (2) stale reference in the async callback → a newer load superseded this one, don't update state.
  // Connectome layers are intentionally excluded from deps — their own merge effects handle them.
  useEffect(() => {
    if (!layers.length) {
      loadingLayersRef.current = null; // reset so the next non-empty load can proceed
      // No image volumes — clear any stale ones from nv and remove their ImagingControls cards.
      // Connectome cards (identified by sentinel URL) are left alone.
      const nv = nvRef.current;
      if (nv?.volumes.length) {
        while (nv.volumes.length > 0) nv.removeVolumeByIndex(0);
        nv.updateGLVolume();
      }
      setOrderedLayers((prev) => prev.filter((layer) => layer.kind === 'connectome'));
      setLayerSettings((prev) =>
        prev.filter(
          (setting) => setting.url === INTRACRANIAL_CONNECTOME_URL || setting.url === ESI_LAYER_URL
        )
      );
      setIsLoading(false);
      return;
    }
    if (loadingLayersRef.current === layers) return; // StrictMode: already loading these layers
    loadingLayersRef.current = layers;

    const initialLayerSettings = getInitialLayerSettings(layers);
    setLayerSettings(initialLayerSettings);
    setOrderedLayers(layers);
    setIsLoading(true);

    const loadAndSync = async () => {
      try {
        await syncVolumesAndApplySettings(nvRef.current, layers, initialLayerSettings);
        if (loadingLayersRef.current !== layers) return; // superseded by a newer load
        setIsLoading(false);
        onViewReady?.();
      } catch (loadError) {
        if (loadingLayersRef.current !== layers) return;
        toast.error(`Failed to load image: ${loadError.message}`);
        setIsLoading(false);
      }
    };

    loadAndSync();
  }, [layers]);

  // ─── Effects: intracranial electrode layer ──────────────────────────────────

  // Merges intracranialLayer into orderedLayers/layerSettings by its sentinel URL so it
  // appears in the ImagingControls card list without disturbing other layers' settings on
  // every voltage-driven refresh. Two independent setState calls (not nested) — nesting
  // caused StrictMode's double-invoke to append the settings entry twice, misaligning
  // the arrays and crashing handleNiiFiles. Each updater is idempotent on its own.
  useEffect(() => {
    setOrderedLayers(makeLayerMergeUpdater(intracranialLayer, INTRACRANIAL_CONNECTOME_URL));
    setLayerSettings(makeSettingsMergeUpdater(intracranialLayer, INTRACRANIAL_CONNECTOME_URL));
  }, [intracranialLayer]);

  // Builds/rebuilds/removes the actual NiiVue connectome mesh whenever intracranialLayer's
  // data changes. Rebuilt wholesale on every change rather than mutated in place — mirrors
  // how EegTopoViewer rebuilds its own mesh on every topoTimepoint click.
  useEffect(() => {
    const nv = nvRef.current; // guard clause — nothing to do before NiiVue has attached to a canvas
    if (!nv) return;

    if (!intracranialLayer) {
      // No connectome to show anymore (e.g. positions/EEG cleared) — tear down the existing mesh, if any.
      if (intracranialMeshRef.current) {
        nv.removeMesh(intracranialMeshRef.current); // drop it from the 3D scene
        intracranialMeshRef.current = null; // nothing left to track
        lastIntracranialLayerRef.current = null; // so a future re-add isn't mistaken for "unchanged"
        nv.updateGLVolume(); // redraw without it
      }
      return;
    }

    if (intracranialLayer === lastIntracranialLayerRef.current) return; // unrelated re-render (e.g. another layer's settings changed)
    lastIntracranialLayerRef.current = intracranialLayer; // remember what this rebuild is based on

    if (intracranialMeshRef.current) nv.removeMesh(intracranialMeshRef.current); // drop the stale mesh before building its replacement

    // Build the new connectome mesh in memory — not yet added to the scene.
    const mesh = nv.loadConnectomeAsMesh({
      name: intracranialLayer.name,
      nodeColormap: EEG_NODE_POS_KEY,
      nodeColormapNegative: EEG_NODE_NEG_KEY,
      nodeMinColor: 0,
      nodeMaxColor: intracranialLayer.calMax,
      nodeScale: 4,
      edgeColormap: EEG_NODE_POS_KEY,
      edgeColormapNegative: EEG_NODE_NEG_KEY,
      edgeMin: 0,
      edgeMax: intracranialLayer.calMax,
      edgeScale: 0.5,
      showLegend: false,
      colorbarVisible: false, // suppresses the node+edge colorbar entries NiiVue would otherwise add for a populated `edges` array
      nodes: intracranialLayer.nodes,
      edges: intracranialLayer.edges,
    });

    // Apply whatever opacity/visibility is already set for this layer (preserved across
    // data refreshes by the sync effect above); fall back to the same default that effect
    // would compute if it hasn't run yet this render pass (e.g. the connectome's first
    // appearance, before orderedLayers/layerSettings have caught up).
    const existingIndex = orderedLayers.findIndex((l) => l.url === INTRACRANIAL_CONNECTOME_URL); // its current position in the card list, if it has one yet
    const settings =
      layerSettings[existingIndex] ?? // its existing settings, preserved across this rebuild
      getInitialLayerSettings([intracranialLayer], orderedLayers.length)[0]; // or computed fresh on first appearance
    mesh.opacity = settings.visible ? settings.opacity : 0; // 0 opacity is how a hidden mesh is represented, same convention as image volumes

    nv.addMesh(mesh); // actually add it to the 3D scene
    intracranialMeshRef.current = mesh; // track it so the next change/removal can find it
    nv.updateGLVolume(); // redraw with the new mesh visible
  }, [intracranialLayer, orderedLayers, layerSettings, nvRef]);

  // ─── Effects: ESI source power layer ────────────────────────────────────────

  // Merges the separately-tracked esiLayer prop into orderedLayers/layerSettings — same
  // pattern as the intracranialLayer merge effect above, keyed on ESI_LAYER_URL.
  useEffect(() => {
    const activeEsiLayer = esiLayer
      ? isEsiVolumeMode
        ? esiLayer.sourcePowerVolume
        : esiLayer.sourcePowerConnectomes
      : esiLayer;

    // Add/replace/remove the ESI entry in orderedLayers to match activeEsiLayer
    setOrderedLayers(makeLayerMergeUpdater(activeEsiLayer, ESI_LAYER_URL));
    // Add/remove its settings entry (visible/opacity/isEsiVolume/etc.); leaves an existing entry untouched
    setLayerSettings(makeSettingsMergeUpdater(activeEsiLayer, ESI_LAYER_URL));
  }, [esiLayer, isEsiVolumeMode]);

  // Builds/rebuilds/removes the ESI source-power mesh (connectome mode) or NVImage volume
  // (volume mode) whenever esiLayer's data or the Connectome/Volume toggle changes. Same
  // rebuild-on-change pattern as the intracranialLayer build effect above, but branches
  // between the two NiiVue object kinds depending on which one activeEsiLayer resolves to.
  useEffect(() => {
    const nv = nvRef.current; // guard — nothing to do before NiiVue has attached to a canvas
    if (!nv) return;

    const activeEsiLayer = esiLayer
      ? isEsiVolumeMode
        ? esiLayer.sourcePowerVolume
        : esiLayer.sourcePowerConnectomes
      : esiLayer;

    if (!activeEsiLayer) {
      // Nothing to show (e.g. no inverse solution loaded, iEEG mode, or empty flatSourceFilters)
      // — tear down whichever of mesh/volume is currently in the scene, if either actually is.
      const hadMesh = esiMeshRef.current;
      const hadVolume = esiVolumeRef.current;
      if (hadMesh) {
        nv.removeMesh(esiMeshRef.current); // drop it from the 3D scene
        esiMeshRef.current = null; // nothing left to track
      }
      if (hadVolume) {
        const staleIndex = nv.volumes.indexOf(esiVolumeRef.current);
        if (staleIndex !== -1) nv.removeVolumeByIndex(staleIndex);
        esiVolumeRef.current = null; // nothing left to track
      }
      lastEsiLayerRef.current = null; // so a future re-add isn't mistaken for "unchanged"
      if (hadMesh || hadVolume) nv.updateGLVolume(); // redraw only if something was actually removed
      return;
    }

    if (activeEsiLayer === lastEsiLayerRef.current) return; // unrelated re-render — data/mode hasn't changed
    lastEsiLayerRef.current = activeEsiLayer; // remember what this rebuild is based on

    // Apply whatever opacity/visibility is already set for this layer (preserved across
    // data refreshes by the sync effect above); fall back to the default on first appearance.
    const existingIndex = orderedLayers.findIndex((l) => l.url === ESI_LAYER_URL);
    const settings =
      layerSettings[existingIndex] ?? // existing settings, preserved across this rebuild
      getInitialLayerSettings([activeEsiLayer], orderedLayers.length)[0]; // fresh defaults on first appearance

    if (activeEsiLayer.kind === 'connectome') {
      // Connectome mode — drop any leftover volume from a previous volume-mode rebuild first.
      if (esiVolumeRef.current) {
        const staleIndex = nv.volumes.indexOf(esiVolumeRef.current);
        if (staleIndex !== -1) nv.removeVolumeByIndex(staleIndex);
        esiVolumeRef.current = null;
      }
      if (esiMeshRef.current) nv.removeMesh(esiMeshRef.current); // drop the stale mesh before building its replacement

      // Source power is always non-negative (squared magnitude) — use the positive colormap
      // for both slots; the negative colormap is never reached.
      // cal_min/cal_max on `settings` are the user's chosen fractions of activeEsiLayer.calMax
      // (see getCalBounds) — reapplying them here (rather than activeEsiLayer.calMin/calMax
      // directly) means a user-set threshold survives into the next EEG click's new bound.
      const { boundMin: esiBoundMin, boundMax: esiBoundMax } = getCalBounds(activeEsiLayer);
      const esiCalMin = fractionToCalValue(settings.cal_min, esiBoundMin, esiBoundMax);
      const esiCalMax = fractionToCalValue(settings.cal_max, esiBoundMin, esiBoundMax);
      const mesh = nv.loadConnectomeAsMesh({
        name: activeEsiLayer.name,
        nodeColormap: EEG_NODE_POS_KEY,
        nodeColormapNegative: EEG_NODE_POS_KEY, // unused — power is always ≥ 0
        nodeMinColor: esiCalMin,
        nodeMaxColor: esiCalMax,
        nodeScale: 4,
        edgeColormap: EEG_NODE_POS_KEY,
        edgeColormapNegative: EEG_NODE_POS_KEY,
        edgeMin: esiCalMin,
        edgeMax: esiCalMax,
        edgeScale: 0.5,
        showLegend: false,
        colorbarVisible: false, // suppresses the colorbar entry NiiVue would otherwise add
        nodes: activeEsiLayer.nodes,
        edges: activeEsiLayer.edges, // always [] for ESI — source points have no connecting structure
      });
      mesh.opacity = settings.visible ? settings.opacity : 0;

      nv.addMesh(mesh); // actually add it to the 3D scene
      esiMeshRef.current = mesh; // track it so the next change/removal can find it
      nv.updateGLVolume(); // redraw with the new mesh visible
    } else {
      // Volume mode — drop any leftover mesh from a previous connectome-mode rebuild first.
      if (esiMeshRef.current) {
        nv.removeMesh(esiMeshRef.current);
        esiMeshRef.current = null;
      }
      const staleVolume = esiVolumeRef.current; // remove after the new one lands, not before

      // activeEsiLayer.bytes is the raw NIfTI-1 Uint8Array (from NVImage.createNiftiArray) —
      // NVImage.loadFromUrl accepts raw bytes directly as `url`, same as a real file's blob URL.
      nv.addVolumesFromUrl([{ url: activeEsiLayer.bytes, name: activeEsiLayer.name }])
        .then(() => {
          const nvIndex = nv.volumes.length - 1; // just-appended volume is always last
          const nvVolume = nv.volumes[nvIndex];
          esiVolumeRef.current = nvVolume; // track it so the next change/removal can find it

          // nv.setColormap() calls updateGLVolume() internally, which re-triggers NiiVue's
          // own cal_min/cal_max auto-scan => cal_min/cal_max/colormapType MUST be set after
          // this block, not before, or they get silently fall back to the auto-scanned values.
          nv.setOpacity(nvIndex, settings.visible ? settings.opacity : 0);
          nv.setColormap(nvVolume.id, settings.colormap);
          if (settings.invert) nvVolume.colormapInvert = true;
          nvVolume.colorbarVisible = settings.showColorbar;

          // Fixed cal_min/cal_max (rather than NiiVue's auto-scan) keeps the color scale
          // consistent with connectome mode, and avoids a "% of voxels are zero" warning
          // from the auto-scan seeing this grid's mostly-empty background. Resolved from the
          // user's chosen fraction of activeEsiLayer.calMax, same as connectome mode above —
          // so it survives into the next click's new bound instead of resetting.
          const { boundMin: esiVolBoundMin, boundMax: esiVolBoundMax } =
            getCalBounds(activeEsiLayer);
          nvVolume.cal_min = fractionToCalValue(settings.cal_min, esiVolBoundMin, esiVolBoundMax);
          nvVolume.cal_max = fractionToCalValue(settings.cal_max, esiVolBoundMin, esiVolBoundMax);
          // 2 = ZERO_TO_MAX_TRANSLUCENT_BELOW_MIN (COLORMAP_TYPE isn't a runtime export of
          // @niivue/niivue, only a TS-only enum). Voxels below cal_min get a hard alpha=0
          // cutoff in NiiVue's shader — unlike type 1's smooth (f/cal_min)² ramp, there's no
          // continuous scaling near-zero values can land on unpredictably.
          nvVolume.colormapType = 1;

          if (staleVolume) {
            const staleIndex = nv.volumes.indexOf(staleVolume);
            if (staleIndex !== -1) nv.removeVolumeByIndex(staleIndex);
          }
          nv.updateGLVolume(); // redraw with the new volume visible
        })
        .catch((err) => console.error('ESI volume failed to load', err));
    }
  }, [esiLayer, orderedLayers, layerSettings, nvRef]);

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col pb-3 px-2 gap-2">
      {/* Controls panel, with a compact drop zone below it for loading additional files while the NiiViewer is active */}
      <div className="flex flex-col">
        <ImagingControls
          layers={orderedLayers}
          layerSettings={layerSettings}
          onSettingChange={handleSettingChange}
          onReorder={handleReorder}
          onDeleteLayer={handleDeleteLayer}
        />
        <FileDropZone
          onFiles={handleNiiFiles}
          accepted_formats=".nii,.nii.gz,.mgh,.mgz,.gii,.ply,.obj"
          label="Drop additional files"
          compact
        />
      </div>

      {/* Canvas fills remaining height, min MIN_CANVAS_HEIGHT. Resize handle below can raise that floor. */}
      <div
        ref={canvasRowRef}
        data-testid="nii-canvas-row"
        className="flex flex-row flex-1"
        style={{ minHeight: MIN_CANVAS_HEIGHT }}
      >
        {/* NiiVue Canvas */}
        <div ref={canvasContainerRef} className="relative flex-1 overflow-hidden">
          {/* Loading spinner overlay — absolute to cover the canvas, with a higher z-index so it appears on top */}
          {isLoading && (
            <div
              data-testid="loading-spinner"
              className="absolute inset-0 z-10 flex items-center justify-center"
            >
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-border border-t-primary" />
            </div>
          )}
          <canvas ref={canvas} className="absolute inset-0" />
        </div>
        <div className="">
          <div
            className={cn(
              'flex flex-col w-8 gap-0.5 pt-2 items-center',
              'rounded-r-md border-r-1 border-t-1 border-b-1 border-border'
            )}
          >
            {/* Viewer controls with Ax, Co, Sa, MP and 3D buttons — the 2D ones are greyed
                out and inert without an image volume loaded (3D/connectome-only scenes
                have no slices to show), per the hasImageVolumes effect above. */}
            {sliceTypeOptions.map(({ sliceType, label, buttonLabel }) => {
              const disabled = sliceType !== SLICE_TYPE.RENDER && !hasImageVolumes;
              return (
                <button
                  key={sliceType}
                  type="button"
                  className="button size-xs disabled:opacity-40 disabled:pointer-events-none"
                  onClick={() => handleSliceTypeChange(sliceType)}
                  disabled={disabled}
                  title={
                    disabled
                      ? 'No image volume loaded — only the 3D view is available'
                      : `${label} view`
                  }
                  aria-label={`${label} view`}
                  aria-pressed={activeSliceType === sliceType}
                >
                  {buttonLabel}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Resize handle — drag down to grow canvas past flex size, drag up to shrink back. 
          Once it reaches the row's natural flex size, further upward dragging has no effect, 
          since min-height never shrinks a flex item below what it'd render at anyway. See handleCanvasResizeStart*/}
      <div
        data-testid="nii-canvas-resize-handle"
        className="h-1.5 w-full shrink-0 cursor-row-resize rounded-sm select-none bg-border hover:bg-secondary active:bg-primary"
        title="Drag to resize the canvas"
        onMouseDown={handleCanvasResizeStart}
      />
    </div>
  );
};
