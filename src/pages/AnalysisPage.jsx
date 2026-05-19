import { FullWidthLayout } from '../components/FullWidthLayout';
import { ThemeToggle } from '../components/ThemeToggle';
import { EegViewer } from '../components/EegViewer';
import { NiiViewer } from '../components/NiiViewer';
import { type } from '@testing-library/user-event/dist/cjs/utility/type.js';

// Sample data — replace with real EEG data
const N = 1000;
const fs = 256; // samples per second
const t = Array.from({ length: N }, (_, i) => i / fs);

const sampleData = [
  t,
  t.map((x) => Math.sin(2 * Math.PI * 6 * x) * 50 + Math.random() * 10),
  t.map((x) => Math.sin(2 * Math.PI * 8 * x) * 40 + Math.random() * 20),
  t.map((x) => Math.sin(2 * Math.PI * 10 * x) * 60 + Math.random() * 30),
  t.map((x) => Math.cos(2 * Math.PI * 12 * x) * 35 + Math.random() * 40),
];

const channelNames = ['ch1', 'ch2', 'ch3', 'ch4'];

// Sample NIfTI image URL \
// TODO: replace with loader that points to your .nii.gz file
const mri = {
  url: 'dataset1/IRM/patT1.nii',
  colormap: 'gray',
  type: 'MRI',
}; // needs to be located in /public => served as absolute path by Vite
const pet = {
  url: 'dataset1/MN/pat_PET_aligned.nii',
  colormap: 'viridis',
  type: 'PET',
};
const spect = {
  url: 'dataset1/MN/pat_siscom_17-13.nii',
  urlImgType: 'nii',
  colormap: 'hot',
  type: 'SPECT',
};

const niiVolumeList = [mri, pet, spect];

export const AnalysisPage = () => {
  return (
    <FullWidthLayout>
      <ThemeToggle />
      <h1>Analysis Page</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4">
        <div className="text-center">
          <h2>EMG Analysis (dummy data)</h2>
          <EegViewer data={sampleData} channelNames={channelNames} width={600} />
        </div>
        <div className="text-center">
          <h2>MRI + PET + Spect</h2>
          <NiiViewer volumes={niiVolumeList} />
        </div>
      </div>
    </FullWidthLayout>
  );
};
