import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import toast from 'react-hot-toast';
import { Niivue } from '@niivue/niivue';

import { cn } from '../utils/utils';
import { FullWidthLayout } from '../components/FullWidthLayout';
import { ThemeToggle } from '../components/ThemeToggle';
import { EegViewer } from '../components/EegViewer';
import { NiiViewer } from '../components/NiiViewer';
import { SplitPane } from '../components/SplitPane';
import { loadBrainVisionEEG } from '../loaders/loadBrainVisionEEG';
import { detectAndLoadEEG, checkEegFiles } from '../loaders/eegFormats';
import { parseElectrodePositionFile } from '../loaders/parseElectrodePositionFile';
import { parseInverseFiltersFieldtrip } from '../loaders/parseInverseFiltersFieldtrip';
import { FileDropZone } from '../components/FileDropZone';
import { detectVolumeType, filesToLayers } from '../components/NiiViewer.utils';
import { buildConnectomeVolume } from '../utils/eegTopographyUtils';

const DEMO_EEG = {
  header: 'demo_data/sub-synth_task-rest_eeg.vhdr',
  data: 'demo_data/sub-synth_task-rest_eeg.eeg',
};

// Shared title styling — keeps "Neuroimaging" and the toggle's labels visually
// consistent, and both header bars the same height (TrafficLightButtons are 16px tall).
const PANEL_TITLE_CLASS = 'h-7 flex items-center text-xl font-medium leading-none text-header';

// Sits in the SplitPane's left title once EEG is loaded, replacing the static "EEG"
// label. One switch, not two buttons — clicking anywhere flips the value regardless of
// which label half was clicked. pointer-events-auto overrides panelHeader's <h2>.
const EEGTypeToggle = ({ recordingType, onChange }) => {
  const isIntracranial = recordingType === 'ieeg';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isIntracranial}
      aria-label="Recording type"
      onClick={() => onChange(isIntracranial ? 'eeg' : 'ieeg')}
      className="relative w-28 h-6.5 rounded-full border border-border bg-background cursor-pointer pointer-events-auto"
      title="Automatically detected from channel naming — click to overwrite"
    >
      <span className="absolute inset-0.5 flex">
        <span
          className={cn(
            'absolute inset-y-0 left-0 w-1/2 rounded-full bg-primary transition-transform duration-150 ease-out',
            isIntracranial && 'translate-x-full'
          )}
        />
        <span
          className={cn(
            'relative z-10 flex-1 flex items-center justify-center text-xl font-medium leading-none transition-colors',
            !isIntracranial ? 'text-header' : 'text-foreground/50'
          )}
        >
          EEG
        </span>
        <span
          className={cn(
            'relative z-10 flex-1 flex items-center justify-center text-xl font-medium leading-none transition-colors',
            isIntracranial ? 'text-header' : 'text-foreground/50'
          )}
        >
          iEEG
        </span>
      </span>
    </button>
  );
};

const DEMO_LAYERS = [
  { url: 'demo_data/patT1.nii', ...detectVolumeType('patT1.nii') },
  { url: 'demo_data/pat_PET_aligned.nii', ...detectVolumeType('pat_PET_aligned.nii') },
  {
    url: 'demo_data/pat_siscom_17-13.nii',
    ...detectVolumeType('pat_siscom_17-13.nii'),
    urlImgType: 'nii',
  },
];

// Electrode position files are routed to handleElecPosFile instead of the EEG-format
// accumulation logic below, regardless of which dropzone/button they came in through.
const ELEC_POS_EXTENSIONS = ['.elc', '.tsv'];

export const PatientView = () => {
  // Prevent default browser drag-and-drop behavior (e.g., opening files in a new tab)
  useEffect(() => {
    const prevent = (e) => e.preventDefault();
    document.addEventListener('dragover', prevent);
    document.addEventListener('drop', prevent);
    return () => {
      document.removeEventListener('dragover', prevent);
      document.removeEventListener('drop', prevent);
    };
  }, []);

  const [eeg, setEeg] = useState(null); // recording provider: { channelNames, fs, tMax, getChunk }
  const [layers, setLayers] = useState([]); // image volumes/meshes loaded from files
  const [isLoading, setIsLoading] = useState(false);
  const [isDemoloading, setIsDemoloading] = useState(false);
  const eegReadyResolveRef = useRef(null); // set before demo load; EegViewer calls it when charts are ready
  const niiReadyResolveRef = useRef(null); // set before demo load; NiiViewer calls it when volumes are ready
  const [pendingEegFiles, setPendingEegFiles] = useState([]);
  const [eegHint, setEegHint] = useState(null);
  const [maximizedPanel, setMaximizedPanel] = useState(null); // null | 'left' | 'right'

  // Custom electrode positions — owned here rather than in EegViewer, since they can be
  // dropped at the initial EEG dropzone before EegViewer even exists, and need to stay in
  // sync across the several places that can supply/replace them (this dropzone,
  // EegViewer's own persistent dropzone, and the topography popup's "use custom
  // positions" button) — all three call the same onElecPosFile callback below.
  const [customElectrodes, setCustomElectrodes] = useState([]); // [{label,x,y,z}]
  const [customElecPosFileName, setCustomElecPosFileName] = useState(null);
  // Live EEG/electrode state lifted out of EegViewer — drives the intracranial connectome
  // layer in the Neuroimaging pane. { isIntracranial, matched, voltages } | null.
  const [intracranialElectrodes, setIntracranialElectrodes] = useState(null);
  // 'eeg' | 'ieeg' — owned here (not EegViewer) so the SplitPane title can show/drive the
  // toggle. EegViewer reports its auto-detection result up via the same setter that the
  // title's click handler uses, then reads the resulting value back down as a prop.
  const [recordingType, setRecordingType] = useState('eeg');
  const [inverseFilters, setInverseFilters] = useState(null);

  const handleElecPosFile = useCallback(async (file) => {
    try {
      const { electrodes } = await parseElectrodePositionFile(file);
      if (!electrodes.length) return; // ignore empty or unparseable files
      setCustomElectrodes(electrodes);
      setCustomElecPosFileName(file.name.replace(/\.[^.]+$/, ''));
    } catch (err) {
      toast.error(err.message);
    }
  }, []);

  const handleInverseFilterFile = useCallback(async (file) => {
    try {
      const parsedInverseFilters = await parseInverseFiltersFieldtrip(file);
      if (!parsedInverseFilters.length) return; // ignore empty or unparseable files
      setInverseFilters(parsedInverseFilters);
    } catch (err) {
      toast.error(err.message);
    }
  }, []);

  // Derives the Neuroimaging pane's connectome layer from the EEG state lifted out of
  // EegViewer — null until there's an intracranial recording with at least one
  // position-matched channel. `?? {}` guards the initial (pre-EegViewer-effect) null state.
  const connectomeLayer = useMemo(
    () => buildConnectomeVolume(intracranialElectrodes ?? {}),
    [intracranialElectrodes]
  );

  // when both these flags are true, then the two plots can be synchronised
  const [niiNvReady, setNiiNvReady] = useState(false); // flag when the NiiViewer canvas is initialised
  const [topoNvReady, setTopoNvReady] = useState(false); // flag when EegTopoViewer canvas is initialised
  // useCallback returns the same function every render, instead of a new one each time —
  // EegTopoViewer's setup effect can then list it as a dependency without re-running on
  // every PatientView re-render.
  const handleTopoNvReady = useCallback(() => setTopoNvReady(true), []);

  // Lazy ref init — created once, never replaced. A cleanup-based useEffect would let
  // StrictMode's remount cycle recreate this and break NiiViewer's canvasReadyRef guard.
  const nvRef_niiviewer = useRef(null);
  if (nvRef_niiviewer.current === null) {
    nvRef_niiviewer.current = new Niivue({
      isOrientCube: true,
      dragAndDropEnabled: false,
      show3Dcrosshair: true,
    });
  }

  // Same lazy-ref pattern as nvRef_niiviewer, for the topography view's NiiVue instance.
  const nvRef_eegtopo = useRef(null);
  if (nvRef_eegtopo.current === null) {
    nvRef_eegtopo.current = new Niivue({
      isOrientCube: true,
    });
  }

  // Once both viewers are ready, mirror 3D camera movement between them in both
  // directions so rotating/zooming one view updates the other.
  useEffect(() => {
    if (!niiNvReady || !topoNvReady) return;
    nvRef_niiviewer.current.broadcastTo([nvRef_eegtopo.current], { '2d': false, '3d': true });
    nvRef_eegtopo.current.broadcastTo([nvRef_niiviewer.current], { '2d': false, '3d': true });
  }, [niiNvReady, topoNvReady]);

  // Handler for when EEG files are dropped or selected.
  // Files accumulate across drops until all required files for a format are present.
  // Electrode position files (.elc/.tsv) are split out first and routed separately —
  // they're orthogonal to EEG format detection and can arrive alone or alongside EEG files.
  const handleEegFiles = async (newFiles) => {
    const allFiles = Array.from(newFiles);
    const elecPosFiles = allFiles.filter((f) =>
      ELEC_POS_EXTENSIONS.some((ext) => f.name.toLowerCase().endsWith(ext))
    );
    if (elecPosFiles.length > 0) {
      await handleElecPosFile(elecPosFiles[elecPosFiles.length - 1]); // keep only the last if multiple were dropped at once
    }

    const eegFiles = allFiles.filter((f) => !elecPosFiles.includes(f));
    if (eegFiles.length === 0) return; // pure electrode-position drop — nothing else to do

    // Merge pending with new files
    const merged = [...pendingEegFiles, ...eegFiles];
    // Then keep only the last file for each extension by createing a map of extension to file.
    // This way, if a user drops a new .vhdr file, it will replace the previous .vhdr in the pending state, while still keeping any .eeg file that was dropped before.
    const byExtension = new Map();
    for (const file of merged) {
      const ext = file.name.toLowerCase().match(/(\.[^.]+)$/)?.[1];
      // for each file with a recognized extension, store it in the Map keyed by that extension.
      // If a .vhdr was already in the map and another .vhdr comes along, .set() overwrites the old entry
      if (ext) byExtension.set(ext, file);
    }
    // Pull File objects back out of the map
    const deduped = [...byExtension.values()];
    // Check the accumulated files against known EEG formats to determine if we can load or if we need to wait for more files.
    const { formatName, complete, missing, warning } = checkEegFiles(deduped);

    if (complete) {
      // All required files present — clear pending state and load.
      // EegViewer shows its own loading/success toast once mounted, so this just
      // detects the format and surfaces errors.
      setPendingEegFiles([]);
      setEegHint(null);
      setIsLoading(true);
      try {
        setEeg(await detectAndLoadEEG(deduped));
      } catch (err) {
        toast.error(`Error loading EEG:\n${err.message}`);
      } finally {
        setIsLoading(false);
      }
    } else if (formatName) {
      // Partial match or name mismatch — hold files and show what's wrong
      setPendingEegFiles(deduped);
      setEegHint(warning ?? `${formatName} also requires: ${missing.join(', ')}`);
    } else {
      // No recognized format at all
      setPendingEegFiles([]);
      setEegHint(null);
      toast.error(`Unrecognized EEG format.\nSupported: BrainVision (.vhdr + .eeg)`);
    }
  };

  // Handler for when imaging files are dropped or selected. It reads the files as ArrayBuffers and prepares them for visualization, updating state accordingly.
  // NiiViewer shows its own loading/success toast once mounted, so this just sets layers and surfaces errors.
  const handleNiiFiles = async (files) => {
    setIsLoading(true);
    try {
      const result = await Promise.all(filesToLayers(files));
      setLayers(result);
    } catch (err) {
      toast.error(`Error loading imaging data:\n${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLoadDemo = async () => {
    setIsLoading(true);
    setIsDemoloading(true);
    // Create ready promises before setting state — the viewers resolve them once fully rendered
    const eegReady = new Promise((resolve) => {
      eegReadyResolveRef.current = resolve;
    });
    const niiReady = new Promise((resolve) => {
      niiReadyResolveRef.current = resolve;
    });
    try {
      const base = import.meta.env.BASE_URL; // base is the public folder in Vite, so demo_data is at `${base}demo_data/...`
      await toast.promise(
        (async () => {
          // Load and set EEG
          const result = await loadBrainVisionEEG(base + DEMO_EEG.header, base + DEMO_EEG.data);
          setEeg(result);
          // Load and set layers
          setLayers(DEMO_LAYERS);
          await Promise.all([eegReady, niiReady]);
        })(),
        {
          loading: 'Loading demo data…',
          success: 'Demo data loaded!',
          error: (err) => `Error loading demo data:\n${err.message}`,
        }
      );
    } finally {
      setIsLoading(false);
      setIsDemoloading(false);
    }
  };

  // Resets both viewers, returning to the empty drop zone state.
  const handleReset = () => {
    setEeg(null);
    setLayers([]);
    setPendingEegFiles([]);
    setEegHint(null);
    setCustomElectrodes([]);
    setCustomElecPosFileName(null);
    setIntracranialElectrodes(null);
    setRecordingType('eeg');
  };

  const handleEegReset = () => {
    setEeg(null);
    setPendingEegFiles([]);
    setEegHint(null);
    setCustomElectrodes([]);
    setCustomElecPosFileName(null);
    setRecordingType('eeg');
    setIntracranialElectrodes(null);
  };

  const handleNiiReset = () => {
    setLayers([]);
  };

  return (
    <FullWidthLayout>
      {/* Top bar: 3-column flex row so the title is always geometrically between the left buttons and right toggle */}
      <div className="shrink-0 flex items-start border-b border-border">
        {/* Left column: Back + Load Demo in normal flow — top bar never scrolls so fixed isn't needed */}
        <div className="shrink-0 flex flex-col items-start gap-2 px-5 py-3 z-10">
          <Link to="/" className="button flex items-center gap-2 px-3 py-1">
            <ArrowLeft size={16} /> Back
          </Link>
          <button
            type="button"
            className="button px-3 py-1"
            onClick={
              eeg || layers.length > 0 || pendingEegFiles.length > 0 ? handleReset : handleLoadDemo
            }
            disabled={isLoading}
            title={
              isDemoloading
                ? 'Loading demo data…'
                : eeg || layers.length > 0 || pendingEegFiles.length > 0
                  ? 'Reset both viewers'
                  : 'Load demo data to test VIDEPE without needing your own files'
            }
          >
            {isDemoloading
              ? 'Loading…'
              : eeg || layers.length > 0 || pendingEegFiles.length > 0
                ? 'Reset'
                : 'Load Demo'}
          </button>
        </div>

        {/* Center column: title always stays between the two side columns */}
        <div className="flex-1 min-w-0 flex flex-col items-center justify-center py-2 text-center select-none pointer-events-none">
          <h1 className="!mb-3">VIDEPE</h1>
          <p className="text-sm text-foreground/70 py-2">
            <span className="font-bold">V</span>isualization & <span className="font-bold">I</span>
            ntegration of <span className="font-bold">D</span>ata for{' '}
            <span className="font-bold">E</span>pilepsy <span className="font-bold">P</span>
            resurgical <span className="font-bold">E</span>valuation
          </p>
          <span className="text-xs text-foreground/40 border border-border/60 rounded-full px-2 py-0.5">
            In Development
          </span>
        </div>

        {/* Right column: ThemeToggle rendered inline (not fixed) — top bar never scrolls so fixed isn't needed,
            and inline keeps it locked to the layout as the window resizes */}
        <div className="shrink-0 flex items-start px-5 py-3">
          <ThemeToggle className="" />
        </div>
      </div>

      <SplitPane
        leftLabel={
          eeg ? (
            <EEGTypeToggle recordingType={recordingType} onChange={setRecordingType} />
          ) : (
            <span className={PANEL_TITLE_CLASS}>EEG</span>
          )
        }
        rightLabel={<span className={PANEL_TITLE_CLASS}>Neuroimaging</span>}
        onLeftReset={eeg || pendingEegFiles.length > 0 ? handleEegReset : undefined}
        onRightReset={layers.length > 0 || connectomeLayer ? handleNiiReset : undefined}
        onMaximizeChange={setMaximizedPanel}
        left={
          eeg ? (
            <EegViewer
              nvRef_eegtopo={nvRef_eegtopo}
              provider={eeg}
              channelNames={eeg.channelNames}
              onViewReady={() => eegReadyResolveRef.current?.()} // charts ready
              onTopoNvReady={handleTopoNvReady} // topo canvas ready
              customElectrodes={customElectrodes}
              customElecPosFileName={customElecPosFileName}
              recordingType={recordingType}
              onRecordingTypeChange={setRecordingType}
              onElecPosFile={handleElecPosFile}
              onIntracranialElectrodesChange={setIntracranialElectrodes}
            />
          ) : (
            <div className="h-full p-2">
              <FileDropZone
                onFiles={handleEegFiles}
                accepted_formats=".vhdr,.eeg,.elc,.tsv"
                label="Drop EEG files"
                description="BrainVision: .vhdr + .eeg (+ optional .elc/.tsv electrode positions)"
                pendingFiles={pendingEegFiles}
                hint={eegHint}
                className="h-full min-h-48"
              />
            </div>
          )
        }
        right={
          layers.length > 0 || connectomeLayer ? (
            <NiiViewer
              nvRef={nvRef_niiviewer}
              layers={layers}
              connectomeLayer={connectomeLayer}
              isFullscreen={maximizedPanel === 'right'}
              onViewReady={() => niiReadyResolveRef.current?.()}
              onNiiNvReady={() => setNiiNvReady(true)}
            />
          ) : (
            <div className="h-full p-2">
              <FileDropZone
                onFiles={handleNiiFiles}
                accepted_formats=".nii,.nii.gz,.mgh,.mgz,.gii,.ply,.obj"
                label="Drop imaging files"
                description="Volumes: NIfTI, MGH, GIFTI, PLY, OBJ, …"
                className="h-full min-h-48"
              />
            </div>
          )
        }
      />
    </FullWidthLayout>
  );
};
