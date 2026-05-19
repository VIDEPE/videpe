import { FullWidthLayout } from '../components/FullWidthLayout';
import { ThemeToggle } from '../components/ThemeToggle';
import { EegViewer } from '../components/EegViewer';
import { NiiViewer } from '../components/NiiViewer';
import { type } from '@testing-library/user-event/dist/cjs/utility/type.js';

// Sample data — replace with real EEG data
const fs = 256; // samples per second
const tMax = 60; // seconds
const N = tMax * fs;
const t = Array.from({ length: N }, (_, i) => i / fs);

const sampleData = [
  t,
  t.map((x) => Math.sin(2 * Math.PI * 1 * x) * 50 + Math.random() * 10),
  t.map((x) => Math.sin(2 * Math.PI * 2 * x) * 40 + Math.random() * 20),
  t.map((x) => Math.sin(2 * Math.PI * 3 * x) * 60 + Math.random() * 30),
  t.map((x) => Math.cos(2 * Math.PI * 4 * x) * 35 + Math.random() * 40),
  t.map((x) => Math.cos(2 * Math.PI * 5 * x) * 35 + Math.random() * 40),
  t.map((x) => Math.cos(2 * Math.PI * 6 * x) * 35 + Math.random() * 40),
  t.map((x) => Math.cos(2 * Math.PI * 7 * x) * 35 + Math.random() * 40),
  t.map((x) => Math.cos(2 * Math.PI * 8 * x) * 35 + Math.random() * 40),
];

const channelNames = sampleData.map((_, i) => 'Ch: ' + i).slice(1); // skip time channel, name channels Ch:1, Ch:2, ...
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
      <h1 className="text-center">Analysis Page (WIP)</h1>

      <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2 gap-4 p-4">
        <div className="flex flex-col min-h-0">
          <h2 className="text-center shrink-0">EMG Analysis (dummy data)</h2>
          <EegViewer data={sampleData} channelNames={channelNames} />
        </div>
        <div className="text-center">
          <h2>MRI + PET + Spect</h2>
          <NiiViewer volumes={niiVolumeList} />
        </div>
      </div>
    </FullWidthLayout>
  );
};
