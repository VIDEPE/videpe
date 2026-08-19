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
import { Niivue } from '@niivue/niivue';
import { dicomLoader } from '@niivue/dicom-loader';
import { loadBrainVisionEEG } from '@/loaders/loadBrainVisionEEG';
import { checkEegFiles, detectAndLoadEEG } from '@/loaders/eegFormatRegistry';
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

vi.mock('@/loaders/eegFormatRegistry', async (importOriginal) => {
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
      inverseSolutionFileName,
      onElectrodeSnapshotChange,
      onChannelSnapshotChange,
      onChannelTypesChange,
      onInverseSolutionFile,
      onTopoNvReady,
      onTopoHasContentChange,
      electrodeRenderEnabled,
      onElectrodeRenderChange,
      esiEnabled,
      onEsiEnabledChange,
    }) => (
      <div data-testid="eeg-viewer">
        <span data-testid="eeg-custom-electrodes-count">{customElectrodes?.length ?? 0}</span>
        <span data-testid="eeg-custom-filename">{customElecPosFileName ?? ''}</span>
        <span data-testid="eeg-inverse-solution-filename">{inverseSolutionFileName ?? ''}</span>
        <span data-testid="eeg-electrode-render-enabled">{String(electrodeRenderEnabled)}</span>
        <span data-testid="eeg-esi-enabled">{String(esiEnabled)}</span>
        {/* Simulates clicking the 3D electrode-render toggle button in EegViewer's panel */}
        <button
          type="button"
          data-testid="enable-electrode-render"
          onClick={() => onElectrodeRenderChange?.(true)}
        >
          enable-electrode-render
        </button>
        <button
          type="button"
          data-testid="disable-electrode-render"
          onClick={() => onElectrodeRenderChange?.(false)}
        >
          disable-electrode-render
        </button>
        {/* Simulates clicking the ESI toggle button in EegViewer's panel */}
        <button type="button" data-testid="enable-esi" onClick={() => onEsiEnabledChange?.(true)}>
          enable-esi
        </button>
        <button type="button" data-testid="disable-esi" onClick={() => onEsiEnabledChange?.(false)}>
          disable-esi
        </button>
        {/* Simulates EegViewer reporting live intracranial electrode/voltage state, the way it
          would after detecting an intracranial recording and matching a position file. */}
        <button
          type="button"
          data-testid="trigger-intracranial-change"
          onClick={() =>
            onElectrodeSnapshotChange?.({
              isIntracranial: true,
              matched: [
                { channelIdx: 0, name: 'B1', pos: { label: 'B1', x: 0, y: 0, z: 0 }, type: 'seeg' },
              ],
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
        {/* Simulates EegViewer reporting channelTypes independent of any plot click (real
            EegViewer does this via its own onChannelTypesChange effect on every montage-
            editor edit) — channel "1" (one of the default parseInverseSolutionFieldtrip
            mock's inverseSolutionChannelNames, ['1','2']) is itself typed SEEG here, the
            scenario findSeegChannelsAmongNeeded/the ESI toast and LED now check. */}
        <button
          type="button"
          data-testid="trigger-channel-types-seeg"
          onClick={() => onChannelTypesChange?.(['seeg', 'eeg'])}
        >
          trigger-channel-types-seeg
        </button>
        {/* Same as above, but channel "1" (one of the default parseInverseSolutionFieldtrip
            mock's inverseSolutionChannelNames, ['1','2']) is itself typed SEEG — the scenario
            findSeegChannelsAmongNeeded/the ESI toast now checks, scoped to just the
            channels the model needs rather than the recording's overall majority type. */}
        <button
          type="button"
          data-testid="trigger-channel-snapshot-seeg"
          onClick={() =>
            onChannelSnapshotChange?.({
              isIntracranial: false,
              channelNames: ['1', '2'],
              channelTypes: ['seeg', 'eeg'],
              voltages: [5, 6],
            })
          }
        >
          trigger-channel-snapshot-seeg
        </button>
        {/* Simulates dropping a file on EegViewer's own persistent dropzone — unlike the
            initial "Drop EEG files" dropzone (which unmounts once EEG is loaded, freezing
            its onFiles closure), this prop is passed fresh on every PatientView re-render,
            so it's the only way to exercise channelSnapshot-dependent behaviour in
            onInverseSolutionFile after the channel snapshot has changed post-load. */}
        <button
          type="button"
          data-testid="trigger-inverse-solution-file"
          onClick={() => onInverseSolutionFile?.(new File([''], 'sub-19_inversefilters.mat'))}
        >
          trigger-inverse-solution-file
        </button>
        {/* Simulates EegViewer reporting the loss of intracranial data on switching to EEG
            mode (isIntracranial: false) — mirrors how real auto-detection would report it,
            as opposed to trigger-intracranial-change above which only ever reports true. */}
        <button
          type="button"
          data-testid="trigger-intracranial-clear"
          onClick={() =>
            onElectrodeSnapshotChange?.({ isIntracranial: false, matched: [], voltages: [] })
          }
        >
          trigger-intracranial-clear
        </button>
        {/* Simulates EegTopoViewer's NiiVue canvas attaching (real EegViewer forwards this
            from EegTopoViewer's onTopoNvReady prop once mounted) */}
        <button type="button" data-testid="trigger-topo-nv-ready" onClick={() => onTopoNvReady?.()}>
          trigger-topo-nv-ready
        </button>
        {/* Simulates the topography mesh appearing/disappearing — e.g. the topo window being
            opened/closed, or an electrode file being loaded/cleared. */}
        <button
          type="button"
          data-testid="trigger-topo-has-content"
          onClick={() => onTopoHasContentChange?.(true)}
        >
          trigger-topo-has-content
        </button>
        <button
          type="button"
          data-testid="trigger-topo-no-content"
          onClick={() => onTopoHasContentChange?.(false)}
        >
          trigger-topo-no-content
        </button>
      </div>
    )
  ),
}));
vi.mock('@/components/NiiViewer', () => ({
  NiiViewer: vi.fn(
    ({
      layers,
      onHasContentChange,
      onHas3DExtentChange,
      onNiiNvReady,
      onElectrodeLayerDismissed,
      onLoadError,
    }) => (
      <div data-testid="nii-viewer">
        {/* Simulates NiiViewer reporting that it holds layers loaded straight into its own
          internal dropzone — layers PatientView has no other visibility into (they never
          touch the `layers`/electrodeLayer/esiLayer props). */}
        <button
          type="button"
          data-testid="trigger-nii-has-content"
          onClick={() => onHasContentChange?.(true)}
        >
          trigger-nii-has-content
        </button>
        {/* Simulates real NiiViewer/useLayerLoader reporting that every layer passed via the
          `layers` prop failed to load (e.g. an unsupported/corrupt file) — PatientView uses
          this to drop the failed layers back out of its own `layers` state so the panel
          reverts to the dropzone instead of staying stuck on a broken, permanently-mounted
          NiiViewer. */}
        <button
          type="button"
          data-testid="trigger-nii-load-error"
          onClick={() => onLoadError?.(new Set((layers ?? []).map((l) => l.url)))}
        >
          trigger-nii-load-error
        </button>
        {/* Simulates the user deleting the electrode-connectome card from NiiViewer's layer
          list — real NiiViewer calls this from handleDeleteLayer so PatientView can flip
          the 3D electrode-render toggle back off. */}
        <button
          type="button"
          data-testid="trigger-electrode-layer-dismissed"
          onClick={() => onElectrodeLayerDismissed?.()}
        >
          trigger-electrode-layer-dismissed
        </button>
        {/* Simulates NiiViewer's NiiVue canvas attaching */}
        <button type="button" data-testid="trigger-nii-nv-ready" onClick={() => onNiiNvReady?.()}>
          trigger-nii-nv-ready
        </button>
        {/* Simulates NiiViewer reporting whether its 3D scene has a usable spatial extent —
          true once a volume/mesh is present, false when only connectome layers remain (e.g.
          after resetting the imaging panel down to just an ESI connectome). */}
        <button
          type="button"
          data-testid="trigger-nii-has-3d-extent"
          onClick={() => onHas3DExtentChange?.(true)}
        >
          trigger-nii-has-3d-extent
        </button>
        <button
          type="button"
          data-testid="trigger-nii-no-3d-extent"
          onClick={() => onHas3DExtentChange?.(false)}
        >
          trigger-nii-no-3d-extent
        </button>
      </div>
    )
  ),
}));
vi.mock('@/components/FileDropZone', () => ({ FileDropZone: vi.fn(() => null) }));

// PatientView constructs two real Niivue instances itself (nvRef_niiviewer/nvRef_eegtopo) to
// link their 3D rotation via broadcastTo — mock just the class so its calls can be inspected
// without a real WebGL context, while keeping every other export real: NiiViewer.utils'
// filesToLayers (used below) depends on the real isMeshExt, and other modules imported
// transitively depend on SLICE_TYPE/NVImage/etc.
vi.mock('@niivue/niivue', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    Niivue: vi.fn().mockImplementation(function () {
      return { broadcastTo: vi.fn() };
    }),
  };
});

// @niivue/dcm2niix (dicomLoader's WASM/worker dependency) doesn't load under jsdom, so it's
// mocked here too — dropping a .dcm file exercises this instead of the real dcm2niix.
vi.mock('@niivue/dicom-loader', () => ({
  dicomLoader: vi.fn(),
}));

vi.mock('@/loaders/parseInverseSolutionFieldtrip', () => ({
  parseInverseSolutionFieldtrip: vi.fn().mockResolvedValue({
    format: 'FieldTrip',
    flatSourceFilters: new Float64Array([1, 0, 0, 1, 0, 0]),
    insideSourcePositions: [[-5, 15, 10]],
    nInsideSources: 1,
    nChannels: 2,
    inverseSolutionChannelNames: ['1', '2'],
    sourcePositions: [[-5, 15, 10]],
    insideMask: [1],
    indicesInsideSources: [0],
  }),
}));
vi.mock('@/components/ThemeToggle', () => ({ ThemeToggle: () => null }));

// electricalSourceImaging's own computation is covered by its dedicated unit tests
// (electricalSourceImagingUtils.test.js) — stub it here so PatientView's montage-gating
// logic can be tested in isolation from the fixture's grid/affine data.
// matchChannelsToInverseSolution/matchVoltagesToInverseSolution stay real (pure string
// matching, no heavy fixture needed) — only the fixture-heavy electricalSourceImaging is
// mocked.
vi.mock('@/utils/electricalSourceImagingUtils', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    electricalSourceImaging: vi.fn(),
  };
});

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

describe('PatientView — EEG duplicate channel names', () => {
  beforeEach(() => {
    FileDropZone.mockClear();
    checkEegFiles.mockReturnValue({
      formatName: 'BrainVision',
      complete: true,
      missing: [],
      warning: null,
    });
  });

  it('rejects a recording with a duplicate channel name instead of loading it', async () => {
    const { default: toast } = await import('react-hot-toast');
    detectAndLoadEEG.mockResolvedValue({
      channelNames: ['1', '1', '2'],
      fs: 1,
      tMax: 1,
      getChunk: vi.fn(),
    });
    renderPatientView();

    await act(async () => {
      await getEegOnFiles()([makeFile('sub01.vhdr'), makeFile('sub01.eeg')]);
    });

    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/duplicate channel name.*1/i));
    expect(screen.queryByTestId('eeg-viewer')).not.toBeInTheDocument();
  });

  it('loads normally when every channel name is unique', async () => {
    detectAndLoadEEG.mockResolvedValue({
      channelNames: ['1', '2', '3'],
      fs: 1,
      tMax: 1,
      getChunk: vi.fn(),
    });
    renderPatientView();

    await act(async () => {
      await getEegOnFiles()([makeFile('sub01.vhdr'), makeFile('sub01.eeg')]);
    });

    expect(screen.getByTestId('eeg-viewer')).toBeInTheDocument();
  });
});

describe('PatientView — EEG dropzone rejects unsupported files', () => {
  beforeEach(() => {
    FileDropZone.mockClear();
    toast.error.mockClear();
    checkEegFiles.mockClear();
    checkEegFiles.mockReturnValue({
      formatName: null,
      complete: false,
      missing: null,
      warning: null,
    });
  });

  it('toasts an error and never calls checkEegFiles when only an imaging file is dropped', async () => {
    renderPatientView();

    await act(async () => {
      await getEegOnFiles()([makeFile('sub-01_T1w.nii')]);
    });

    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('sub-01_T1w.nii'));
    expect(checkEegFiles).not.toHaveBeenCalled();
  });

  it('does not hold an imaging file as a pending EEG file', async () => {
    renderPatientView();

    await act(async () => {
      await getEegOnFiles()([makeFile('sub-01_T1w.nii')]);
    });

    const eegDropZoneProps = FileDropZone.mock.calls
      .filter(([p]) => p.label === 'Drop EEG files')
      .at(-1)[0];
    expect(eegDropZoneProps.pendingFiles).toEqual([]);
  });

  it('rejects an imaging file dropped alongside a valid partial EEG file, without including it in the pending set', async () => {
    checkEegFiles.mockReturnValue({
      formatName: 'BrainVision',
      complete: false,
      missing: ['.eeg'],
      warning: null,
    });
    renderPatientView();

    await act(async () => {
      await getEegOnFiles()([makeFile('sub01.vhdr'), makeFile('sub-01_T1w.nii')]);
    });

    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('sub-01_T1w.nii'));
    const checkedFiles = checkEegFiles.mock.lastCall[0];
    expect(checkedFiles.map((f) => f.name)).not.toContain('sub-01_T1w.nii');
  });
});

describe('PatientView — demo loading', () => {
  beforeEach(() => {
    FileDropZone.mockClear();
    NiiViewer.mockClear();
    EegViewer.mockClear();
    parseInverseSolutionFieldtrip.mockClear();
    checkEegFiles.mockReturnValue({
      formatName: null,
      complete: false,
      missing: null,
      warning: null,
    });
    // Demo electrode positions/inverse solution are fetched by URL and wrapped as Files —
    // stub fetch so that path exercises the same parsers a manual file drop would.
    global.fetch = vi.fn((url) =>
      Promise.resolve({
        ok: true,
        blob: () =>
          Promise.resolve(
            new Blob([url.endsWith('.tsv') ? MINIMAL_TSV : 'irrelevant — mat parser is mocked'])
          ),
      })
    );
  });

  it('loads demo electrode positions and inverse solution, forwarding them to EegViewer', async () => {
    renderPatientView();
    fireEvent.click(screen.getByRole('button', { name: /load demo/i }));

    await waitFor(() => {
      expect(screen.getByTestId('eeg-custom-electrodes-count')).toHaveTextContent('2');
    });
    expect(screen.getByTestId('eeg-custom-filename')).toHaveTextContent('sub-synth_electrodes');
    expect(parseInverseSolutionFieldtrip).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'sub-synth_desc-unitnoiselcmv_inversefilters.mat' })
    );
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
    expect(layers[0]).toMatchObject({ type: 'MRI', subtype: 'sub-synth_T1w' });
    expect(layers[1]).toMatchObject({ type: 'sub-synth_label-WM_dseg', subtype: null });
    expect(layers[2]).toMatchObject({ type: 'sub-synth_label-CSF_dseg', subtype: null });
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

  it('converts a dropped DICOM series to a volume layer via dicomLoader', async () => {
    dicomLoader.mockResolvedValue([{ name: 'sub-01_T1w.nii', data: new ArrayBuffer(8) }]);
    renderPatientView();

    await act(async () => {
      await getNiiOnFiles()([makeFile('IM0001.dcm'), makeFile('IM0002.dcm')]);
    });

    expect(dicomLoader).toHaveBeenCalledTimes(1); // one call for the whole series, not per-file
    expect(NiiViewer.mock.lastCall[0].layers).toHaveLength(1);
    expect(NiiViewer.mock.lastCall[0].layers[0].type).toBe('MRI');
  });

  it('accepts .dcm at the imaging dropzone', () => {
    renderPatientView();
    const niiDropZoneProps = FileDropZone.mock.calls.find(
      ([p]) => p.label === 'Drop imaging files'
    )[0];
    expect(niiDropZoneProps.accepted_formats).toContain('.dcm');
  });
});

describe('PatientView — imaging load-failure recovery', () => {
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

  // NiiViewer optimistically mounts as soon as a file is dropped (before the real NiiVue
  // instance has actually loaded it — see the "shows a loading spinner" tests in
  // NiiViewer.test.jsx). NiiViewer/useLayerLoader should report a failed load back up via
  // onLoadError (simulated here by the mock's trigger-nii-load-error button — see the mock
  // above). Previously PatientView had no handler for this, so a failed load (an
  // unsupported filetype, a corrupt file, ...) left `layers` permanently non-empty and
  // NiiViewer stuck mounted in a broken state instead of reverting to the dropzone.
  it('reverts to the imaging dropzone once NiiViewer reports the dropped file failed to load', async () => {
    renderPatientView();

    await act(async () => {
      await getNiiOnFiles()([makeFile('sub-01_T1w.nii')]);
    });
    expect(screen.getByTestId('nii-viewer')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('trigger-nii-load-error'));

    expect(screen.queryByTestId('nii-viewer')).not.toBeInTheDocument();
  });

  it('keeps NiiViewer mounted with only the still-successful layers when one of several dropped files fails to load', async () => {
    renderPatientView();

    await act(async () => {
      await getNiiOnFiles()([makeFile('sub-01_T1w.nii'), makeFile('sub-01_pet.nii.gz')]);
    });
    expect(NiiViewer.mock.lastCall[0].layers).toHaveLength(2);
    const failedUrl = NiiViewer.mock.lastCall[0].layers[0].url;

    await act(async () => {
      NiiViewer.mock.lastCall[0].onLoadError(new Set([failedUrl]));
    });

    expect(screen.getByTestId('nii-viewer')).toBeInTheDocument();
    expect(NiiViewer.mock.lastCall[0].layers).toHaveLength(1);
    expect(NiiViewer.mock.lastCall[0].layers[0].name).toBe('sub-01_pet.nii.gz');
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

  it('mentions electrode positions and inverse solution files in the initial dropzone description', () => {
    renderPatientView();
    const eegDropZoneProps = FileDropZone.mock.calls.find(([p]) => p.label === 'Drop EEG files')[0];
    expect(eegDropZoneProps.description).toMatch(/electrode positions/i);
    expect(eegDropZoneProps.description).toMatch(/inverse solution/i);
  });

  it('routes a dropped .tsv file to electrode position parsing instead of EEG accumulation', async () => {
    renderPatientView();
    const file = new File([MINIMAL_TSV], 'positions.tsv');

    await act(async () => {
      await getEegOnFiles()([file]);
    });

    expect(checkEegFiles).not.toHaveBeenCalled(); // pure position-file drop never reaches EEG accumulation
  });

  it('confirms a dropped electrode position file even before any EEG recording is loaded', async () => {
    renderPatientView();
    const file = new File([MINIMAL_TSV], 'positions.tsv');

    await act(async () => {
      await getEegOnFiles()([file]);
    });

    const eegDropZoneProps = FileDropZone.mock.calls
      .filter(([p]) => p.label === 'Drop EEG files')
      .at(-1)[0];
    expect(eegDropZoneProps.pendingFiles).toContainEqual({
      name: 'Electrode positions: positions',
    });
  });

  it('shows a success toast confirming a loaded electrode position file', async () => {
    toast.success.mockClear();
    renderPatientView();
    const file = new File([MINIMAL_TSV], 'positions.tsv');

    await act(async () => {
      await getEegOnFiles()([file]);
    });

    expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/electrode position/i));
  });

  it('does not warn about multiple files when only one electrode position file is dropped', async () => {
    toast.mockClear();
    renderPatientView();
    const file = new File([MINIMAL_TSV], 'positions.tsv');

    await act(async () => {
      await getEegOnFiles()([file]);
    });

    expect(toast).not.toHaveBeenCalledWith(expect.stringMatching(/multiple/i), expect.anything());
  });

  it('keeps only the latest electrode position file and warns when multiple are dropped together', async () => {
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
    toast.mockClear();

    const secondTsv = `name\tx\ty\tz\nT1\t2\t2\t2\n`;
    await act(async () => {
      await getEegOnFiles()([
        new File([MINIMAL_TSV], 'positions1.tsv'),
        new File([secondTsv], 'positions2.tsv'),
      ]);
    });

    expect(EegViewer.mock.lastCall[0].customElecPosFileName).toBe('positions2');
    expect(toast).toHaveBeenCalledWith(
      expect.stringMatching(/multiple/i),
      expect.objectContaining({ icon: '⚠️' })
    );
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

  it('confirms a dropped inverse solution file even before any EEG recording is loaded', async () => {
    renderPatientView();
    const file = makeFile('sub-19_meth-eloreta_desc-nonorm_inversefilters.mat');

    await act(async () => {
      await getEegOnFiles()([file]);
    });

    const eegDropZoneProps = FileDropZone.mock.calls
      .filter(([p]) => p.label === 'Drop EEG files')
      .at(-1)[0];
    expect(eegDropZoneProps.pendingFiles).toContainEqual({
      name: 'Inverse solution: sub-19_meth-eloreta_desc-nonorm_inversefilters',
    });
  });

  it('shows a success toast confirming a loaded inverse solution file', async () => {
    toast.success.mockClear();
    renderPatientView();
    const file = makeFile('sub-19_meth-eloreta_desc-nonorm_inversefilters.mat');

    await act(async () => {
      await getEegOnFiles()([file]);
    });

    expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/inverse solution/i));
  });

  it('does not warn about multiple files when only one inverse solution file is dropped', async () => {
    toast.mockClear();
    renderPatientView();
    const file = makeFile('sub-19_meth-eloreta_desc-nonorm_inversefilters.mat');

    await act(async () => {
      await getEegOnFiles()([file]);
    });

    expect(toast).not.toHaveBeenCalledWith(expect.stringMatching(/multiple/i), expect.anything());
  });

  it('keeps only the latest inverse solution file and warns when multiple are dropped together', async () => {
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
    toast.mockClear();

    await act(async () => {
      await getEegOnFiles()([
        makeFile('sub-19_meth-eloreta_desc-nonorm_inversefilters.mat'),
        makeFile('sub-20_meth-eloreta_desc-nonorm_inversefilters.mat'),
      ]);
    });

    expect(screen.getByTestId('eeg-inverse-solution-filename')).toHaveTextContent(
      'sub-20_meth-eloreta_desc-nonorm_inversefilters'
    );
    expect(toast).toHaveBeenCalledWith(
      expect.stringMatching(/multiple/i),
      expect.objectContaining({ icon: '⚠️' })
    );
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
    expect(screen.getByTestId('eeg-inverse-solution-filename')).toHaveTextContent(
      'sub-19_inversefilters'
    );
  });
});

describe('PatientView — ESI SEEG warning', () => {
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

  it('warns that ESI is not applicable when a channel the inverse solution needs is itself typed SEEG', async () => {
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
    await userEvent.click(screen.getByTestId('trigger-channel-types-seeg'));
    toast.mockClear();

    // Routed through EegViewer's own persistent dropzone callback (not getEegOnFiles,
    // whose closure is frozen from before EEG loaded and would still see the stale
    // pre-snapshot channelSnapshot).
    await act(async () => {
      await userEvent.click(screen.getByTestId('trigger-inverse-solution-file'));
    });

    expect(toast).toHaveBeenCalledWith(
      expect.stringMatching(/required channels have type EEG/i),
      expect.objectContaining({ icon: '⚠️' })
    );
  });

  it('keeps the Inverse Solution LED/ESI toggle gated off when a fully name-matched channel is itself typed SEEG', async () => {
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

    await act(async () => {
      await userEvent.click(screen.getByTestId('trigger-inverse-solution-file'));
    });
    // Names fully match (2/2) before the SEEG type is reported — the bug this guards
    // against: matchCount alone would say "fully matched", not accounting for type.
    expect(EegViewer.mock.lastCall[0].esiChannelMatchCount).toBe(2);
    expect(EegViewer.mock.lastCall[0].esiChannelTotalCount).toBe(2);
    expect(EegViewer.mock.lastCall[0].isEsiChannelMatchGoodForLed).toBe(true);

    await userEvent.click(screen.getByTestId('trigger-channel-types-seeg'));

    // Still a full name match, but no longer a "good" match — a needed channel is SEEG.
    expect(EegViewer.mock.lastCall[0].esiChannelMatchCount).toBe(2);
    expect(EegViewer.mock.lastCall[0].esiChannelTotalCount).toBe(2);
    expect(EegViewer.mock.lastCall[0].isEsiChannelMatchGoodForLed).toBe(false);
  });

  // A recording with a duplicate channel name is now rejected outright at intake time (see
  // "PatientView — EEG duplicate channel names" below) and never reaches EegViewer/the ESI
  // toast, so this scenario is no longer reachable through the real load flow — the
  // matchChannelsToInverseSolution/matchVoltagesToInverseSolution duplicate-name behavior
  // itself is still covered directly in electricalSourceImagingUtils.test.js.
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

  it('shows NiiViewer with a connectome layer once EegViewer reports intracranial electrode data and the 3D toggle is on, even with no imaging volumes loaded', async () => {
    renderPatientView();
    await act(async () => {
      await getEegOnFiles()([makeFile('sub01.vhdr'), makeFile('sub01.eeg')]);
    });

    expect(screen.queryByTestId('nii-viewer')).not.toBeInTheDocument(); // no imaging volumes yet

    await userEvent.click(screen.getByTestId('enable-electrode-render'));
    await userEvent.click(screen.getByTestId('trigger-intracranial-change'));

    expect(screen.getByTestId('nii-viewer')).toBeInTheDocument();
    expect(NiiViewer.mock.lastCall[0].electrodeLayer).toMatchObject({ kind: 'connectome' });
  });

  it('keeps NiiViewer mounted (and its other layers intact) when the electrode snapshot clearing drops the connectome layer', async () => {
    renderPatientView();
    await act(async () => {
      await getEegOnFiles()([makeFile('sub01.vhdr'), makeFile('sub01.eeg')]);
    });
    await userEvent.click(screen.getByTestId('enable-electrode-render'));
    await userEvent.click(screen.getByTestId('trigger-intracranial-change'));
    expect(screen.getByTestId('nii-viewer')).toBeInTheDocument();

    // User drops a volume straight into NiiViewer's own dropzone — PatientView's `layers`
    // state never sees it, so electrodeLayer/esiLayer/layers.length are the only signal
    // it has, unless NiiViewer itself reports that it now holds content.
    await userEvent.click(screen.getByTestId('trigger-nii-has-content'));

    // Clearing the electrode snapshot (no more matched channels) drops the connectome
    // layer — this must not unmount NiiViewer and discard the volume dropped above, only
    // the connectome layer should go away.
    await userEvent.click(screen.getByTestId('trigger-intracranial-clear'));

    expect(screen.getByTestId('nii-viewer')).toBeInTheDocument();
    expect(NiiViewer.mock.lastCall[0].electrodeLayer).toBeNull();
  });

  it('clears the connectome layer on reset', async () => {
    renderPatientView();
    await act(async () => {
      await getEegOnFiles()([makeFile('sub01.vhdr'), makeFile('sub01.eeg')]);
    });
    await userEvent.click(screen.getByTestId('enable-electrode-render'));
    await userEvent.click(screen.getByTestId('trigger-intracranial-change'));
    expect(screen.getByTestId('nii-viewer')).toBeInTheDocument();

    await userEvent.click(getDemoResetButton()); // Reset

    expect(screen.queryByTestId('nii-viewer')).not.toBeInTheDocument();
  });
});

describe('PatientView — electrodeRenderEnabled toggle', () => {
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

  it('defaults to off — no connectome layer even once intracranial data arrives', async () => {
    renderPatientView();
    await act(async () => {
      await getEegOnFiles()([makeFile('sub01.vhdr'), makeFile('sub01.eeg')]);
    });

    expect(screen.getByTestId('eeg-electrode-render-enabled')).toHaveTextContent('false');

    await userEvent.click(screen.getByTestId('trigger-intracranial-change'));

    // Electrode data is present, but the toggle was never turned on — nothing should render.
    expect(screen.queryByTestId('nii-viewer')).not.toBeInTheDocument();
  });

  it('turning the toggle on builds the connectome layer from already-reported electrode data', async () => {
    renderPatientView();
    await act(async () => {
      await getEegOnFiles()([makeFile('sub01.vhdr'), makeFile('sub01.eeg')]);
    });
    await userEvent.click(screen.getByTestId('trigger-intracranial-change'));
    expect(screen.queryByTestId('nii-viewer')).not.toBeInTheDocument(); // still off

    await userEvent.click(screen.getByTestId('enable-electrode-render'));

    expect(screen.getByTestId('eeg-electrode-render-enabled')).toHaveTextContent('true');
    expect(screen.getByTestId('nii-viewer')).toBeInTheDocument();
    expect(NiiViewer.mock.lastCall[0].electrodeLayer).toMatchObject({ kind: 'connectome' });
  });

  it('turning the toggle off removes the connectome layer without needing new electrode data', async () => {
    renderPatientView();
    await act(async () => {
      await getEegOnFiles()([makeFile('sub01.vhdr'), makeFile('sub01.eeg')]);
    });
    await userEvent.click(screen.getByTestId('enable-electrode-render'));
    await userEvent.click(screen.getByTestId('trigger-intracranial-change'));
    expect(screen.getByTestId('nii-viewer')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('disable-electrode-render'));

    expect(screen.getByTestId('eeg-electrode-render-enabled')).toHaveTextContent('false');
    expect(screen.queryByTestId('nii-viewer')).not.toBeInTheDocument();
  });

  it('deleting the electrode-connectome card in NiiViewer flips the toggle back off', async () => {
    renderPatientView();
    await act(async () => {
      await getEegOnFiles()([makeFile('sub01.vhdr'), makeFile('sub01.eeg')]);
    });
    await userEvent.click(screen.getByTestId('enable-electrode-render'));
    await userEvent.click(screen.getByTestId('trigger-intracranial-change'));
    expect(screen.getByTestId('eeg-electrode-render-enabled')).toHaveTextContent('true');

    await userEvent.click(screen.getByTestId('trigger-electrode-layer-dismissed'));

    // Nothing else is loaded, so clearing the toggle drops NiiViewer's only reason to be
    // mounted at all — same as disabling the toggle directly.
    expect(screen.getByTestId('eeg-electrode-render-enabled')).toHaveTextContent('false');
    expect(screen.queryByTestId('nii-viewer')).not.toBeInTheDocument();
  });
});

describe('PatientView — esiEnabled toggle', () => {
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
    electricalSourceImaging.mockReset();
    electricalSourceImaging.mockReturnValue({
      sourcePowerConnectomes: { fake: 'connectome' },
      sourcePowerVolume: { fake: 'volume' },
    });
  });

  it('defaults to off — no ESI layer even once a channel snapshot arrives', async () => {
    renderPatientView();
    await loadEegAndInverseSolution();

    expect(screen.getByTestId('eeg-esi-enabled')).toHaveTextContent('false');

    await userEvent.click(screen.getByTestId('trigger-channel-snapshot'));

    // Inverse solution + Average montage + a channel snapshot are all present, but the
    // toggle was never turned on — nothing should render.
    expect(screen.queryByTestId('nii-viewer')).not.toBeInTheDocument();
  });

  it('turning the toggle on shows the ESI layer from already-reported channel data', async () => {
    renderPatientView();
    await loadEegAndInverseSolution();
    await userEvent.click(screen.getByTestId('trigger-channel-snapshot'));
    expect(screen.queryByTestId('nii-viewer')).not.toBeInTheDocument(); // still off

    await userEvent.click(screen.getByTestId('enable-esi'));

    expect(screen.getByTestId('eeg-esi-enabled')).toHaveTextContent('true');
    expect(screen.getByTestId('nii-viewer')).toBeInTheDocument();
    expect(NiiViewer.mock.lastCall[0].esiLayer).toBeTruthy();
  });

  it('turning the toggle off removes the ESI layer without needing new channel data', async () => {
    renderPatientView();
    await loadEegAndInverseSolution();
    await userEvent.click(screen.getByTestId('enable-esi'));
    await userEvent.click(screen.getByTestId('trigger-channel-snapshot'));
    expect(NiiViewer.mock.lastCall[0].esiLayer).toBeTruthy();

    await userEvent.click(screen.getByTestId('disable-esi'));

    // Nothing else is loaded, so clearing the toggle drops NiiViewer's only reason to be
    // mounted at all — same as the electrodeRenderEnabled toggle-off case above.
    expect(screen.getByTestId('eeg-esi-enabled')).toHaveTextContent('false');
    expect(screen.queryByTestId('nii-viewer')).not.toBeInTheDocument();
  });
});

// Regression tests for the "can't rotate 3D view after removing the linked 3D render" bug:
// NiiVue's sync() runs every frame while dragging and calls createOnLocationChange() on the
// broadcast-linked instance, which throws (toFixed(Infinity), aborting the still-focused
// panel's own repaint too) when that instance's 3D scene has zero spatial extent — an empty
// scene OR a connectome-only one (intracranial electrodes / ESI in connectome mode). So the
// cross-panel link must only be active while BOTH sides have a volume-or-mesh scene, and be
// re-evaluated whenever that changes on either side.
describe('PatientView — cross-panel 3D rotation sync', () => {
  beforeEach(() => {
    FileDropZone.mockClear();
    Niivue.mockClear();
    checkEegFiles.mockReturnValue({
      formatName: 'BrainVision',
      complete: true,
      missing: [],
      warning: null,
    });
    detectAndLoadEEG.mockResolvedValue({ channelNames: ['B1'], fs: 1, tMax: 1, getChunk: vi.fn() });
  });

  // Mounts both NiiViewer (via an imaging volume) and EegViewer (via an EEG recording), and
  // returns the two real Niivue instances PatientView constructed for them — created in a
  // fixed order (nvRef_niiviewer, then nvRef_eegtopo) by the lazy-ref pattern at the top of
  // PatientView, so they're always the first two instances built on a fresh render.
  const setupBothPanelsWithContent = async () => {
    renderPatientView();
    await act(async () => {
      await getNiiOnFiles()([makeFile('sub-01_T1w.nii')]);
    });
    await act(async () => {
      await getEegOnFiles()([makeFile('sub01.vhdr'), makeFile('sub01.eeg')]);
    });

    const [nvNii, nvTopo] = Niivue.mock.results.map((r) => r.value);
    return { nvNii, nvTopo };
  };

  // Both canvases ready + both scenes report a usable extent — the fully-linked state the
  // other tests start from.
  const makeBothReadyAndLinked = async () => {
    const { nvNii, nvTopo } = await setupBothPanelsWithContent();
    await userEvent.click(screen.getByTestId('trigger-nii-nv-ready'));
    await userEvent.click(screen.getByTestId('trigger-topo-nv-ready'));
    await userEvent.click(screen.getByTestId('trigger-nii-has-3d-extent'));
    await userEvent.click(screen.getByTestId('trigger-topo-has-content'));
    return { nvNii, nvTopo };
  };

  it('does not link when both canvases are ready but the topo panel has no content yet', async () => {
    const { nvNii, nvTopo } = await setupBothPanelsWithContent();

    await userEvent.click(screen.getByTestId('trigger-nii-nv-ready'));
    await userEvent.click(screen.getByTestId('trigger-topo-nv-ready'));
    await userEvent.click(screen.getByTestId('trigger-nii-has-3d-extent'));
    // topoHasContent never triggered — e.g. the topo window is open but no electrode
    // position file has been loaded, so its NiiVue canvas is still a genuinely empty scene.
    // The effect still runs (both canvases are ready) but must leave both sides unlinked
    // rather than broadcasting to a scene with nothing to draw.

    expect(nvNii.broadcastTo).toHaveBeenLastCalledWith([]);
    expect(nvTopo.broadcastTo).toHaveBeenLastCalledWith([]);
  });

  it('does not link when the imaging panel holds only a connectome (zero-extent scene) even though the topo panel has content', async () => {
    const { nvNii, nvTopo } = await setupBothPanelsWithContent();

    await userEvent.click(screen.getByTestId('trigger-nii-nv-ready'));
    await userEvent.click(screen.getByTestId('trigger-topo-nv-ready'));
    await userEvent.click(screen.getByTestId('trigger-topo-has-content'));
    // niiHas3DExtent never triggered — the imaging scene is connectome-only (e.g. an ESI
    // connectome with no volume), whose zero extent would crash NiiVue's per-frame sync.

    expect(nvNii.broadcastTo).toHaveBeenLastCalledWith([]);
    expect(nvTopo.broadcastTo).toHaveBeenLastCalledWith([]);
  });

  it('links the two panels once both canvases are ready and both have a volume/mesh scene', async () => {
    const { nvNii, nvTopo } = await makeBothReadyAndLinked();

    expect(nvNii.broadcastTo).toHaveBeenLastCalledWith([nvTopo], { '2d': false, '3d': true });
    expect(nvTopo.broadcastTo).toHaveBeenLastCalledWith([nvNii], { '2d': false, '3d': true });
  });

  it('unlinks both panels when the topo window is closed, instead of leaving a stale link to a now-empty NiiVue instance', async () => {
    const { nvNii, nvTopo } = await makeBothReadyAndLinked();
    expect(nvNii.broadcastTo).toHaveBeenLastCalledWith([nvTopo], { '2d': false, '3d': true });

    // e.g. the user closes the floating topography window, or its electrode mesh is cleared
    await userEvent.click(screen.getByTestId('trigger-topo-no-content'));

    expect(nvNii.broadcastTo).toHaveBeenLastCalledWith([]);
    expect(nvTopo.broadcastTo).toHaveBeenLastCalledWith([]);
  });

  it('unlinks both panels when the imaging panel is reset down to a connectome-only (zero-extent) scene', async () => {
    const { nvNii, nvTopo } = await makeBothReadyAndLinked();
    expect(nvNii.broadcastTo).toHaveBeenLastCalledWith([nvTopo], { '2d': false, '3d': true });

    // Reproduces the reported crash: after resetting the imaging panel, only the ESI
    // connectome remains — a zero-extent scene whose sync() would otherwise crash the
    // still-focused (topo) panel mid-rotation.
    await userEvent.click(screen.getByTestId('trigger-nii-no-3d-extent'));

    expect(nvNii.broadcastTo).toHaveBeenLastCalledWith([]);
    expect(nvTopo.broadcastTo).toHaveBeenLastCalledWith([]);
  });
});
