import { useState } from 'react';
import { FullWidthLayout } from '../components/FullWidthLayout';
import { ThemeToggle } from '../components/ThemeToggle';
import { EegViewer } from '../components/EegViewer';
import { NiiViewer } from '../components/NiiViewer';
import { loadBrainVisionEEG } from '../loaders/loadBrainVisionEEG';

const DEMO_EEG = {
  header: 'dataset1/EEG/sub-19_task-rest_desc-cleaned_eeg.vhdr',
  data:   'dataset1/EEG/sub-19_task-rest_desc-cleaned_eeg.eeg',
};

const DEMO_VOLUMES = [
  { url: 'dataset1/IRM/patT1.nii',              colormap: 'gray',    type: 'MRI'   },
  { url: 'dataset1/MN/pat_PET_aligned.nii',     colormap: 'viridis', type: 'PET'   },
  { url: 'dataset1/MN/pat_siscom_17-13.nii',    colormap: 'hot',     type: 'SPECT', urlImgType: 'nii' },
];

export const AnalysisPage = () => {
  const [eeg, setEeg] = useState(null);           // { data, channelNames }
  const [volumes, setVolumes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleLoadDemo = async () => {
    setLoading(true);
    setError(null);
    try {
      const base = import.meta.env.BASE_URL;
      const result = await loadBrainVisionEEG(
        base + DEMO_EEG.header,
        base + DEMO_EEG.data,
      );
      setEeg(result);
      setVolumes(DEMO_VOLUMES);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <FullWidthLayout>
      {/* Top bar: load actions on the left, theme toggle on the right */}
      <div className="shrink-0 flex items-center justify-between px-4 py-2 border-b border-border mt-8">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="thin-button px-3 py-1"
            onClick={handleLoadDemo}
            disabled={loading}
          >
            {loading ? 'Loading…' : 'Load Demo'}
          </button>
          {/* Future: "Load EEG…" and "Load MRI…" file-picker buttons go here */}
          {error && <span className="text-sm text-red-500">{error}</span>}
        </div>
        <ThemeToggle />
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2 gap-4 p-4">
        <div className="flex flex-col min-h-0">
          <h2 className="text-center shrink-0">EEG</h2>
          {eeg
            ? <EegViewer data={eeg.data} channelNames={eeg.channelNames} />
            : <p className="m-auto text-muted-foreground text-sm">Press Load Demo to load data</p>
          }
        </div>
        <div className="flex flex-col min-h-0 text-center">
          <h2 className="shrink-0">MRI + PET + SPECT</h2>
          {volumes.length > 0
            ? <NiiViewer volumes={volumes} />
            : <p className="m-auto text-muted-foreground text-sm">Press Load Demo to load data</p>
          }
        </div>
      </div>
    </FullWidthLayout>
  );
};
