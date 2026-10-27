const BASE = `${import.meta.env.BASE_URL}demo_data/`;

// Pretend launch: the files a host app would hand over, as getSession returns them
const SESSION = {
  title: 'Synthetic demo patient',
  files: [
    'sub-synth_task-rest_desc-spkavgall_eeg.vhdr',
    'sub-synth_task-rest_desc-spkavgall_eeg.eeg',
    // .vmrk is not opened by any viewer: skipped before downloading, so its file is never fetched
    // (and doesn't exist) — shows the "skipped" toast
    'sub-synth_task-rest_desc-spkavgall_eeg.vmrk',
    'sub-synth_electrodes.tsv',
    'sub-synth_desc-eloreta_inversefilters.mat',
    'sub-synth_T1w.nii.gz',
    'sub-synth_label-WM_dseg.nii.gz',
    'sub-synth_atlas-L2018_res-scale1_dseg.nii.gz',
    // Unsupported file, like fakeShanoirClient's dummy dataset: also skipped before
    // downloading, so it's never fetched (and doesn't exist)
    'dummy.bak',
  ].map((name) => ({ name, url: BASE + name })),
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
