import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { FullWidthLayout } from '../components/FullWidthLayout';
import { ThemeToggle } from '../components/ThemeToggle';
import { EegViewer } from '../components/EegViewer';
import { NiiViewer } from '../components/NiiViewer';
import { loadBrainVisionEEG } from '../loaders/loadBrainVisionEEG';
import { detectAndLoadEEG } from '../loaders/eegFormats';
import { FileDropZone } from '../components/FileDropZone';

const DEMO_EEG = {
  header: 'dataset1/EEG/sub-19_task-rest_desc-cleaned_eeg.vhdr',
  data: 'dataset1/EEG/sub-19_task-rest_desc-cleaned_eeg.eeg',
};

const DEMO_VOLUMES = [
  { url: 'dataset1/IRM/patT1.nii', colormap: 'gray', type: 'MRI' },
  { url: 'dataset1/MN/pat_PET_aligned.nii', colormap: 'viridis', type: 'PET' },
  { url: 'dataset1/MN/pat_siscom_17-13.nii', colormap: 'hot', type: 'SPECT', urlImgType: 'nii' },
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
  const [loading, setLoading] = useState(false);

  // Handler for when EEG files are dropped or selected. It tries to detect the format and load the data, updating state accordingly.
  const handleEegFiles = async (files) => {
    setLoading(true);
    try {
      setEeg(await detectAndLoadEEG(Array.from(files)));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Handler for when imaging files are dropped or selected. It reads the files as ArrayBuffers and prepares them for the NiiViewer, updating state accordingly.
  const handleNiiFiles = async (files) => {
    setLoading(true);
    try {
      const vols = await Promise.all(
        Array.from(files).map(async (f) => ({
          url: f.name,
          buffer: await f.arrayBuffer(),
          colormap: 'gray',
          type: f.name,
        }))
      );
      setVolumes(vols);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLoadDemo = async () => {
    setLoading(true);
    try {
      const base = import.meta.env.BASE_URL;
      const result = await loadBrainVisionEEG(base + DEMO_EEG.header, base + DEMO_EEG.data);
      setEeg(result);
      setVolumes(DEMO_VOLUMES);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <FullWidthLayout>
      {/* Top bar: load actions on the left, theme toggle on the right */}
      <div className="shrink-0 relative flex items-center justify-between px-4 py-2 border-b border-border mt-8">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="thin-button px-3 py-1"
            onClick={handleLoadDemo}
            disabled={loading}
          >
            {loading ? 'Loading…' : 'Load Demo'}
          </button>
        </div>
        <h1 className="absolute left-1/2 -translate-x-1/2 pb-8 text-lg font-semibold pointer-events-none">
          Patient Viewer
        </h1>
        <ThemeToggle />
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2 gap-4 p-4">
        <div className="flex flex-col min-h-0">
          <h2 className="text-center shrink-0">EEG</h2>
          {eeg ? (
            <EegViewer data={eeg.data} channelNames={eeg.channelNames} />
          ) : (
            <FileDropZone
              onFiles={handleEegFiles}
              accepted_formats=".vhdr,.eeg"
              label="Drop EEG files"
              description="BrainVision: .vhdr + .eeg"
            />
          )}
        </div>
        <div className="flex flex-col min-h-0 text-center">
          <h2 className="shrink-0">Neural Imaging</h2>
          {volumes.length > 0 ? (
            <NiiViewer volumes={volumes} />
          ) : (
            <FileDropZone
              onFiles={handleNiiFiles}
              accepted_formats=".nii,.nii.gz,.mgh,.mgz,.gii,.ply,.obj"
              label="Drop imaging files"
              description="Volumes: NIfTI, MGH, GIFTI, PLY, OBJ, …"
            />
          )}
        </div>
      </div>
    </FullWidthLayout>
  );
};
