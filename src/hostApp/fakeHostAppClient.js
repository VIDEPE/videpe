const BASE = `${import.meta.env.BASE_URL}demo_data/`;

// Pretend launch: the files a host app would hand over, as getSession returns them, from their
// paths in demo_data (BIDS layout). This preview serves the intracranial iEEG demo; the Shanoir
// preview serves the scalp EEG one, so both demos can be tested through a launch.
const SESSION = {
  title: 'Synthetic iEEG demo patient',
  files: [
    'ieeg/sub-synth_task-rest_desc-spkavgall_ieeg.vhdr',
    'ieeg/sub-synth_task-rest_desc-spkavgall_ieeg.eeg',
    // .vmrk is not opened by any viewer: skipped before downloading, so its file is never
    // fetched — shows the "skipped" toast
    'ieeg/sub-synth_task-rest_desc-spkavgall_ieeg.vmrk',
    'ieeg/sub-synth_electrodes.tsv',
    'anat/sub-synth_T1w.nii.gz',
    'anat/sub-synth_label-WM_dseg.nii.gz',
    'anat/sub-synth_atlas-L2018_res-scale2_dseg.nii.gz',
    // Unsupported file, like fakeShanoirClient's dummy dataset: also skipped before
    // downloading, so it's never fetched (and doesn't exist)
    'dummy.bak',
  ].map((path) => ({ name: path.split('/').pop(), url: BASE + path })),
};

// a Promise that resolves after `ms` milliseconds, so it can be awaited
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Same methods as createHostAppClient, serving the demo data instead of a host app's API, for
// the ?preview=hostapp dev preview (see main.jsx)
export function createFakeHostAppClient({ delayMs = 1000 } = {}) {
  return {
    async getSession() {
      return SESSION;
    },

    async downloadFile(file, signal) {
      // simulate network delay for downloading
      await wait(delayMs);
      const response = await fetch(file.url, { signal });
      if (!response.ok) throw new Error(`Failed to fetch ${file.name}: ${response.status}`);
      return new File([await response.blob()], file.name);
    },
  };
}
