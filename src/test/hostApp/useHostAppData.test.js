import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import toast from 'react-hot-toast';
import { useHostAppData } from '@/hostApp/useHostAppData';
import { fetchHostAppFiles } from '@/hostApp/fetchHostAppFiles';
import { filesToLayers } from '@/utils/NiiViewer.utils';

// Covers what's specific to a host-app launch: the toasts name the host app, the session's
// title is passed on, and skipped files are reported. Handing the files to the viewers and
// cancelling are shared with Shanoir — see useLaunchData.test.js. Downloading itself is
// stubbed — see fetchHostAppFiles.test.js.

vi.mock('react-hot-toast', () => {
  const toast = vi.fn();
  toast.loading = vi.fn(() => 'toast-id');
  toast.success = vi.fn();
  toast.error = vi.fn();
  toast.dismiss = vi.fn();
  return { default: toast };
});

vi.mock('@/hostApp/fetchHostAppFiles', () => ({ fetchHostAppFiles: vi.fn() }));
vi.mock('@/utils/NiiViewer.utils', () => ({ filesToLayers: vi.fn() }));

const file = (name) => new File(['x'], name);

// What fetchHostAppFiles resolves to for a typical launch (an EDF recording + one MR volume)
const fetched = (overrides = {}) => ({
  title: 'Patient 012',
  eegFiles: [file('rest.edf')],
  imagingFiles: [file('T1w.nii.gz')],
  skippedFiles: [],
  eegName: 'rest.edf',
  ...overrides,
});

// Renders the hook with stand-ins for PatientView's handlers, which resolve the ready
// promises like the real viewers do once they've received data
function setup({ launched = true } = {}) {
  const client = launched ? {} : undefined;
  const eegReadyResolveRef = { current: null };
  const niiReadyResolveRef = { current: null };
  const handleEegFiles = vi.fn(async () => {
    eegReadyResolveRef.current();
    return true;
  });
  const setLayers = vi.fn(() => niiReadyResolveRef.current());
  const setEegName = vi.fn();

  const hook = renderHook(() =>
    useHostAppData({
      client,
      appName: 'Test Host App',
      handleEegFiles,
      setLayers,
      setEegName,
      eegReadyResolveRef,
      niiReadyResolveRef,
    })
  );
  return { hook, client, setEegName };
}

describe('useHostAppData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchHostAppFiles.mockResolvedValue(fetched());
    filesToLayers.mockResolvedValue([{ url: 'blob:t1w' }]);
  });

  it('does nothing when not launched from a host app (no client)', () => {
    const { hook } = setup({ launched: false });
    expect(hook.result.current.isHostAppLoading).toBe(false);
    expect(hook.result.current.title).toBeNull();
    expect(fetchHostAppFiles).not.toHaveBeenCalled();
  });

  it("loads the launch's files, naming the host app in the toasts", async () => {
    const { hook, client } = setup();
    expect(hook.result.current.isHostAppLoading).toBe(true);
    expect(fetchHostAppFiles).toHaveBeenCalledWith({ client, signal: expect.any(AbortSignal) });
    await waitFor(() => expect(hook.result.current.isHostAppLoading).toBe(false));

    expect(toast.loading).toHaveBeenCalledWith('Loading Test Host App data…');
    expect(toast.success).toHaveBeenCalledWith('Test Host App data loaded!', { id: 'toast-id' });
  });

  it("passes on the session's title and the recording's name", async () => {
    const { hook, setEegName } = setup();
    await waitFor(() => expect(hook.result.current.title).toBe('Patient 012'));
    expect(setEegName).toHaveBeenCalledWith('rest.edf');
  });

  it('lists the skipped files in a warning toast, one bulleted line each', async () => {
    fetchHostAppFiles.mockResolvedValue(fetched({ skippedFiles: ['report.pdf', 'rec.vmrk'] }));
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.isHostAppLoading).toBe(false));

    expect(toast).toHaveBeenCalledWith(
      "Skipped the following files (VIDEPE can't open them):\n- report.pdf\n- rec.vmrk",
      expect.anything()
    );
  });

  it('warns when the host app sent nothing VIDEPE can open', async () => {
    fetchHostAppFiles.mockResolvedValue(
      fetched({ eegFiles: [], imagingFiles: [], skippedFiles: [], eegName: null })
    );
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.isHostAppLoading).toBe(false));

    expect(toast).toHaveBeenCalledWith(
      'Test Host App sent no files VIDEPE can open.',
      expect.anything()
    );
  });
});
