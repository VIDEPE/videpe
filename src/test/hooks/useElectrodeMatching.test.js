import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useElectrodeMatching } from '@/hooks/useElectrodeMatching';

// react-hot-toast's default export is itself a callable function with .loading/.success/etc
// attached — a plain object mock would make the hook's toast(...) call throw silently.
vi.mock('react-hot-toast', () => {
  const toastFn = vi.fn();
  toastFn.loading = vi.fn();
  toastFn.success = vi.fn();
  toastFn.error = vi.fn();
  toastFn.dismiss = vi.fn();
  return { default: toastFn };
});

// Minimal .elc content whose labels match two of the three test channel names
const MOCK_ELC = `ReferenceLabel avg
UnitPosition mm
NumberPositions= 3
Positions
-29.0 84.0 -7.0
29.0 84.0 -7.0
0.0 0.0 88.0
Labels
EEG1
EEG2
Cz
`;

const channelNames = ['EEG1', 'EEG2', 'EEG3'];

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({ text: () => Promise.resolve(MOCK_ELC) });
});

const setup = (overrides = {}) =>
  renderHook((props) => useElectrodeMatching(props), {
    initialProps: {
      channelNames,
      customElectrodes: [],
      customElecPosFileName: null,
      recordingType: 'eeg',
      onRecordingTypeChange: vi.fn(),
      ...overrides,
    },
  });

describe('useElectrodeMatching — standard_1005 detection', () => {
  it('fetches the standard_1005 template on mount', async () => {
    setup();
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith('electrode_positions/standard_1005.elc')
    );
  });

  it('reports the auto-detected recording type via onRecordingTypeChange, and toasts it', async () => {
    const { default: toast } = await import('react-hot-toast');
    const onRecordingTypeChange = vi.fn();
    setup({ onRecordingTypeChange });
    // EEG1/EEG2/Cz vs EEG1/EEG2/EEG3 → 2/3 match ratio (≥ 0.3) → detected as scalp EEG
    await waitFor(() => expect(onRecordingTypeChange).toHaveBeenCalledWith('eeg'));
    expect(toast).toHaveBeenCalledWith('EEG recording detected', {
      id: expect.any(String),
      icon: '🔍',
    });
  });

  it('reports iEEG via onRecordingTypeChange and toasts accordingly for intracranial-shaped channel names', async () => {
    const { default: toast } = await import('react-hot-toast');
    const onRecordingTypeChange = vi.fn();
    // Primed group ("B'1") is always detected as iEEG, regardless of template match
    setup({ channelNames: ['B1', 'B2', "B'1"], onRecordingTypeChange });
    await waitFor(() => expect(onRecordingTypeChange).toHaveBeenCalledWith('ieeg'));
    expect(toast).toHaveBeenCalledWith('iEEG recording detected', {
      id: expect.any(String),
      icon: '🔍',
    });
  });

  it('uses the standard_1005 template as the render-facing electrodes when EEG with no custom file', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.matched.length).toBe(2));
    expect(result.current.electrodes.length).toBe(3); // the parsed template (3 positions)
    expect(result.current.isStandardElectrodes).toBe(true);
  });

  it('silently ignores a fetch failure instead of throwing', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'));
    expect(() => setup()).not.toThrow();
  });
});

describe('useElectrodeMatching — custom electrode positions', () => {
  const customElectrodes = [
    { label: 'EEG1', x: 1, y: 1, z: 1 },
    { label: 'EEG2', x: 2, y: 2, z: 2 },
    { label: 'EEG3', x: 3, y: 3, z: 3 },
  ];

  it('uses the custom file over the standard template when present', async () => {
    const { result } = setup({ customElectrodes, customElecPosFileName: 'custom.tsv' });
    await waitFor(() => expect(result.current.matched.length).toBe(3)); // all 3 match custom
    expect(result.current.electrodes).toBe(customElectrodes);
    expect(result.current.isStandardElectrodes).toBe(false);
  });

  it('scores the status LED against the custom match ratio, not the standard template', async () => {
    const { result } = setup({ customElectrodes, customElecPosFileName: 'custom.tsv' });
    await waitFor(() => expect(result.current.electrodePositionMatchCount).toBe(3));
    expect(result.current.electrodePositionTotalCount).toBe(3);
    expect(result.current.isElectrodePositionMatchGoodForLed).toBe(true); // 3/3 ≥ 0.9
  });

  it('flags a poor custom match as not good for the LED', async () => {
    const sparseCustom = [{ label: 'EEG1', x: 1, y: 1, z: 1 }]; // 1/3 channels matched
    const { result } = setup({
      customElectrodes: sparseCustom,
      customElecPosFileName: 'sparse.tsv',
    });
    await waitFor(() => expect(result.current.electrodePositionMatchCount).toBe(1));
    expect(result.current.isElectrodePositionMatchGoodForLed).toBe(false); // 1/3 < 0.9
  });
});

describe('useElectrodeMatching — intracranial mode', () => {
  it('never falls back to the standard template, even with no custom file', async () => {
    const { result } = setup({ recordingType: 'ieeg' });
    await waitFor(() => expect(result.current.isIntracranial).toBe(true));
    expect(result.current.electrodes).toEqual([]); // no custom electrodes supplied
    expect(result.current.isStandardElectrodes).toBe(false);
  });

  it('electrodePositionMatchCount/TotalCount are undefined with no custom file (nothing meaningful to show)', async () => {
    const { result } = setup({ recordingType: 'ieeg' });
    await waitFor(() => expect(result.current.isIntracranial).toBe(true));
    expect(result.current.electrodePositionMatchCount).toBeUndefined();
    expect(result.current.electrodePositionTotalCount).toBeUndefined();
  });

  it("still judges a custom file's own match quality in iEEG mode", async () => {
    const customElectrodes = [{ label: 'EEG1', x: 1, y: 1, z: 1 }];
    const { result } = setup({
      recordingType: 'ieeg',
      customElectrodes,
      customElecPosFileName: 'depth.tsv',
    });
    await waitFor(() => expect(result.current.electrodePositionMatchCount).toBe(1));
    expect(result.current.electrodePositionTotalCount).toBe(3);
  });
});

describe('useElectrodeMatching — re-detection on channel change', () => {
  it('re-fetches and re-detects when channelNames changes (new recording loaded)', async () => {
    const onRecordingTypeChange = vi.fn();
    const { rerender } = setup({ onRecordingTypeChange });
    await waitFor(() => expect(onRecordingTypeChange).toHaveBeenCalledTimes(1));

    onRecordingTypeChange.mockClear();
    act(() => {
      rerender({
        channelNames: ['EEG1', 'EEG2', 'EEG3', 'EEG4'],
        customElectrodes: [],
        customElecPosFileName: null,
        recordingType: 'eeg',
        onRecordingTypeChange,
      });
    });

    await waitFor(() => expect(onRecordingTypeChange).toHaveBeenCalledTimes(1));
  });
});
