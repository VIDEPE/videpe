import { useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import { loadBrainVisionEEG } from '../loaders/loadEEGBrainVision';
import { detectVolumeType } from '../utils/NiiViewer.utils';

const DEMO_EEG = {
  header: 'demo_data/sub-synth_task-rest_desc-spkavgall_eeg.vhdr',
  data: 'demo_data/sub-synth_task-rest_desc-spkavgall_eeg.eeg',
  elec_pos: 'demo_data/sub-synth_electrodes.tsv',
  invers_solution: 'demo_data/sub-synth_desc-unitnoiselcmv_inversefilters.mat',
};

const DEMO_LAYERS = [
  { url: 'demo_data/sub-synth_T1w.nii.gz', ...detectVolumeType('sub-synth_T1w.nii.gz') },
  {
    url: 'demo_data/sub-synth_label-WM_dseg.nii.gz',
    ...detectVolumeType('sub-synth_label-WM_dseg.nii.gz'),
  },
  {
    url: 'demo_data/sub-synth_label-CSF_dseg.nii.gz',
    ...detectVolumeType('sub-synth_label-CSF_dseg.nii.gz'),
  },
];

/**
 * Fetches a demo file by URL and wraps it as a File, so demo loading can feed the same
 * parseElectrodePositionFile/parseInverseSolutionFieldtrip entry points used by file drops.
 *
 * @param {string} url - path to the bundled demo file, relative to the public folder.
 * @returns {Promise<File>} the fetched bytes wrapped as a File, named after the URL's
 *   last path segment (e.g. 'sub-synth_electrodes.tsv').
 */
async function fetchAsFile(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
  const blob = await response.blob();
  return new File([blob], url.split('/').pop());
}

/**
 * Loads the bundled demo EEG recording, electrode positions, inverse solution, and
 * imaging volumes — via the same handlers a manual file drop would use, so the demo
 * path exercises exactly the same downstream logic (EegViewer, ESI, etc.) as real data.
 *
 * @param {Object} params
 * @param {(eeg: object) => void} params.setEeg
 *   Called with the loaded demo EEG recording, same setter a real file drop would use.
 * @param {(layers: object[]) => void} params.setLayers
 *   Called with the demo imaging volumes (T1w scan plus white-matter and CSF
 *   segmentations) once the EEG side has finished loading.
 * @param {(file: File) => Promise<void>} params.handleElecPosFile
 *   The electrode-position handler from useEegFileIntake. Called here with the demo
 *   electrode-positions file (wrapped via fetchAsFile), so it's parsed exactly like a
 *   manually dropped file would be.
 * @param {(file: File) => Promise<void>} params.handleInverseSolutionFile
 *   The inverse-solution handler from useElectricalSourceImaging. Called here with the
 *   demo inverse-solution file, same reasoning as handleElecPosFile above.
 * @param {(loading: boolean) => void} params.setIsLoading
 *   Called with `true` for the duration of the whole demo load, and `false` once it
 *   finishes (whether it succeeded or failed) — the same flag real file loads use.
 * @param {{ current: (() => void)|null }} params.eegReadyResolveRef
 *   Ref that this hook assigns a resolver function into before starting the load.
 *   EegViewer calls that resolver once its charts have actually finished rendering the
 *   demo data, so this hook can tell the difference between "data was set" and "the
 *   viewer is ready to be shown."
 * @param {{ current: (() => void)|null }} params.niiReadyResolveRef
 *   Same pattern as eegReadyResolveRef, but for NiiViewer finishing to render the demo
 *   imaging volumes.
 * @returns {Object} The demo-loading state and its trigger function:
 *   - `isDemoLoading` (boolean) — true for the duration of a demo load; lets the caller
 *     show a distinct "Loading…" label on the button that triggers it.
 *   - `handleLoadDemo` () => Promise<void> — fetches and loads all the demo data
 *     described above, resolving once both viewers report they've finished rendering it.
 */
export function useDemoData({
  setEeg,
  setLayers,
  handleElecPosFile,
  handleInverseSolutionFile,
  setIsLoading,
  eegReadyResolveRef,
  niiReadyResolveRef,
}) {
  const [isDemoLoading, setIsDemoLoading] = useState(false);

  /**
   * Fetches and loads the full demo dataset (EEG recording, electrode positions,
   * inverse solution, imaging volumes), routing each piece through the same handlers a
   * manual file drop would use. Wrapped in `toast.promise` so the user sees a single
   * loading → success/error toast for the whole sequence, rather than one per file.
   *
   * @returns {Promise<void>} Resolves once both EegViewer and NiiViewer report (via
   *   eegReadyResolveRef/niiReadyResolveRef) that they've finished rendering the loaded
   *   data. Doesn't return a value — callers observe the outcome through this hook's
   *   `isDemoLoading` return value and the loaded `eeg`/`layers` state it updates.
   */
  const handleLoadDemo = useCallback(async () => {
    setIsLoading(true);
    setIsDemoLoading(true);
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
          // Load and set electrode positions and inverse solution, via the same handlers
          // file drops use, so they reach EegViewer/ESI exactly as a manual drop would.
          const elecPosFile = await fetchAsFile(base + DEMO_EEG.elec_pos);
          await handleElecPosFile(elecPosFile);
          const inverseSolutionFile = await fetchAsFile(base + DEMO_EEG.invers_solution);
          await handleInverseSolutionFile(inverseSolutionFile);
          // Load and set layers
          setLayers(DEMO_LAYERS);
          await Promise.all([eegReady, niiReady]);
        })(),
        {
          loading: 'Loading demo data…',
          success: 'Demo data loaded!',
          error: (err) => `Error loading demo data:\n${err.message}`,
        }
      );
    } finally {
      setIsLoading(false);
      setIsDemoLoading(false);
    }
  }, [
    setEeg,
    setLayers,
    handleElecPosFile,
    handleInverseSolutionFile,
    setIsLoading,
    eegReadyResolveRef,
    niiReadyResolveRef,
  ]);

  return { isDemoLoading, handleLoadDemo };
}
