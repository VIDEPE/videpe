import { zipSync } from 'fflate';

const BASE = `${import.meta.env.BASE_URL}demo_data/`;

// Pretend examination: dataset id → the demo files in its ZIP
const DATASETS = [
  {
    id: 1,
    name: 'Shanoir demo (EEG)',
    type: 'Eeg',
    files: [
      'sub-synth_task-rest_desc-spkavgall_eeg.vhdr',
      'sub-synth_task-rest_desc-spkavgall_eeg.eeg',
    ],
  },
  { id: 2, name: 'Shanoir demo (T1w)', type: 'Mr', files: ['sub-synth_T1w.nii.gz'] },
  { id: 3, name: 'Shanoir demo (dummy)', type: 'dummy', files: ['dummy.bak'] },
  // more: WM/CSF segmentations, or a second Eeg / an unsupported type to trigger the "skipped" toast
];

// a Promise that resolves after `ms` milliseconds, so it can be awaited
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createFakeShanoirClient({ delayMs = 1000 } = {}) {
  // Delay to simulate real loading
  setTimeout(delayMs);
  return {
    async listExaminationDatasets(examinationId, signal) {
      // The examination's datasets as { id, name, type }, like Shanoir's DatasetDTOs
      // (without `files`, which only this fake uses to know what goes in each ZIP)
      return DATASETS.map(({ files, ...dataset }) => dataset);
    },
    async getExamination(examinationId, signal) {
      // The examination, with the names of its attached files (electrodes, inverse solution);
      // these are downloaded one by one through downloadExtraData
      return {
        id: examinationId,
        extraDataFilePathList: [
          'sub-synth_electrodes.tsv',
          'sub-synth_desc-unitnoiselcmv_inversefilters.mat',
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
        dataset.files.map(async (fileName) => {
          const result = await fetch(BASE + fileName, { signal });
          if (!result.ok) throw new Error(`Failed to fetch ${fileName}: ${result.status}`);
          // One [fileName, bytes] pair, the input format Object.fromEntries expects
          return [fileName, new Uint8Array(await result.arrayBuffer())];
        })
      );
      // { 'a.vhdr': bytes, 'a.eeg': bytes } → ZIP, returned as a Blob like the real server sends
      return new Blob([zipSync(Object.fromEntries(entries))]);
    },

    async downloadExtraData(examinationId, fileName, signal) {
      const response = await fetch(BASE + fileName, { signal });
      if (!response.ok) throw new Error(`Failed to fetch ${fileName}: ${response.status}`);
      return new File([await response.blob()], fileName);
    },
  };
}
