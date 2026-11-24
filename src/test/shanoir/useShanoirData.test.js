import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, renderHook, waitFor } from '@testing-library/react';
import toast from 'react-hot-toast';
import { useShanoirData } from '@/shanoir/useShanoirData';
import { fetchShanoirExamination } from '@/shanoir/fetchShanoirExamination';
import { filesToLayers } from '@/utils/NiiViewer.utils';

// Covers how a Shanoir examination reaches the viewers: the downloaded files go to the same
// handlers a file drop uses, the hook waits only for viewers that actually got data, and a
// cancelled load (page left) never fills the viewers. Downloading itself is stubbed — see
// fetchShanoirExamination.test.js for that part.

vi.mock('react-hot-toast', () => {
  const toast = vi.fn();
  toast.loading = vi.fn(() => 'toast-id');
  toast.success = vi.fn();
  toast.error = vi.fn();
  toast.dismiss = vi.fn();
  return { default: toast };
});

vi.mock('@/shanoir/fetchShanoirExamination', () => ({ fetchShanoirExamination: vi.fn() }));

// Renders the message of the warning toast (React markup) and returns its container
const renderWarning = () => {
  const [message, options] = toast.mock.calls.at(-1);
  expect(options).toEqual(expect.objectContaining({ icon: '⚠️' }));
  return render(message).container;
};
// The warning's text, one entry per line (paragraph or bullet)
const warningLines = (container) =>
  [...container.querySelectorAll('p, li')].map((line) => line.textContent);
vi.mock('@/utils/NiiViewer.utils', () => ({ filesToLayers: vi.fn() }));

const file = (name) => new File(['x'], name);
const EEG_FILES = [file('rec.vhdr'), file('rec.eeg'), file('sub-01_electrodes.tsv')];
const IMAGING_FILES = [file('T1w.nii.gz')];
const LAYERS = [{ url: 'blob:t1w', type: 'MRI' }];

// What fetchShanoirExamination resolves to for a typical examination (EEG + one MR volume)
const examination = (overrides = {}) => ({
  eegDataset: { id: 1, name: 'rest', type: 'Eeg' },
  eegFiles: EEG_FILES,
  imagingFiles: IMAGING_FILES,
  skippedDatasets: [],
  skippedFiles: [],
  ...overrides,
});

// Renders the hook with stand-ins for PatientView's handlers. Like the real viewers, the
// stand-ins resolve the ready promises once they've received data (EegViewer/NiiViewer do
// so after rendering it), so a load that waits for them can finish.
// `launched: false` passes no client (undefined), like PatientView outside Shanoir.
function setup({ launched = true, isEegSet = true } = {}) {
  const client = launched ? {} : undefined;
  const eegReadyResolveRef = { current: null };
  const niiReadyResolveRef = { current: null };
  const handleEegFiles = vi.fn(async () => {
    if (isEegSet) eegReadyResolveRef.current();
    return isEegSet;
  });
  const setLayers = vi.fn(() => niiReadyResolveRef.current());
  const setShanoirEegName = vi.fn();

  const hook = renderHook(() =>
    useShanoirData({
      handleEegFiles,
      setLayers,
      setShanoirEegName,
      eegReadyResolveRef,
      niiReadyResolveRef,
      client,
      examinationId: 42,
    })
  );
  return { hook, client, handleEegFiles, setLayers, setShanoirEegName };
}

describe('useShanoirData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchShanoirExamination.mockResolvedValue(examination());
    filesToLayers.mockResolvedValue(LAYERS);
  });

  it('does nothing when not launched from Shanoir (no client)', () => {
    const { hook, handleEegFiles, setLayers } = setup({ launched: false });
    expect(hook.result.current.isShanoirLoading).toBe(false);
    expect(fetchShanoirExamination).not.toHaveBeenCalled();
    expect(toast.loading).not.toHaveBeenCalled();
    expect(handleEegFiles).not.toHaveBeenCalled();
    expect(setLayers).not.toHaveBeenCalled();
  });

  it('starts loading on its own, with the loading state on from the first render', async () => {
    const { hook, client } = setup();
    expect(hook.result.current.isShanoirLoading).toBe(true);
    expect(fetchShanoirExamination).toHaveBeenCalledWith(
      expect.objectContaining({ client, examinationId: 42, signal: expect.any(AbortSignal) })
    );
    await waitFor(() => expect(hook.result.current.isShanoirLoading).toBe(false));
  });

  it('hands the EEG files to the EEG intake and the imaging to the layers, like a file drop', async () => {
    const { hook, handleEegFiles, setLayers, setShanoirEegName } = setup();
    await waitFor(() => expect(hook.result.current.isShanoirLoading).toBe(false));

    expect(handleEegFiles).toHaveBeenCalledWith(EEG_FILES);
    expect(filesToLayers).toHaveBeenCalledWith(IMAGING_FILES);
    expect(setLayers).toHaveBeenCalledWith(LAYERS);
    // the name with the Shanoir type, to tell e.g. an EEG-tab recording from a BIDS one
    expect(setShanoirEegName).toHaveBeenCalledWith('rest (Eeg)');
    expect(toast.success).toHaveBeenCalledWith(expect.any(String), { id: 'toast-id' });
  });

  it("doesn't wait for EegViewer when no recording was set (it would never render)", async () => {
    // handleEegFiles resolves to false and never resolves the EEG ready promise: if the hook
    // waited for it anyway, the imaging would never be loaded and the load would never end.
    const { hook, setLayers } = setup({ isEegSet: false });
    await waitFor(() => expect(hook.result.current.isShanoirLoading).toBe(false));
    expect(setLayers).toHaveBeenCalledWith(LAYERS);
    expect(toast.success).toHaveBeenCalled();
  });

  it('skips the viewers that get no data', async () => {
    fetchShanoirExamination.mockResolvedValue(
      examination({ eegDataset: null, eegFiles: [], imagingFiles: IMAGING_FILES })
    );
    const { hook, handleEegFiles, setLayers, setShanoirEegName } = setup();
    await waitFor(() => expect(hook.result.current.isShanoirLoading).toBe(false));

    expect(handleEegFiles).not.toHaveBeenCalled();
    expect(setShanoirEegName).toHaveBeenCalledWith(null);
    expect(setLayers).toHaveBeenCalledWith(LAYERS);
  });

  it('lists the skipped datasets in a warning toast, grouped by reason, one bulleted line each', async () => {
    fetchShanoirExamination.mockResolvedValue(
      examination({
        skippedDatasets: [
          {
            id: 2,
            name: 'first run',
            type: 'EEG',
            reason: 'Older EEG recordings (only the latest is loaded)',
            detail: 'EEG',
          },
          {
            id: 3,
            name: 'report',
            type: 'Measurement',
            reason: 'Unsupported dataset type',
            detail: 'Measurement',
          },
          {
            id: 4,
            name: 'second run',
            type: 'BIDS',
            reason: 'Older EEG recordings (only the latest is loaded)',
            detail: 'BIDS',
          },
          {
            id: 5,
            name: 'sub-1_electrodes_tsv',
            type: 'BIDS',
            reason: "Belong to a BIDS recording that isn't loaded",
          },
        ],
      })
    );
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.isShanoirLoading).toBe(false));

    // one heading per reason, in the order the reasons first appear
    const warning = renderWarning();
    expect(warningLines(warning)).toEqual([
      'Skipped the following datasets:',
      'Older EEG recordings (only the latest is loaded):',
      '- first run (EEG)',
      '- second run (BIDS)',
      'Unsupported dataset type:',
      '- report (Measurement)',
      "Belong to a BIDS recording that isn't loaded:",
      '- sub-1_electrodes_tsv',
    ]);
    // the narrow toast stays readable: the groups in a smaller font, their reasons in bold
    const reason = [...warning.querySelectorAll('p')].find(
      (line) => line.textContent === 'Unsupported dataset type:'
    );
    expect(reason).toHaveClass('font-semibold');
    expect(reason.closest('.text-xs')).not.toBeNull();
    const title = warning.querySelector('p');
    expect(title.closest('.text-xs')).toBeNull();
  });

  it('lists the files not used (another file of the same kind won) in the warning toast too', async () => {
    fetchShanoirExamination.mockResolvedValue(
      examination({
        skippedDatasets: [
          {
            id: 3,
            name: 'report',
            type: 'Measurement',
            reason: 'Unsupported dataset type',
            detail: 'Measurement',
          },
        ],
        skippedFiles: [
          {
            name: 'exam_electrodes.tsv',
            source: 'the examination',
            reason: "using acq_electrodes.tsv from the recording's acquisition",
          },
        ],
      })
    );
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.isShanoirLoading).toBe(false));

    expect(warningLines(renderWarning())).toEqual([
      'Skipped the following datasets:',
      'Unsupported dataset type:',
      '- report (Measurement)',
      'Skipped the following files:',
      "- exam_electrodes.tsv from the examination (using acq_electrodes.tsv from the recording's acquisition)",
    ]);
  });

  it('shows the error and ends the loading state when the load fails', async () => {
    fetchShanoirExamination.mockRejectedValue(new Error('403 Forbidden'));
    const { hook, handleEegFiles, setLayers } = setup();
    await waitFor(() => expect(hook.result.current.isShanoirLoading).toBe(false));

    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/403 Forbidden/), {
      id: 'toast-id',
    });
    expect(toast.success).not.toHaveBeenCalled();
    expect(handleEegFiles).not.toHaveBeenCalled();
    expect(setLayers).not.toHaveBeenCalled();
  });

  it('cancels the load when the page unmounts, without filling the viewers', async () => {
    // A download that's still running when the user leaves the page
    let finishDownload;
    fetchShanoirExamination.mockReturnValue(
      new Promise((resolve) => {
        finishDownload = resolve;
      })
    );
    const { hook, handleEegFiles, setLayers, setShanoirEegName } = setup();
    const { signal } = fetchShanoirExamination.mock.calls[0][0];

    hook.unmount();
    expect(signal.aborted).toBe(true);

    // The download finishes anyway (unzipping doesn't listen to the signal)
    finishDownload(examination());
    await waitFor(() => expect(toast.dismiss).toHaveBeenCalledWith('toast-id'));

    expect(setShanoirEegName).not.toHaveBeenCalled();
    expect(handleEegFiles).not.toHaveBeenCalled();
    expect(setLayers).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });
});
