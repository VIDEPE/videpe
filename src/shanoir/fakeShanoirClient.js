import { zipSync } from 'fflate';

const BASE = `${import.meta.env.BASE_URL}demo_data/`;

// Pretend examination: dataset id → the demo files in its ZIP, as paths in demo_data (BIDS
// layout). This preview serves the scalp EEG demo; the host-app preview serves the iEEG one,
// so both demos can be tested through a launch.
const DATASETS = [
  {
    id: 1,
    name: 'Shanoir EEG demo',
    type: 'EEG',
    files: [
      'eeg/sub-synth_task-rest_desc-spkavgall_eeg.vhdr',
      'eeg/sub-synth_task-rest_desc-spkavgall_eeg.eeg',
    ],
  },
  { id: 2, name: 'Shanoir T1W demo', type: 'MR', files: ['anat/sub-synth_T1w.nii.gz'] },
  // The demo segmentations, each its own dataset like in Shanoir
  {
    id: 4,
    name: 'Shanoir white matter demo',
    type: 'SEGMENTATION',
    files: ['anat/sub-synth_label-WM_dseg.nii.gz'],
  },
  {
    id: 5,
    name: 'Shanoir atlas demo',
    type: 'SEGMENTATION',
    files: ['anat/sub-synth_atlas-L2018_res-scale2_dseg.nii.gz'],
  },
  // Unsupported type: skipped before downloading, so its file is never fetched (and doesn't exist)
  { id: 3, name: 'Shanoir dummy demo', type: 'DUMMY', files: ['dummy.bak'] },
  // more: a second EEG dataset (with a lower id), to trigger the "older EEG recording" reason in the "skipped" toast
];

// a Promise that resolves after `ms` milliseconds, so it can be awaited
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Same methods as createShanoirClient, minus parameters this fake doesn't need (JavaScript
// ignores extra arguments, so callers can still pass them).
export function createFakeShanoirClient({ delayMs = 1000 } = {}) {
  return {
    async listExaminationDatasets() {
      // The examination's datasets as { id, name, type }, like Shanoir's DatasetDTOs
      // (without `files`, which only this fake uses to know what goes in each ZIP)
      return DATASETS.map((d) => ({ id: d.id, name: d.name, type: d.type }));
    },
    // No processings in this fake: the demo segmentations above are listed as the
    // examination's own datasets instead of as processed outputs
    async listProcessingsByInputDataset() {
      return [];
    },
    async listProcessingOutputDatasets() {
      return [];
    },
    async getExamination(examinationId) {
      // The examination, with the names of its attached files (electrodes, inverse solution);
      // these are downloaded one by one through downloadExtraData
      return {
        id: examinationId,
        extraDataFilePathList: [
          'sub-synth_electrodes.tsv',
          'sub-synth_desc-eloreta_inversefilters.mat',
        ],
      };
    },
    async downloadDatasetZip(datasetId, signal) {
      const dataset = DATASETS.find((d) => d.id === datasetId);
      if (!dataset) throw new Error(`Dataset ${datasetId} not found`);

      // simulate network delay for downloading
      await wait(delayMs);

      // fetch every file of the dataset in parallel, as [fileName, bytes] pairs
      const entries = await Promise.all(
        dataset.files.map(async (path) => {
          const fileName = path.split('/').pop(); // the ZIP holds just the files, no folders
          const result = await fetch(BASE + path, { signal });
          if (!result.ok) throw new Error(`Failed to fetch ${fileName}: ${result.status}`);
          // One [fileName, bytes] pair, the input format Object.fromEntries expects
          return [fileName, new Uint8Array(await result.arrayBuffer())];
        })
      );
      // { 'a.vhdr': bytes, 'a.eeg': bytes } → ZIP, returned as a Blob like the real server sends
      return new Blob([zipSync(Object.fromEntries(entries))]);
    },

    async downloadExtraData(examinationId, fileName, signal) {
      // the extra data (electrodes, inverse solution) are the EEG demo's, in demo_data/eeg
      const response = await fetch(`${BASE}eeg/${fileName}`, { signal });
      if (!response.ok) throw new Error(`Failed to fetch ${fileName}: ${response.status}`);
      return new File([await response.blob()], fileName);
    },
  };
}
