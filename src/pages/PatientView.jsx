import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { FullWidthLayout } from '../components/FullWidthLayout';
import { ThemeToggle } from '../components/ThemeToggle';
import { EegViewer } from '../components/EegViewer';
import { NiiViewer } from '../components/NiiViewer';
import { SplitPane } from '../components/SplitPane';
import { loadBrainVisionEEG } from '../loaders/loadBrainVisionEEG';
import { detectAndLoadEEG, checkEegFiles } from '../loaders/eegFormats';
import { FileDropZone } from '../components/FileDropZone';

const DEMO_EEG = {
  header: 'demo_data/sub-synth_task-rest_eeg.vhdr',
  data: 'demo_data/sub-synth_task-rest_eeg.eeg',
};

const DEMO_VOLUMES = [
  { url: 'demo_data/patT1.nii', colormap: 'gray', type: 'MRI' },
  { url: 'demo_data/pat_PET_aligned.nii', colormap: 'viridis', type: 'PET' },
  { url: 'demo_data/pat_siscom_17-13.nii', colormap: 'hot', type: 'SPECT', urlImgType: 'nii' },
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
  const [pendingEegFiles, setPendingEegFiles] = useState([]);
  const [eegHint, setEegHint] = useState(null);

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
    try {
      const result = await toast.promise(
        Promise.all(
          Array.from(files).map((f) => ({
            // NiiVue calls fetch(url) internally, so a blob: URL is needed — a plain filename would resolve as a relative HTTP request
            url: URL.createObjectURL(f),
            name: f.name,
            colormap: 'gray',
            type: f.name,
          }))
        ),
        {
          loading: 'Loading imaging data…',
          success: 'Imaging data loaded!',
          error: (err) => `Error loading imaging data:\n${err.message}`,
        }
      );
      setVolumes(result);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLoadDemo = async () => {
    setIsLoading(true);
    setIsDemoloading(true);
    try {
      const base = import.meta.env.BASE_URL;
      const result = await toast.promise(
        loadBrainVisionEEG(base + DEMO_EEG.header, base + DEMO_EEG.data),
        {
          loading: 'Loading demo EEG + Imaging data…',
          success: 'Demo data loaded!',
          error: (err) => `Error loading demo EEG + Imaging data:\n${err.message}`,
        }
      );
      setEeg(result);
      setVolumes(DEMO_VOLUMES);
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

  return (
    <FullWidthLayout>
      {/* Top bar: title centered in flow; button and toggle are fixed like ThemeToggle */}
      <div className="shrink-0 flex flex-col items-center py-2 border-b border-border">
        <button
          type="button"
          className="thin-button px-3 py-1 fixed top-5 left-5 z-50"
          onClick={
            eeg || volumes.length > 0 || pendingEegFiles.length > 0 ? handleReset : handleLoadDemo
          }
          disabled={isLoading}
        >
          {isDemoloading
            ? 'Loading…'
            : eeg || volumes.length > 0 || pendingEegFiles.length > 0
              ? 'Reset'
              : 'Load Demo'}
        </button>
        <div className="pointer-events-none text-center">
          <h1 className="!mb-3">VIDEPE</h1>
          <p className="text-sm text-foreground/70 py-2">
            <span className="font-bold">V</span>isualization & <span className="font-bold">I</span>ntegration
            of <span className="font-bold">D</span>ata for <span className="font-bold">E</span>pilepsy{' '}
            <span className="font-bold">P</span>re-surgical <span className="font-bold">E</span>valuation
          </p>
        </div>
        <ThemeToggle />
      </div>

      <SplitPane
        leftLabel="EEG"
        rightLabel="Neuroimaging"
        left={
          eeg ? (
            <EegViewer data={eeg.data} channelNames={eeg.channelNames} />
          ) : (
            <FileDropZone
              onFiles={handleEegFiles}
              accepted_formats=".vhdr,.eeg"
              label="Drop EEG files"
              description="BrainVision: .vhdr + .eeg"
              pendingFiles={pendingEegFiles}
              hint={eegHint}
            />
          )
        }
        right={
          volumes.length > 0 ? (
            <NiiViewer volumes={volumes} />
          ) : (
            <FileDropZone
              onFiles={handleNiiFiles}
              accepted_formats=".nii,.nii.gz,.mgh,.mgz,.gii,.ply,.obj"
              label="Drop imaging files"
              description="Volumes: NIfTI, MGH, GIFTI, PLY, OBJ, …"
            />
          )
        }
      />
    </FullWidthLayout>
  );
};
