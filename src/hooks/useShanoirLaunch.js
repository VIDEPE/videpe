// New src/hooks/useShanoirLaunch.js: modelled on src/hooks/useDemoData.js (same setIsLoading, the eegReadyResolveRef/niiReadyResolveRef ready promises, one toast.promise).
// For EEG datasets: unzip, then handleEegFiles(files) from src/hooks/useEegFileIntake.js. It already routes .vhdr/.eeg, electrode .tsv/.elc and inverse .mat in one call, using detectAndLoadEEG in src/loaders/eegFormatRegistry.js. loadBrainVisionEEG already reads Files with File.slice.
// Filter .tsv before handing files over. BIDS folders also contain _channels.tsv / _events.tsv, and useEegFileIntake routes every .tsv to the electrode parser (ELEC_POS_EXTENSIONS). Pass only *_electrodes.tsv and .elc, and ignore other .tsv files. .mat goes through unchanged (inverse solution).
// Examination extra-data: read extraDataFilePathList from GET /shanoir-ng/datasets/examinations/{examinationId}. Download *_electrodes.tsv, .elc and .mat entries via GET /shanoir-ng/datasets/examinations/extra-data-download/{examinationId}/{fileName}/ and pass them to handleEegFiles the same way (see "Electrode positions" below).
// For imaging datasets (Mr, Pet, …): download with format=nii, unzip, then filesToLayers(files) from src/utils/NiiViewer.utils.js (it handles NIfTI and in-browser DICOM), then setLayers.
// Ignore other types with a toast note.


import { useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import { loadBrainVisionEEG } from '@/loaders/loadEEGBrainVision';
import { detectVolumeType } from '@/utils/NiiViewer.utils';
import { unzipToFiles } from '@/loaders/unzipToFiles'

// const DEMO_EEG = {
//   header: 'demo_data/sub-synth_task-rest_desc-spkavgall_eeg.vhdr',
//   data: 'demo_data/sub-synth_task-rest_desc-spkavgall_eeg.eeg',
//   elec_pos: 'demo_data/sub-synth_electrodes.tsv',
//   invers_solution: 'demo_data/sub-synth_desc-unitnoiselcmv_inversefilters.mat',
// };

// const DEMO_LAYERS = [
//   { url: 'demo_data/sub-synth_T1w.nii.gz', ...detectVolumeType('sub-synth_T1w.nii.gz') },
//   {
//     url: 'demo_data/sub-synth_label-WM_dseg.nii.gz',
//     ...detectVolumeType('sub-synth_label-WM_dseg.nii.gz'),
//   },
//   {
//     url: 'demo_data/sub-synth_label-CSF_dseg.nii.gz',
//     ...detectVolumeType('sub-synth_label-CSF_dseg.nii.gz'),
//   },
// ];

/**
 * Fetches a zip file by URL and wraps it as a array of Files, so the data from Shanoir can feed the same
 * parseElectrodePositionFile/parseInverseSolutionFieldtrip entry points used by file drops.
 *
 * @param {string} url - path to the bundled zip file, relative to the public folder.
 * @returns {Promise<Files>} an array of fetched bytes wrapped as a File, named after the URL's
 *   last path segment (e.g. 'sub-synth_electrodes.tsv').
 */
async function fetchZipAsFiles(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
  const zipBlob = await response.blob();
  return unzipToFiles(zipBlob)
}

/**
 * Loads the zipped Shanoir recording, electrode positions, inverse solution, and
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
export function useShanoirData({
  setEeg,
  setLayers,
  handleElecPosFile,
  handleInverseSolutionFile,
  setIsLoading,
  eegReadyResolveRef,
  niiReadyResolveRef,
}) {
  const [isShanoirLoading, setIsShanoirLoading] = useState(false);

  /**
   * Fetches and loads Shanoir data zip files, routing each piece through the same handlers a
   * manual file drop would use. Wrapped in `toast.promise` so the user sees a single
   * loading → success/error toast for the whole sequence, rather than one per file.
   *
   * @returns {Promise<void>} Resolves once both EegViewer and NiiViewer report (via
   *   eegReadyResolveRef/niiReadyResolveRef) that they've finished rendering the loaded
   *   data. Doesn't return a value — callers observe the outcome through this hook's
   *   `isDemoLoading` return value and the loaded `eeg`/`layers` state it updates.
   */
  const handleLoadShanoir = useCallback(async () => {
    setIsLoading(true);
    setIsShanoirLoading(true);
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
        // createShanoirClient({ apiBase, getAccessToken }) from the launch context
        // fetch shanoir examination
        const { eegFiles, imagingFiles, skipped } = fetchShanoirExamination({ client, examinationId, signal })
        if (eegFiles.length > 0) await handleEegFiles(eegFiles)
        if (imagingFiles.length > 0) setLayers(await filesToLayers(imagingFiles))
        if (skipped.length > 0) toast(`Skipped the following datasets: ${skipped}.`, {
            icon: '⚠️',
          });
        // // await only the ready promises for the viewers you actually gave data to
        // // toast the skippedDatasets, if any
        //   // Load and set EEG
        //   const result = await loadBrainVisionEEG(base + DEMO_EEG.header, base + DEMO_EEG.data);
        //   setEeg(result);
        //   // Load and set electrode positions and inverse solution, via the same handlers
        //   // file drops use, so they reach EegViewer/ESI exactly as a manual drop would.
        //   const elecPosFile = await fetchAsZipFiles(base + DEMO_EEG.elec_pos);
        //   await handleElecPosFile(elecPosFile);
        //   const inverseSolutionFile = await fetchAsZipFiles(base + DEMO_EEG.invers_solution);
        //   await handleInverseSolutionFile(inverseSolutionFile);
        //   // Load and set layers
        //   setLayers(DEMO_LAYERS);
        //   await Promise.all([eegReady, niiReady]);
        // })(),
        // {
        //   loading: 'Loading demo data…',
        //   success: 'Demo data loaded!',
        //   error: (err) => `Error loading demo data:\n${err.message}`,
        }
      );
    } finally {
      setIsLoading(false);
      setIsShanoirLoading(false);
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

  return { isDemoLoading: isShanoirLoading, handleLoadDemo: handleLoadShanoir };
}
