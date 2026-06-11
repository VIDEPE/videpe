import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import toast from 'react-hot-toast';
import { FullWidthLayout } from '../components/FullWidthLayout';
import { ThemeToggle } from '../components/ThemeToggle';
import { EegViewer } from '../components/EegViewer';
import { NiiViewer } from '../components/NiiViewer';
import { SplitPane } from '../components/SplitPane';
import { loadBrainVisionEEG } from '../loaders/loadBrainVisionEEG';
import { detectAndLoadEEG, checkEegFiles } from '../loaders/eegFormats';
import { FileDropZone } from '../components/FileDropZone';
import { detectVolumeType, filesToVolumes } from '../components/NiiViewer.utils';

const DEMO_EEG = {
  header: 'demo_data/sub-synth_task-rest_eeg.vhdr',
  data: 'demo_data/sub-synth_task-rest_eeg.eeg',
};

const DEMO_VOLUMES = [
  { url: 'demo_data/patT1.nii', ...detectVolumeType('patT1.nii') },
  { url: 'demo_data/pat_PET_aligned.nii', ...detectVolumeType('pat_PET_aligned.nii') },
  {
    url: 'demo_data/pat_siscom_17-13.nii',
    ...detectVolumeType('pat_siscom_17-13.nii'),
    urlImgType: 'nii',
  },
];

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

  const [eeg, setEeg] = useState(null); // { data, channelNames }
  const [volumes, setVolumes] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isDemoloading, setIsDemoloading] = useState(false);
  const eegReadyResolveRef = useRef(null); // set before demo load; EegViewer calls it when charts are ready
  const niiReadyResolveRef = useRef(null); // set before demo load; NiiViewer calls it when volumes are ready
  const [pendingEegFiles, setPendingEegFiles] = useState([]);
  const [eegHint, setEegHint] = useState(null);
  const [maximizedPanel, setMaximizedPanel] = useState(null); // null | 'left' | 'right'

  // Handler for when EEG files are dropped or selected.
  // Files accumulate across drops until all required files for a format are present.
  const handleEegFiles = async (newFiles) => {
    // Merge pending with new files, then keep only the last file per extension so a new drop always replaces the previous file of the same type
    const merged = [...pendingEegFiles, ...Array.from(newFiles)];
    // Create a map of extension to file, keeping only the last file for each extension.
    // This way, if a user drops a new .vhdr file, it will replace the previous .vhdr in the pending state, while still keeping any .eeg file that was dropped before.
    const byExtension = new Map();
    for (const file of merged) {
      const ext = file.name.toLowerCase().match(/(\.[^.]+)$/)?.[1];
      if (ext) byExtension.set(ext, file);
    }
    const deduped = [...byExtension.values()];
    // Check the accumulated files against known EEG formats to determine if we can load or if we need to wait for more files.
    const { formatName, complete, missing, warning } = checkEegFiles(deduped);

    if (complete) {
      // All required files present — clear pending state and load
      setPendingEegFiles([]);
      setEegHint(null);
      setIsLoading(true);
      try {
        const result = await toast.promise(
          Promise.resolve().then(() => detectAndLoadEEG(deduped)),
          {
            loading: 'Loading EEG data…',
            success: 'EEG data loaded!',
            error: (err) => `Error loading EEG:\n${err.message}`,
          }
        );
        setEeg(result);
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
  const handleNiiFiles = async (files) => {
    setIsLoading(true);
    // niiReady resolves once NiiViewer finishes loading the new volumes (see onReady below)
    const niiReady = new Promise((resolve) => {
      niiReadyResolveRef.current = resolve;
    });
    try {
      await toast.promise(
        (async () => {
          const result = await Promise.all(filesToVolumes(files));
          setVolumes(result);
          await niiReady;
        })(),
        {
          loading: 'Loading imaging data…',
          success: 'Imaging data loaded!',
          error: (err) => `Error loading imaging data:\n${err.message}`,
        }
      );
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
          // Load and set volumes
          setVolumes(DEMO_VOLUMES);
          await Promise.all([eegReady, niiReady]);
        })(),
        {
          loading: 'Loading demo EEG + Imaging data…',
          success: 'Demo data loaded!',
          error: (err) => `Error loading demo EEG + Imaging data:\n${err.message}`,
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
    setVolumes([]);
    setPendingEegFiles([]);
    setEegHint(null);
  };

  const handleEegReset = () => {
    setEeg(null);
    setPendingEegFiles([]);
    setEegHint(null);
  };

  const handleNiiReset = () => {
    setVolumes([]);
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
              eeg || volumes.length > 0 || pendingEegFiles.length > 0 ? handleReset : handleLoadDemo
            }
            disabled={isLoading}
            title={
              isDemoloading
                ? 'Loading demo data…'
                : eeg || volumes.length > 0 || pendingEegFiles.length > 0
                  ? 'Reset both viewers'
                  : 'Load demo data to test VIDEPE without needing your own files'
            }
          >
            {isDemoloading
              ? 'Loading…'
              : eeg || volumes.length > 0 || pendingEegFiles.length > 0
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
        leftLabel="EEG"
        rightLabel="Neuroimaging"
        onLeftReset={eeg || pendingEegFiles.length > 0 ? handleEegReset : undefined}
        onRightReset={volumes.length > 0 ? handleNiiReset : undefined}
        onMaximizeChange={setMaximizedPanel}
        left={
          eeg ? (
            <EegViewer
              data={eeg.data}
              channelNames={eeg.channelNames}
              onReady={() => eegReadyResolveRef.current?.()}
            />
          ) : (
            <div className="h-full p-2">
              <FileDropZone
                onFiles={handleEegFiles}
                accepted_formats=".vhdr,.eeg"
                label="Drop EEG files"
                description="BrainVision: .vhdr + .eeg"
                pendingFiles={pendingEegFiles}
                hint={eegHint}
                className="h-full min-h-48"
              />
            </div>
          )
        }
        right={
          volumes.length > 0 ? (
            <NiiViewer
              volumes={volumes}
              isFullscreen={maximizedPanel === 'right'}
              onReady={() => niiReadyResolveRef.current?.()}
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
