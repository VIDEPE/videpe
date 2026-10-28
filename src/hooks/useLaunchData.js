import { useState, useCallback, useEffect, useEffectEvent } from 'react';
import toast from 'react-hot-toast';
import { filesToLayers } from '@/utils/NiiViewer.utils';

/**
 * Loads the files another app hands over when it launches VIDEPE (Shanoir, or a host app
 * such as a local Python app) into the viewers. Shared by every launch mode: each mode only
 * supplies `fetchData`, which gets its files, and this hook does the rest. The files go
 * through the same handlers a manual file drop would use, so launched data exercises exactly
 * the same downstream logic (EegViewer, ESI, etc.) as local files.
 *
 * Modelled on useDemoData (the same eegReadyResolveRef/niiReadyResolveRef ready promises, and
 * one loading → success/error toast for the whole load).
 *
 * @param {Object} params
 * @param {boolean} params.enabled - whether VIDEPE was launched in this mode; when false,
 *   this hook does nothing.
 * @param {string} params.sourceName - names the source in the toasts, e.g. 'Shanoir' →
 *   "Loading Shanoir data…".
 * @param {(signal: AbortSignal) => Promise<{ eegFiles: File[], imagingFiles: File[],
 *   eegName: string|null, warning: string|null }>} params.fetchData
 *   Gets the mode's files, sorted for the two viewers:
 *   - `eegFiles`: for handleEegFiles (recording, electrode positions, inverse solution).
 *   - `imagingFiles`: for filesToLayers (volumes and surface meshes).
 *   - `eegName`: the loaded recording's name, for the EEG panel header, or null.
 *   - `warning`: a finished message for a warning toast (e.g. what was skipped), or null.
 *   Must stay the same function between renders (wrap it in useCallback): a new fetchData
 *   starts a new load.
 * @param {(files: File[]) => Promise<boolean>} params.handleEegFiles
 *   The EEG intake handler from useEegFileIntake. Called once with the EEG files, which it
 *   routes and parses exactly like a drop at the EEG dropzone (it sets the EEG recording
 *   itself); resolves to whether a recording was set.
 * @param {(layers: object[]) => void} params.setLayers
 *   Called with the imaging layers built from the imaging files.
 * @param {(name: string|null) => void} params.setEegName
 *   Called with `eegName`, so the caller can show the user which recording is on screen.
 * @param {{ current: (() => void)|null }} params.eegReadyResolveRef
 *   Ref that this hook assigns a resolver function into before starting the load.
 *   EegViewer calls that resolver once its charts have actually finished rendering the
 *   data, so this hook can tell the difference between "data was set" and "the viewer is
 *   ready to be shown."
 * @param {{ current: (() => void)|null }} params.niiReadyResolveRef
 *   Same pattern as eegReadyResolveRef, but for NiiViewer finishing to render the
 *   imaging volumes.
 * @returns {Object} The loading state. The load itself starts automatically once, when
 *   enabled, and is cancelled when the component unmounts.
 *   - `isLoading` (boolean) — true from the first render of a launch until the data has
 *     loaded (or failed).
 */
export function useLaunchData({
  enabled,
  sourceName,
  fetchData,
  handleEegFiles,
  setLayers,
  setEegName,
  eegReadyResolveRef,
  niiReadyResolveRef,
}) {
  // Starts as true when launched: the page is loading from its very first render.
  // (Switching it on from inside the effect instead would trigger an extra render — React's
  // set-state-in-effect rule.) Only switched off once the load has finished or failed.
  const [isLoading, setIsLoading] = useState(Boolean(enabled));

  /**
   * Gets the files (fetchData), shows the mode's warning if any, then hands the EEG files to
   * handleEegFiles and the imaging files to setLayers — the same handlers a manual file drop
   * would use. Shows a single loading → success/error toast for the whole sequence, rather
   * than one per file.
   *
   * @param {AbortSignal} signal - cancels the load (aborted when the page unmounts).
   * @returns {Promise<void>} Resolves once the viewers that received data (EegViewer and/or
   *   NiiViewer) report, via eegReadyResolveRef/niiReadyResolveRef, that they've finished
   *   rendering it. Never rejects: errors end up in the toast, and a cancelled load just
   *   removes its toast. Callers observe the outcome through this hook's `isLoading`
   *   return value, and the `eeg`/`layers`/EEG-name state the handlers update.
   */
  const handleLoad = useCallback(
    async (signal) => {
      const toastId = toast.loading(`Loading ${sourceName} data…`);

      // Create ready promises before setting state — the viewers resolve them once fully rendered
      const eegReady = new Promise((resolve) => {
        eegReadyResolveRef.current = resolve;
      });
      const niiReady = new Promise((resolve) => {
        niiReadyResolveRef.current = resolve;
      });

      // try to fetch the data
      try {
        const { eegFiles, imagingFiles, eegName, warning } = await fetchData(signal);
        // The download may have finished just as the load was cancelled (e.g. unzipping
        // doesn't listen to the signal): stop here, so a cancelled load never fills the
        // viewers. Throws an AbortError, handled like any other cancellation below.
        signal.throwIfAborted();
        setEegName(eegName ?? null);

        // Display the mode's warning, e.g. which datasets or files have been skipped
        // (react-hot-toast keeps the line breaks)
        if (warning) toast(warning, { icon: '⚠️' });

        // forward eegFiles to the handles that wire the files like a normal load would
        if (eegFiles.length > 0) {
          const isEegSet = await handleEegFiles(eegFiles);
          // only wait for EEG Viewer to finish loading if EEG data is set and the viewer is actually initialising, or else promise never fulfills
          if (isEegSet) await eegReady;
        }
        if (imagingFiles.length > 0) {
          setLayers(await filesToLayers(imagingFiles));
          await niiReady;
        }
        // loaded successfully
        toast.success(`${sourceName} data loaded!`, { id: toastId });
      } catch (err) {
        if (err.name === 'AbortError') {
          // just remove toast (no need to show toast when e.g. using the back button)
          toast.dismiss(toastId);
        } else {
          toast.error(`Error loading ${sourceName} data:\n${err.message}`, { id: toastId });
        }
      } finally {
        // In development, StrictMode cancels the first run while the real (second) load is still going.
        // This should not disable the loading flag, cause loading is still in progress.
        if (!signal.aborted) setIsLoading(false);
      }
    },
    [
      sourceName,
      fetchData,
      handleEegFiles,
      setLayers,
      setEegName,
      eegReadyResolveRef,
      niiReadyResolveRef,
    ]
  );

  // Calls the newest handleLoad, but never changes itself — so the effect below doesn't
  // need it as a dependency. (handleLoad changes during the load; as a dependency, every
  // change would abort the download and start it again.)
  const startLoad = useEffectEvent((signal) => handleLoad(signal));

  // Starts the load once, and cancels it when the page unmounts. A new fetchData (e.g. another
  // Shanoir examination) starts a new load.
  useEffect(() => {
    if (!enabled) return; // not launched in this mode
    const controller = new AbortController(); // new one per load: once aborted, it stays aborted
    startLoad(controller.signal);
    return () => controller.abort(); // runs later, on unmount — not now
  }, [enabled, fetchData]);

  return { isLoading };
}
