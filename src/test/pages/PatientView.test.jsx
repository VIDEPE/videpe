import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { PatientView } from '@/pages/PatientView';

const renderPatientView = () =>
  render(
    <MemoryRouter>
      <PatientView />
    </MemoryRouter>
  );
import toast from 'react-hot-toast';
import { loadBrainVisionEEG } from '@/loaders/loadBrainVisionEEG';
import { checkEegFiles, detectAndLoadEEG } from '@/loaders/eegFormats';
import { parseInverseSolutionFieldtrip } from '@/loaders/parseInverseSolutionFieldtrip';
import { electricalSourceImaging } from '@/utils/electricalSourceImagingUtils';
import { FileDropZone } from '@/components/FileDropZone';
import { NiiViewer } from '@/components/NiiViewer';
import { EegViewer } from '@/components/EegViewer';

// toast(...) itself must be callable (used for plain info toasts), with toast.promise
// just running and returning the promise, and toast.error a no-op.
vi.mock('react-hot-toast', () => {
  const toastFn = vi.fn();
  toastFn.promise = vi.fn().mockImplementation((p) => p);
  toastFn.error = vi.fn();
  toastFn.loading = vi.fn();
  toastFn.success = vi.fn();
  toastFn.dismiss = vi.fn();
  return { default: toastFn };
});

vi.mock('@/loaders/loadBrainVisionEEG', () => ({
  loadBrainVisionEEG: vi
    .fn()
    .mockResolvedValue({ channelNames: ['Ch1'], fs: 1, tMax: 1, getChunk: vi.fn() }),
}));

vi.mock('@/loaders/eegFormats', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual, // preserves ELEC_POS_EXTENSIONS, INV_SOLUTIONS_EXTENSIONS, etc.
    checkEegFiles: vi.fn(),
    detectAndLoadEEG: vi.fn(),
  };
});

vi.mock('@/components/EegViewer', () => ({
  EegViewer: vi.fn(
    ({
      customElectrodes,
      customElecPosFileName,
      onIntracranialSnapshotChange,
      onChannelSnapshotChange,
      montage,
      onMontageChange,
    }) => (
      <div data-testid="eeg-viewer">
        <span data-testid="eeg-custom-electrodes-count">{customElectrodes?.length ?? 0}</span>
        <span data-testid="eeg-custom-filename">{customElecPosFileName ?? ''}</span>
        <span data-testid="eeg-montage">{montage}</span>
        {/* Simulates EegViewer reporting live intracranial electrode/voltage state, the way it
          would after detecting an intracranial recording and matching a position file. */}
        <button
          type="button"
          data-testid="trigger-intracranial-change"
          onClick={() =>
            onIntracranialSnapshotChange?.({
              isIntracranial: true,
              matched: [{ channelIdx: 0, name: 'B1', pos: { label: 'B1', x: 0, y: 0, z: 0 } }],
              voltages: [5],
            })
          }
        >
          trigger
        </button>
        {/* Simulates EegViewer reporting a per-click channel snapshot, the way it would
            after the user clicks a point on the EEG plot. */}
        <button
          type="button"
          data-testid="trigger-channel-snapshot"
          onClick={() =>
            onChannelSnapshotChange?.({
              isIntracranial: false,
              channelNames: ['1', '2'],
              voltages: [1, 2],
            })
          }
        >
          trigger-channel-snapshot
        </button>
        {/* Simulates the user selecting a montage from EegViewer's dropdown */}
        <button
          type="button"
          data-testid="set-montage-none"
          onClick={() => onMontageChange?.('none')}
        >
          set-montage-none
        </button>
        <button
          type="button"
          data-testid="set-montage-average"
          onClick={() => onMontageChange?.('average')}
        >
          set-montage-average
        </button>
      </div>
    )
  ),
}));
vi.mock('@/components/NiiViewer', () => ({
  NiiViewer: vi.fn(() => <div data-testid="nii-viewer" />),
}));
vi.mock('@/components/FileDropZone', () => ({ FileDropZone: vi.fn(() => null) }));

vi.mock('@/loaders/parseInverseSolutionFieldtrip', () => ({
  parseInverseSolutionFieldtrip: vi.fn().mockResolvedValue({
    format: 'FieldTrip',
    flatSourceFilters: new Float64Array([1, 0, 0, 1, 0, 0]),
    insideSourcePositions: [[-5, 15, 10]],
    nInsideSources: 1,
    nChannels: 2,
    channelLabels: ['1', '2'],
    sourcePositions: [[-5, 15, 10]],
    insideMask: [1],
    indicesInsideSources: [0],
  }),
}));
vi.mock('@/components/ThemeToggle', () => ({ ThemeToggle: () => null }));

// electricalSourceImaging's own computation is covered by its dedicated unit tests
// (electricalSourceImagingUtils.test.js) — stub it here so PatientView's montage-gating
// logic can be tested in isolation from the fixture's grid/affine data.
vi.mock('@/utils/electricalSourceImagingUtils', () => ({
  electricalSourceImaging: vi.fn(),
}));

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

const getDemoResetButton = () =>
  screen.getByRole('button', { name: /^(load demo|reset|loading…)$/i });

describe('PatientView — button label', () => {
  beforeEach(() => {
    FileDropZone.mockClear();
    detectAndLoadEEG.mockResolvedValue({
      channelNames: ['Ch1'],
      fs: 1,
      tMax: 1,
      getChunk: vi.fn(),
    });
  });

  it('shows "Load Demo" before any data is loaded', () => {
    checkEegFiles.mockReturnValue({
      formatName: null,
      complete: false,
      missing: null,
      warning: null,
    });
    renderPatientView();
    expect(getDemoResetButton()).toHaveTextContent(/load demo/i);
  });

  it('shows "Reset" when there are pending EEG files', async () => {
    checkEegFiles.mockReturnValue({
      formatName: 'BrainVision',
      complete: false,
      missing: ['.eeg'],
      warning: null,
    });
    renderPatientView();

    await act(async () => {
      await getEegOnFiles()([makeFile('sub01.vhdr')]);
    });

    expect(getDemoResetButton()).toHaveTextContent(/reset/i);
  });

  it('shows "Reset" and renders EegViewer after EEG loads successfully', async () => {
    checkEegFiles.mockReturnValue({
      formatName: 'BrainVision',
      complete: true,
      missing: [],
      warning: null,
    });
    renderPatientView();

    await act(async () => {
      await getEegOnFiles()([makeFile('sub01.vhdr'), makeFile('sub01.eeg')]);
    });

    expect(getDemoResetButton()).toHaveTextContent(/reset/i);
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
    detectAndLoadEEG.mockResolvedValue({
      channelNames: ['Ch1'],
      fs: 1,
      tMax: 1,
      getChunk: vi.fn(),
    });
  });

  it('clicking Reset returns to "Load Demo" and removes EegViewer', async () => {
    const user = userEvent.setup();
    renderPatientView();

    await act(async () => {
      await getEegOnFiles()([makeFile('sub01.vhdr'), makeFile('sub01.eeg')]);
    });

    await user.click(getDemoResetButton()); // Reset

    expect(getDemoResetButton()).toHaveTextContent(/load demo/i);
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
    detectAndLoadEEG.mockResolvedValue({
      channelNames: ['Ch1'],
      fs: 1,
      tMax: 1,
      getChunk: vi.fn(),
    });
    renderPatientView();

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
    renderPatientView();

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

describe('PatientView — demo loading', () => {
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

  it('passes demo volumes with correct type and subtype to NiiViewer', async () => {
    renderPatientView();

    // fireEvent instead of userEvent — handleLoadDemo never fully resolves because the mocked
    // NiiViewer and EegViewer never call onViewReady, so Promise.all([eegReady, niiReady]) hangs.
    // waitFor flushes pending microtasks between retries, letting setVolumes fire.
    fireEvent.click(screen.getByRole('button', { name: /load demo/i }));

    await waitFor(() => {
      expect(NiiViewer).toHaveBeenCalled();
      expect(NiiViewer.mock.lastCall[0].layers).toHaveLength(3);
    });

    const layers = NiiViewer.mock.lastCall[0].layers;
    expect(layers[0]).toMatchObject({ type: 'MRI', subtype: 'patT1' });
    expect(layers[1]).toMatchObject({ type: 'PET', subtype: 'pat_PET_aligned' });
    expect(layers[2]).toMatchObject({ type: 'SPECT', subtype: 'pat_siscom_17-13' });
  });

  it('renders both EegViewer and NiiViewer once demo data is loaded', async () => {
    renderPatientView();
    fireEvent.click(screen.getByRole('button', { name: /load demo/i }));

    await waitFor(() => {
      expect(screen.getByTestId('eeg-viewer')).toBeInTheDocument();
      expect(screen.getByTestId('nii-viewer')).toBeInTheDocument();
    });
  });

  it('shows loading indicator and disables button while demo loads', async () => {
    renderPatientView();
    fireEvent.click(screen.getByRole('button', { name: /load demo/i }));

    await waitFor(() => {
      expect(getDemoResetButton()).toHaveTextContent(/loading/i);
      expect(getDemoResetButton()).toBeDisabled();
    });
  });

  it('resets to "Load Demo" when demo data fails to load', async () => {
    const { default: toast } = await import('react-hot-toast');
    // Swallow the rejection like the real toast.promise does, so it doesn't leak as an unhandled rejection
    toast.promise.mockImplementationOnce((p) => p.catch(() => {}));

    loadBrainVisionEEG.mockRejectedValueOnce(new Error('Network error'));
    renderPatientView();
    fireEvent.click(screen.getByRole('button', { name: /load demo/i }));

    await waitFor(() => expect(getDemoResetButton()).toHaveTextContent(/load demo/i));
    expect(screen.queryByTestId('nii-viewer')).not.toBeInTheDocument();
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
    renderPatientView();

    await act(async () => {
      await getNiiOnFiles()([makeFile('sub-01_T1w.nii')]);
    });

    expect(NiiViewer.mock.lastCall[0].layers).toHaveLength(1);
    expect(NiiViewer.mock.lastCall[0].layers[0].type).toBe('MRI');
  });

  it('passes subtype as nameWithoutExtension to NiiViewer for a BIDS T1w file', async () => {
    renderPatientView();

    await act(async () => {
      await getNiiOnFiles()([makeFile('sub-01_T1w.nii')]);
    });

    expect(NiiViewer.mock.lastCall[0].layers[0].subtype).toBe('sub-01_T1w');
  });

  it('passes subtype as nameWithoutExtension to NiiViewer for a keyword-matched file', async () => {
    renderPatientView();

    await act(async () => {
      await getNiiOnFiles()([makeFile('patT1.nii')]);
    });

    expect(NiiViewer.mock.lastCall[0].layers[0].subtype).toBe('patT1');
  });

  it('passes type PET to NiiViewer for a BIDS pet file', async () => {
    renderPatientView();

    await act(async () => {
      await getNiiOnFiles()([makeFile('sub-01_pet.nii.gz')]);
    });

    expect(NiiViewer.mock.lastCall[0].layers[0].type).toBe('PET');
  });

  it('passes type SPECT to NiiViewer for a siscom file', async () => {
    renderPatientView();

    await act(async () => {
      await getNiiOnFiles()([makeFile('pat_siscom_17-13.nii')]);
    });

    expect(NiiViewer.mock.lastCall[0].layers[0].type).toBe('SPECT');
  });
});

// Minimal BIDS-style electrodes.tsv — two real parseable positions (LPA/RPA/Nz fiducials
// are excluded by the parser, so just two electrode rows keeps this self-contained).
const MINIMAL_TSV = `name\tx\ty\tz\nB1\t0\t0\t0\nB2\t1\t1\t1\n`;

describe('PatientView — electrode position files', () => {
  beforeEach(() => {
    FileDropZone.mockClear();
    EegViewer.mockClear();
    checkEegFiles.mockClear(); // checkEegFiles is shared across describe blocks in this file — clear its call history too
    checkEegFiles.mockReturnValue({
      formatName: null,
      complete: false,
      missing: null,
      warning: null,
    });
  });

  it('accepts .elc and .tsv at the initial EEG dropzone', () => {
    renderPatientView();
    const eegDropZoneProps = FileDropZone.mock.calls.find(([p]) => p.label === 'Drop EEG files')[0];
    expect(eegDropZoneProps.accepted_formats).toContain('.elc');
    expect(eegDropZoneProps.accepted_formats).toContain('.tsv');
  });

  it('routes a dropped .tsv file to electrode position parsing instead of EEG accumulation', async () => {
    renderPatientView();
    const file = new File([MINIMAL_TSV], 'positions.tsv');

    await act(async () => {
      await getEegOnFiles()([file]);
    });

    expect(checkEegFiles).not.toHaveBeenCalled(); // pure position-file drop never reaches EEG accumulation
  });

  // EegViewer only mounts once an EEG recording is loaded, so these tests load one first —
  // otherwise there is no rendered component whose props could ever surface customElectrodes.
  it('passes parsed customElectrodes and the filename down to EegViewer', async () => {
    checkEegFiles.mockReturnValue({
      formatName: 'BrainVision',
      complete: true,
      missing: [],
      warning: null,
    });
    detectAndLoadEEG.mockResolvedValue({ channelNames: ['B1'], fs: 1, tMax: 1, getChunk: vi.fn() });
    renderPatientView();
    await act(async () => {
      await getEegOnFiles()([makeFile('sub01.vhdr'), makeFile('sub01.eeg')]);
    });

    const file = new File([MINIMAL_TSV], 'positions.tsv');
    await act(async () => {
      await getEegOnFiles()([file]);
    });

    expect(EegViewer.mock.lastCall[0].customElectrodes).toHaveLength(2);
    expect(EegViewer.mock.lastCall[0].customElecPosFileName).toBe('positions');
  });

  it('processes both an EEG file and an electrode position file dropped together', async () => {
    checkEegFiles.mockReturnValue({
      formatName: 'BrainVision',
      complete: true,
      missing: [],
      warning: null,
    });
    detectAndLoadEEG.mockResolvedValue({ channelNames: ['B1'], fs: 1, tMax: 1, getChunk: vi.fn() });
    renderPatientView();

    await act(async () => {
      await getEegOnFiles()([
        makeFile('sub01.vhdr'),
        makeFile('sub01.eeg'),
        new File([MINIMAL_TSV], 'positions.tsv'),
      ]);
    });

    expect(screen.getByTestId('eeg-viewer')).toBeInTheDocument();
    expect(EegViewer.mock.lastCall[0].customElectrodes).toHaveLength(2);
  });

  it('a later drop overwrites previously loaded electrode positions', async () => {
    checkEegFiles.mockReturnValue({
      formatName: 'BrainVision',
      complete: true,
      missing: [],
      warning: null,
    });
    detectAndLoadEEG.mockResolvedValue({ channelNames: ['B1'], fs: 1, tMax: 1, getChunk: vi.fn() });
    renderPatientView();
    await act(async () => {
      await getEegOnFiles()([makeFile('sub01.vhdr'), makeFile('sub01.eeg')]);
    });

    await act(async () => {
      await getEegOnFiles()([new File([MINIMAL_TSV], 'positions.tsv')]);
    });
    expect(EegViewer.mock.lastCall[0].customElectrodes).toHaveLength(2);

    const secondTsv = `name\tx\ty\tz\nT1\t2\t2\t2\n`;
    await act(async () => {
      await getEegOnFiles()([new File([secondTsv], 'other.tsv')]);
    });

    expect(EegViewer.mock.lastCall[0].customElectrodes).toHaveLength(1);
    expect(EegViewer.mock.lastCall[0].customElecPosFileName).toBe('other');
  });

  it('clears customElectrodes on reset', async () => {
    checkEegFiles.mockReturnValue({
      formatName: 'BrainVision',
      complete: true,
      missing: [],
      warning: null,
    });
    detectAndLoadEEG.mockResolvedValue({ channelNames: ['B1'], fs: 1, tMax: 1, getChunk: vi.fn() });
    renderPatientView();

    await act(async () => {
      await getEegOnFiles()([makeFile('sub01.vhdr'), makeFile('sub01.eeg')]);
    });
    await act(async () => {
      await getEegOnFiles()([new File([MINIMAL_TSV], 'positions.tsv')]);
    });
    expect(EegViewer.mock.lastCall[0].customElectrodes).toHaveLength(2);

    await userEvent.click(getDemoResetButton()); // Reset
    await act(async () => {
      await getEegOnFiles()([makeFile('sub02.vhdr'), makeFile('sub02.eeg')]);
    });

    expect(EegViewer.mock.lastCall[0].customElectrodes).toHaveLength(0);
  });
});

describe('PatientView — inverse solution files', () => {
  beforeEach(() => {
    FileDropZone.mockClear();
    EegViewer.mockClear();
    checkEegFiles.mockClear();
    checkEegFiles.mockReturnValue({
      formatName: null,
      complete: false,
      missing: null,
      warning: null,
    });
    parseInverseSolutionFieldtrip.mockClear();
  });

  it('accepts .mat at the initial EEG dropzone', () => {
    renderPatientView();
    const eegDropZoneProps = FileDropZone.mock.calls.find(([p]) => p.label === 'Drop EEG files')[0];
    expect(eegDropZoneProps.accepted_formats).toContain('.mat');
  });

  it('routes a dropped .mat file to parseInverseSolutionFieldtrip instead of EEG accumulation', async () => {
    renderPatientView();
    const file = makeFile('sub-19_meth-eloreta_desc-nonorm_inversefilters.mat');

    await act(async () => {
      await getEegOnFiles()([file]);
    });

    expect(parseInverseSolutionFieldtrip).toHaveBeenCalledWith(file);
    expect(checkEegFiles).not.toHaveBeenCalled();
  });

  it('processes both an EEG file and an inverse solution file dropped together', async () => {
    checkEegFiles.mockReturnValue({
      formatName: 'BrainVision',
      complete: true,
      missing: [],
      warning: null,
    });
    detectAndLoadEEG.mockResolvedValue({
      channelNames: ['1', '2'],
      fs: 256,
      tMax: 10,
      getChunk: vi.fn(),
    });
    renderPatientView();

    await act(async () => {
      await getEegOnFiles()([
        makeFile('sub01.vhdr'),
        makeFile('sub01.eeg'),
        makeFile('sub-19_inversefilters.mat'),
      ]);
    });

    expect(screen.getByTestId('eeg-viewer')).toBeInTheDocument();
    expect(parseInverseSolutionFieldtrip).toHaveBeenCalled();
  });
});

describe('PatientView — ESI requires the Average montage', () => {
  const loadEegAndInverseSolution = async () => {
    checkEegFiles.mockReturnValue({
      formatName: 'BrainVision',
      complete: true,
      missing: [],
      warning: null,
    });
    detectAndLoadEEG.mockResolvedValue({
      channelNames: ['1', '2'],
      fs: 256,
      tMax: 10,
      getChunk: vi.fn(),
    });
    // A loaded imaging layer keeps NiiViewer mounted regardless of esiLayer, so
    // esiLayer's null/non-null value can be asserted directly off NiiViewer's props.
    await act(async () => {
      await getNiiOnFiles()([makeFile('sub-01_T1w.nii')]);
    });
    await act(async () => {
      await getEegOnFiles()([
        makeFile('sub01.vhdr'),
        makeFile('sub01.eeg'),
        makeFile('sub-19_inversefilters.mat'),
      ]);
    });
  };

  beforeEach(() => {
    FileDropZone.mockClear();
    NiiViewer.mockClear();
    EegViewer.mockClear();
    checkEegFiles.mockClear();
    parseInverseSolutionFieldtrip.mockClear();
    toast.mockClear();
    electricalSourceImaging.mockReset();
    electricalSourceImaging.mockReturnValue({
      sourcePowerConnectomes: { fake: 'connectome' },
      sourcePowerVolume: { fake: 'volume' },
    });
  });

  it('forces the montage to Average and shows a toast when an inverse solution file is loaded', async () => {
    renderPatientView();
    await loadEegAndInverseSolution();

    expect(screen.getByTestId('eeg-montage').textContent).toBe('average');
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/average/i));
  });

  it('hides the ESI layer and toasts when the montage is switched away from Average', async () => {
    renderPatientView();
    await loadEegAndInverseSolution();
    await userEvent.click(screen.getByTestId('trigger-channel-snapshot'));
    expect(NiiViewer.mock.lastCall[0].esiLayer).toBeTruthy();

    toast.mockClear();
    await userEvent.click(screen.getByTestId('set-montage-none'));

    expect(screen.getByTestId('eeg-montage').textContent).toBe('none');
    expect(NiiViewer.mock.lastCall[0].esiLayer).toBeNull();
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/average/i));
  });

  it('shows the ESI layer again when the montage is switched back to Average', async () => {
    renderPatientView();
    await loadEegAndInverseSolution();
    await userEvent.click(screen.getByTestId('trigger-channel-snapshot'));
    await userEvent.click(screen.getByTestId('set-montage-none'));
    expect(NiiViewer.mock.lastCall[0].esiLayer).toBeNull();

    await userEvent.click(screen.getByTestId('set-montage-average'));

    expect(NiiViewer.mock.lastCall[0].esiLayer).toBeTruthy();
  });

  it('does not toast about ESI when the montage changes with no inverse solution loaded', async () => {
    checkEegFiles.mockReturnValue({
      formatName: 'BrainVision',
      complete: true,
      missing: [],
      warning: null,
    });
    detectAndLoadEEG.mockResolvedValue({
      channelNames: ['1', '2'],
      fs: 256,
      tMax: 10,
      getChunk: vi.fn(),
    });
    renderPatientView();
    await act(async () => {
      await getEegOnFiles()([makeFile('sub01.vhdr'), makeFile('sub01.eeg')]);
    });

    await userEvent.click(screen.getByTestId('set-montage-none'));

    expect(toast).not.toHaveBeenCalled();
  });
});

describe('PatientView — intracranial connectome layer', () => {
  beforeEach(() => {
    FileDropZone.mockClear();
    NiiViewer.mockClear();
    EegViewer.mockClear();
    checkEegFiles.mockReturnValue({
      formatName: 'BrainVision',
      complete: true,
      missing: [],
      warning: null,
    });
    detectAndLoadEEG.mockResolvedValue({ channelNames: ['B1'], fs: 1, tMax: 1, getChunk: vi.fn() });
  });

  it('shows NiiViewer with a connectome layer once EegViewer reports intracranial electrode data, even with no imaging volumes loaded', async () => {
    renderPatientView();
    await act(async () => {
      await getEegOnFiles()([makeFile('sub01.vhdr'), makeFile('sub01.eeg')]);
    });

    expect(screen.queryByTestId('nii-viewer')).not.toBeInTheDocument(); // no imaging volumes yet

    await userEvent.click(screen.getByTestId('trigger-intracranial-change'));

    expect(screen.getByTestId('nii-viewer')).toBeInTheDocument();
    expect(NiiViewer.mock.lastCall[0].intracranialLayer).toMatchObject({ kind: 'connectome' });
  });

  it('clears the connectome layer on reset', async () => {
    renderPatientView();
    await act(async () => {
      await getEegOnFiles()([makeFile('sub01.vhdr'), makeFile('sub01.eeg')]);
    });
    await userEvent.click(screen.getByTestId('trigger-intracranial-change'));
    expect(screen.getByTestId('nii-viewer')).toBeInTheDocument();

    await userEvent.click(getDemoResetButton()); // Reset

    expect(screen.queryByTestId('nii-viewer')).not.toBeInTheDocument();
  });
});
