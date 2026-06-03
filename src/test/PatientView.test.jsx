import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PatientView } from '@/pages/PatientView';
import { checkEegFiles, detectAndLoadEEG } from '@/loaders/eegFormats';
import { FileDropZone } from '@/components/FileDropZone';
import { NiiViewer } from '@/components/NiiViewer';

// toast.promise just runs and returns the promise; toast.error is a no-op
vi.mock('react-hot-toast', () => ({
  default: {
    promise: (p) => p,
    error: vi.fn(),
  },
}));

vi.mock('@/loaders/loadBrainVisionEEG', () => ({
  loadBrainVisionEEG: vi.fn().mockResolvedValue({ data: [[0, 1]], channelNames: ['Ch1'] }),
}));

vi.mock('@/loaders/eegFormats', () => ({
  checkEegFiles: vi.fn(),
  detectAndLoadEEG: vi.fn(),
}));

vi.mock('@/components/EegViewer', () => ({ EegViewer: () => <div data-testid="eeg-viewer" /> }));
vi.mock('@/components/NiiViewer', () => ({
  NiiViewer: vi.fn(() => <div data-testid="nii-viewer" />),
}));
vi.mock('@/components/FileDropZone', () => ({ FileDropZone: vi.fn(() => null) }));
vi.mock('@/components/ThemeToggle', () => ({ ThemeToggle: () => null }));

const makeFile = (name) => new File([''], name);

// Returns the onFiles prop from the most recent render of the EEG drop zone
const getEegOnFiles = () => {
  const calls = FileDropZone.mock.calls.filter(([p]) => p.label === 'Drop EEG files');
  return calls.at(-1)[0].onFiles;
};

// Returns the onFiles prop from the most recent render of the imaging drop zone
const getNiiOnFiles = () => {
  const calls = FileDropZone.mock.calls.filter(([p]) => p.label === 'Drop imaging files');
  return calls.at(-1)[0].onFiles;
};

const getMainButton = () => screen.getByRole('button', { name: /^(load demo|reset|loading…)$/i });

describe('PatientView — button label', () => {
  beforeEach(() => {
    FileDropZone.mockClear();
    detectAndLoadEEG.mockResolvedValue({ data: [[0, 1]], channelNames: ['Ch1'] });
  });

  it('shows "Load Demo" before any data is loaded', () => {
    checkEegFiles.mockReturnValue({
      formatName: null,
      complete: false,
      missing: null,
      warning: null,
    });
    render(<PatientView />);
    expect(getMainButton()).toHaveTextContent(/load demo/i);
  });

  it('shows "Reset" when there are pending EEG files', async () => {
    checkEegFiles.mockReturnValue({
      formatName: 'BrainVision',
      complete: false,
      missing: ['.eeg'],
      warning: null,
    });
    render(<PatientView />);

    await act(async () => {
      await getEegOnFiles()([makeFile('sub01.vhdr')]);
    });

    expect(getMainButton()).toHaveTextContent(/reset/i);
  });

  it('shows "Reset" and renders EegViewer after EEG loads successfully', async () => {
    checkEegFiles.mockReturnValue({
      formatName: 'BrainVision',
      complete: true,
      missing: [],
      warning: null,
    });
    render(<PatientView />);

    await act(async () => {
      await getEegOnFiles()([makeFile('sub01.vhdr'), makeFile('sub01.eeg')]);
    });

    expect(getMainButton()).toHaveTextContent(/reset/i);
    expect(screen.getByTestId('eeg-viewer')).toBeInTheDocument();
  });
});

describe('PatientView — reset', () => {
  beforeEach(() => {
    FileDropZone.mockClear();
    checkEegFiles.mockReturnValue({
      formatName: 'BrainVision',
      complete: true,
      missing: [],
      warning: null,
    });
    detectAndLoadEEG.mockResolvedValue({ data: [[0, 1]], channelNames: ['Ch1'] });
  });

  it('clicking Reset returns to "Load Demo" and removes EegViewer', async () => {
    const user = userEvent.setup();
    render(<PatientView />);

    await act(async () => {
      await getEegOnFiles()([makeFile('sub01.vhdr'), makeFile('sub01.eeg')]);
    });

    await user.click(getMainButton()); // Reset

    expect(getMainButton()).toHaveTextContent(/load demo/i);
    expect(screen.queryByTestId('eeg-viewer')).not.toBeInTheDocument();
  });
});

describe('PatientView — EEG file accumulation', () => {
  beforeEach(() => {
    FileDropZone.mockClear();
  });

  it('accumulates files across two separate drops', async () => {
    checkEegFiles
      .mockReturnValueOnce({
        formatName: 'BrainVision',
        complete: false,
        missing: ['.eeg'],
        warning: null,
      })
      .mockReturnValue({ formatName: 'BrainVision', complete: true, missing: [], warning: null });
    detectAndLoadEEG.mockResolvedValue({ data: [[0, 1]], channelNames: ['Ch1'] });
    render(<PatientView />);

    // First drop: header only
    await act(async () => {
      await getEegOnFiles()([makeFile('sub01.vhdr')]);
    });

    // Second drop: data file — onFiles now closes over pendingEegFiles=[sub01.vhdr]
    await act(async () => {
      await getEegOnFiles()([makeFile('sub01.eeg')]);
    });

    // checkEegFiles should have been called with both files on the second drop
    const secondCallFiles = checkEegFiles.mock.calls[1][0];
    const names = secondCallFiles.map((f) => f.name);
    expect(names).toContain('sub01.vhdr');
    expect(names).toContain('sub01.eeg');
  });

  it('a new drop of the same extension replaces the pending file of that type', async () => {
    checkEegFiles.mockReturnValue({
      formatName: 'BrainVision',
      complete: false,
      missing: ['.eeg'],
      warning: null,
    });
    render(<PatientView />);

    // Drop sub01.vhdr, then sub02.vhdr — the second should replace the first
    await act(async () => {
      await getEegOnFiles()([makeFile('sub01.vhdr')]);
    });
    await act(async () => {
      await getEegOnFiles()([makeFile('sub02.vhdr')]);
    });

    const lastCallFiles = checkEegFiles.mock.lastCall[0];
    const vhdrFiles = lastCallFiles.filter((f) => f.name.endsWith('.vhdr'));
    expect(vhdrFiles).toHaveLength(1);
    expect(vhdrFiles[0].name).toBe('sub02.vhdr');
  });
});

describe('PatientView — imaging file-type detection', () => {
  beforeEach(() => {
    FileDropZone.mockClear();
    NiiViewer.mockClear();
    checkEegFiles.mockReturnValue({
      formatName: null,
      complete: false,
      missing: null,
      warning: null,
    });
  });

  it('passes type MRI to NiiViewer for a BIDS T1w file', async () => {
    render(<PatientView />);

    await act(async () => {
      await getNiiOnFiles()([makeFile('sub-01_T1w.nii')]);
    });

    const volumes = NiiViewer.mock.lastCall[0].volumes;
    expect(volumes).toHaveLength(1);
    expect(volumes[0].type).toBe('MRI');
  });

  it('passes type PET to NiiViewer for a BIDS pet file', async () => {
    render(<PatientView />);

    await act(async () => {
      await getNiiOnFiles()([makeFile('sub-01_pet.nii.gz')]);
    });

    expect(NiiViewer.mock.lastCall[0].volumes[0].type).toBe('PET');
  });

  it('passes type SPECT to NiiViewer for a siscom file', async () => {
    render(<PatientView />);

    await act(async () => {
      await getNiiOnFiles()([makeFile('pat_siscom_17-13.nii')]);
    });

    expect(NiiViewer.mock.lastCall[0].volumes[0].type).toBe('SPECT');
  });
});
