import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEegFileIntake } from '@/hooks/useEegFileIntake';
import { detectAndLoadEEG } from '@/loaders/eegFormatRegistry';

// Covers what handleEegFiles resolves to — `true` only when an EEG recording was loaded
// (setEeg called) — which callers that wait for EegViewer to render rely on (see
// useShanoirData): when no recording is set, the viewer never appears, so they must not wait.

vi.mock('react-hot-toast', () => {
  const toast = vi.fn();
  toast.success = vi.fn();
  toast.error = vi.fn();
  return { default: toast };
});

// Format detection/validation stays real; only the actual file parsing is stubbed,
// so these tests don't need valid BrainVision file contents.
vi.mock('@/loaders/eegFormatRegistry', async (importOriginal) => ({
  ...(await importOriginal()),
  detectAndLoadEEG: vi.fn(),
}));

const PARSED_EEG = { channelNames: ['Fp1', 'Fp2'], fs: 250, tMax: 10, getChunk: vi.fn() };

const file = (name, content = 'x') => new File([content], name);

function setup() {
  const setEeg = vi.fn();
  const setIsLoading = vi.fn();
  const onInverseSolutionFile = vi.fn().mockResolvedValue(undefined);
  const hook = renderHook(() => useEegFileIntake({ setEeg, setIsLoading, onInverseSolutionFile }));
  // Runs handleEegFiles inside act() and returns what it resolved to
  const drop = async (...files) => {
    let result;
    await act(async () => {
      result = await hook.result.current.handleEegFiles(files);
    });
    return result;
  };
  return { hook, drop, setEeg, setIsLoading, onInverseSolutionFile };
}

describe('useEegFileIntake › handleEegFiles result', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    detectAndLoadEEG.mockResolvedValue(PARSED_EEG);
  });

  it('resolves to true and sets the recording when a complete BrainVision set is dropped', async () => {
    const { drop, setEeg } = setup();
    expect(await drop(file('rec.vhdr'), file('rec.eeg'))).toBe(true);
    expect(setEeg).toHaveBeenCalledWith(PARSED_EEG);
  });

  it('resolves to true when the set is completed by a second drop', async () => {
    const { hook, drop, setEeg } = setup();
    expect(await drop(file('rec.vhdr'))).toBe(false); // incomplete: held as pending
    expect(setEeg).not.toHaveBeenCalled();
    expect(hook.result.current.pendingEegFiles).toHaveLength(1);

    expect(await drop(file('rec.eeg'))).toBe(true);
    expect(setEeg).toHaveBeenCalledWith(PARSED_EEG);
  });

  it('resolves to false when the files are incomplete, and leaves a hint', async () => {
    const { hook, drop, setEeg } = setup();
    expect(await drop(file('rec.eeg'))).toBe(false);
    expect(setEeg).not.toHaveBeenCalled();
    expect(hook.result.current.eegHint).toMatch(/\.vhdr/);
  });

  it('resolves to false when the header and data names do not match', async () => {
    const { drop, setEeg } = setup();
    expect(await drop(file('a.vhdr'), file('b.eeg'))).toBe(false);
    expect(setEeg).not.toHaveBeenCalled();
    expect(detectAndLoadEEG).not.toHaveBeenCalled();
  });

  it('resolves to false, with an error toast, when parsing the recording fails', async () => {
    const toast = (await import('react-hot-toast')).default;
    detectAndLoadEEG.mockRejectedValue(new Error('corrupt header'));
    const { drop, setEeg, setIsLoading } = setup();

    expect(await drop(file('rec.vhdr'), file('rec.eeg'))).toBe(false);
    expect(setEeg).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('corrupt header'));
    expect(setIsLoading).toHaveBeenLastCalledWith(false); // loading state is released
  });

  it('resolves to false when the recording has duplicate channel names', async () => {
    detectAndLoadEEG.mockResolvedValue({ ...PARSED_EEG, channelNames: ['Fp1', 'Fp1'] });
    const { drop, setEeg } = setup();
    expect(await drop(file('rec.vhdr'), file('rec.eeg'))).toBe(false);
    expect(setEeg).not.toHaveBeenCalled();
  });

  it('resolves to false when only electrode positions are dropped', async () => {
    const { drop, setEeg } = setup();
    const tsv = 'name\tx\ty\tz\nFp1\t-29\t84\t-7\n';
    expect(await drop(file('sub-01_electrodes.tsv', tsv))).toBe(false);
    expect(setEeg).not.toHaveBeenCalled();
    expect(detectAndLoadEEG).not.toHaveBeenCalled();
  });

  it('resolves to false when only an inverse solution is dropped', async () => {
    const { drop, setEeg, onInverseSolutionFile } = setup();
    expect(await drop(file('sub-01_inversefilters.mat'))).toBe(false);
    expect(onInverseSolutionFile).toHaveBeenCalledTimes(1); // still routed to its handler
    expect(setEeg).not.toHaveBeenCalled();
  });

  it('resolves to false for files that belong to no EEG format', async () => {
    const { drop, setEeg } = setup();
    expect(await drop(file('T1w.nii.gz'))).toBe(false);
    expect(setEeg).not.toHaveBeenCalled();
  });

  it('resolves to true when a recording is dropped together with electrode positions', async () => {
    const { drop, setEeg } = setup();
    const tsv = 'name\tx\ty\tz\nFp1\t-29\t84\t-7\n';
    expect(await drop(file('rec.vhdr'), file('rec.eeg'), file('sub-01_electrodes.tsv', tsv))).toBe(
      true
    );
    expect(setEeg).toHaveBeenCalledWith(PARSED_EEG);
  });
});
