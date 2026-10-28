import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import toast from 'react-hot-toast';
import { useLaunchData } from '@/hooks/useLaunchData';
import { filesToLayers } from '@/utils/NiiViewer.utils';

// Covers the part every launch mode (Shanoir, host app) shares: the fetched files go to the
// same handlers a file drop uses, the hook waits only for viewers that actually got data, and
// a cancelled load (page left) never fills the viewers. Fetching itself is a stand-in here —
// see useShanoirData / useHostAppData for what each mode fetches.

vi.mock('react-hot-toast', () => {
  const toast = vi.fn();
  toast.loading = vi.fn(() => 'toast-id');
  toast.success = vi.fn();
  toast.error = vi.fn();
  toast.dismiss = vi.fn();
  return { default: toast };
});

vi.mock('@/utils/NiiViewer.utils', () => ({ filesToLayers: vi.fn() }));

const file = (name) => new File(['x'], name);
const EEG_FILES = [file('rec.vhdr'), file('rec.eeg'), file('sub-01_electrodes.tsv')];
const IMAGING_FILES = [file('T1w.nii.gz')];
const LAYERS = [{ url: 'blob:t1w', type: 'MRI' }];

// What a mode's fetchData resolves to for a typical launch (EEG + one MR volume)
const fetched = (overrides = {}) => ({
  eegFiles: EEG_FILES,
  imagingFiles: IMAGING_FILES,
  eegName: 'rest',
  warning: null,
  ...overrides,
});

// Renders the hook with stand-ins for PatientView's handlers. Like the real viewers, the
// stand-ins resolve the ready promises once they've received data (EegViewer/NiiViewer do
// so after rendering it), so a load that waits for them can finish.
function setup({ enabled = true, isEegSet = true, fetchData = vi.fn() } = {}) {
  const eegReadyResolveRef = { current: null };
  const niiReadyResolveRef = { current: null };
  const handleEegFiles = vi.fn(async () => {
    if (isEegSet) eegReadyResolveRef.current();
    return isEegSet;
  });
  const setLayers = vi.fn(() => niiReadyResolveRef.current());
  const setEegName = vi.fn();

  const hook = renderHook(() =>
    useLaunchData({
      enabled,
      sourceName: 'Test Source',
      fetchData,
      handleEegFiles,
      setLayers,
      setEegName,
      eegReadyResolveRef,
      niiReadyResolveRef,
    })
  );
  return { hook, fetchData, handleEegFiles, setLayers, setEegName };
}

describe('useLaunchData', () => {
  let fetchData;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchData = vi.fn().mockResolvedValue(fetched());
    filesToLayers.mockResolvedValue(LAYERS);
  });

  it('does nothing when not enabled (VIDEPE not launched by another app)', () => {
    const { hook, handleEegFiles, setLayers } = setup({ enabled: false, fetchData });
    expect(hook.result.current.isLoading).toBe(false);
    expect(fetchData).not.toHaveBeenCalled();
    expect(toast.loading).not.toHaveBeenCalled();
    expect(handleEegFiles).not.toHaveBeenCalled();
    expect(setLayers).not.toHaveBeenCalled();
  });

  it('starts loading on its own, with the loading state on from the first render', async () => {
    const { hook } = setup({ fetchData });
    expect(hook.result.current.isLoading).toBe(true);
    expect(fetchData).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(toast.loading).toHaveBeenCalledWith('Loading Test Source data…');
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
  });

  it('hands the EEG files to the EEG intake and the imaging to the layers, like a file drop', async () => {
    const { hook, handleEegFiles, setLayers, setEegName } = setup({ fetchData });
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));

    expect(handleEegFiles).toHaveBeenCalledWith(EEG_FILES);
    expect(filesToLayers).toHaveBeenCalledWith(IMAGING_FILES);
    expect(setLayers).toHaveBeenCalledWith(LAYERS);
    expect(setEegName).toHaveBeenCalledWith('rest');
    expect(toast.success).toHaveBeenCalledWith('Test Source data loaded!', { id: 'toast-id' });
  });

  it("doesn't wait for EegViewer when no recording was set (it would never render)", async () => {
    // handleEegFiles resolves to false and never resolves the EEG ready promise: if the hook
    // waited for it anyway, the imaging would never be loaded and the load would never end.
    const { hook, setLayers } = setup({ fetchData, isEegSet: false });
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
    expect(setLayers).toHaveBeenCalledWith(LAYERS);
    expect(toast.success).toHaveBeenCalled();
  });

  it('skips the viewers that get no data', async () => {
    fetchData.mockResolvedValue(fetched({ eegFiles: [], eegName: null }));
    const { hook, handleEegFiles, setLayers, setEegName } = setup({ fetchData });
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));

    expect(handleEegFiles).not.toHaveBeenCalled();
    expect(setEegName).toHaveBeenCalledWith(null);
    expect(setLayers).toHaveBeenCalledWith(LAYERS);
  });

  it("shows the mode's warning (e.g. what was skipped) in a warning toast", async () => {
    fetchData.mockResolvedValue(fetched({ warning: 'Skipped the following files:\n- a.pdf' }));
    const { hook } = setup({ fetchData });
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
    expect(toast).toHaveBeenCalledWith('Skipped the following files:\n- a.pdf', {
      icon: '⚠️',
    });
  });

  it('shows no warning toast when there is nothing to warn about', async () => {
    const { hook } = setup({ fetchData });
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
    expect(toast).not.toHaveBeenCalled();
  });

  it('shows the error and ends the loading state when the load fails', async () => {
    fetchData.mockRejectedValue(new Error('403 Forbidden'));
    const { hook, handleEegFiles, setLayers } = setup({ fetchData });
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));

    expect(toast.error).toHaveBeenCalledWith('Error loading Test Source data:\n403 Forbidden', {
      id: 'toast-id',
    });
    expect(toast.success).not.toHaveBeenCalled();
    expect(handleEegFiles).not.toHaveBeenCalled();
    expect(setLayers).not.toHaveBeenCalled();
  });

  it('cancels the load when the page unmounts, without filling the viewers', async () => {
    // A download that's still running when the user leaves the page
    let finishDownload;
    fetchData.mockReturnValue(
      new Promise((resolve) => {
        finishDownload = resolve;
      })
    );
    const { hook, handleEegFiles, setLayers, setEegName } = setup({ fetchData });
    const signal = fetchData.mock.calls[0][0];

    hook.unmount();
    expect(signal.aborted).toBe(true);

    // The download finishes anyway (e.g. unzipping doesn't listen to the signal)
    finishDownload(fetched());
    await waitFor(() => expect(toast.dismiss).toHaveBeenCalledWith('toast-id'));

    expect(setEegName).not.toHaveBeenCalled();
    expect(handleEegFiles).not.toHaveBeenCalled();
    expect(setLayers).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('loads only once while fetchData stays the same, however often the page re-renders', async () => {
    const { hook } = setup({ fetchData });
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
    hook.rerender();
    hook.rerender();
    expect(fetchData).toHaveBeenCalledTimes(1);
  });
});
