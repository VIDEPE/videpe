import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getInitialLayerSettings, detectVolumeType } from '@/components/NiiViewer.utils';
import { NiiViewer, loadVolumesAndApplySettings } from '@/components/NiiViewer';

const SLICE_TYPE_OPTIONS = [
  { ariaLabel: 'Axial view', key: 'AXIAL' },
  { ariaLabel: 'Coronal view', key: 'CORONAL' },
  { ariaLabel: 'Sagittal view', key: 'SAGITTAL' },
  { ariaLabel: 'Multiplanar view', key: 'MULTIPLANAR' },
  { ariaLabel: '3D view', key: 'RENDER' },
];

vi.mock('react-hot-toast', () => ({
  default: {
    error: vi.fn(),
  },
}));

vi.mock('@niivue/niivue', () => ({
  Niivue: vi.fn().mockImplementation(function () {
    const instance = {
      attachToCanvas: vi.fn(),
      loadVolumes: vi.fn().mockImplementation(async function (vols) {
        instance.volumes = vols; // mirrors what real NiiVue does so updateSetting can look up by url
      }),
      setOpacity: vi.fn(),
      setColormap: vi.fn(),
      updateGLVolume: vi.fn(),
      setSliceType: vi.fn(),
      setMultiplanarLayout: vi.fn(),
      setCornerOrientationText: vi.fn(),
      opts: { isColorbar: false, multiplanarShowRender: null, multiplanarEqualSize: true },
      sliceTypeMultiplanar: 1,
      volumes: [],
    };
    return instance;
  }),
  SHOW_RENDER: { ALWAYS: 2 },
  MULTIPLANAR_TYPE: { GRID: 2, AUTO: 3 },
  SLICE_TYPE: {
    AXIAL: 0,
    CORONAL: 1,
    SAGITTAL: 2,
    MULTIPLANAR: 3,
    RENDER: 4,
  },
}));

describe('loadVolumesAndApplySettings', () => {
  const makeVolume = (url, id) => ({ url, id });
  const makeLayerSetting = (overrides = {}) => ({
    colormap: 'gray',
    visible: true,
    opacity: 1.0,
    invert: false,
    showColorbar: false,
    ...overrides,
  });

  let nv;
  beforeEach(() => {
    nv = {
      loadVolumes: vi.fn().mockImplementation(async (vols) => {
        nv.volumes = vols;
      }),
      setColormap: vi.fn(),
      setOpacity: vi.fn(),
      updateGLVolume: vi.fn(),
      opts: { isColorbar: false },
      volumes: [],
    };
  });

  it('calls loadVolumes with the provided volumes', async () => {
    const volumes = [makeVolume('/mri.nii', 'id-mri')];
    await loadVolumesAndApplySettings(nv, volumes, [makeLayerSetting()]);
    expect(nv.loadVolumes).toHaveBeenCalledWith(volumes);
  });

  it('sets colormap for each volume after loading', async () => {
    const volumes = [makeVolume('/mri.nii', 'id-mri'), makeVolume('/pet.nii', 'id-pet')];
    const settings = [
      makeLayerSetting({ colormap: 'gray' }),
      makeLayerSetting({ colormap: 'viridis' }),
    ];
    await loadVolumesAndApplySettings(nv, volumes, settings);
    expect(nv.setColormap).toHaveBeenCalledWith('id-mri', 'gray');
    expect(nv.setColormap).toHaveBeenCalledWith('id-pet', 'viridis');
  });

  it('sets full opacity for a visible volume', async () => {
    const volumes = [makeVolume('/mri.nii', 'id-mri')];
    await loadVolumesAndApplySettings(nv, volumes, [
      makeLayerSetting({ visible: true, opacity: 0.7 }),
    ]);
    expect(nv.setOpacity).toHaveBeenCalledWith(0, 0.7);
  });

  it('sets opacity to 0 for a hidden volume regardless of its opacity value', async () => {
    const volumes = [makeVolume('/mri.nii', 'id-mri')];
    await loadVolumesAndApplySettings(nv, volumes, [
      makeLayerSetting({ visible: false, opacity: 0.8 }),
    ]);
    expect(nv.setOpacity).toHaveBeenCalledWith(0, 0);
  });

  it('sets colormapInvert on the volume object when invert is true', async () => {
    const volumes = [makeVolume('/mri.nii', 'id-mri')];
    await loadVolumesAndApplySettings(nv, volumes, [makeLayerSetting({ invert: true })]);
    expect(nv.volumes[0].colormapInvert).toBe(true);
  });

  it('does not set colormapInvert when invert is false', async () => {
    const volumes = [makeVolume('/mri.nii', 'id-mri')];
    await loadVolumesAndApplySettings(nv, volumes, [makeLayerSetting({ invert: false })]);
    expect(nv.volumes[0].colormapInvert).toBeUndefined();
  });

  it('sets colorbarVisible to true on a volume with showColorbar true', async () => {
    const volumes = [makeVolume('/mri.nii', 'id-mri')];
    await loadVolumesAndApplySettings(nv, volumes, [makeLayerSetting({ showColorbar: true })]);
    expect(nv.volumes[0].colorbarVisible).toBe(true);
  });

  it('sets colorbarVisible to false on a volume with showColorbar false', async () => {
    const volumes = [makeVolume('/mri.nii', 'id-mri')];
    await loadVolumesAndApplySettings(nv, volumes, [makeLayerSetting({ showColorbar: false })]);
    expect(nv.volumes[0].colorbarVisible).toBe(false);
  });

  it('sets colorbarVisible independently per volume', async () => {
    const volumes = [makeVolume('/mri.nii', 'id-mri'), makeVolume('/pet.nii', 'id-pet')];
    const settings = [
      makeLayerSetting({ showColorbar: true }),
      makeLayerSetting({ showColorbar: false }),
    ];
    await loadVolumesAndApplySettings(nv, volumes, settings);
    expect(nv.volumes[0].colorbarVisible).toBe(true);
    expect(nv.volumes[1].colorbarVisible).toBe(false);
  });

  it('sets isColorbar to true when any layer has showColorbar', async () => {
    const volumes = [makeVolume('/mri.nii', 'id-mri'), makeVolume('/pet.nii', 'id-pet')];
    const settings = [
      makeLayerSetting({ showColorbar: false }),
      makeLayerSetting({ showColorbar: true }),
    ];
    await loadVolumesAndApplySettings(nv, volumes, settings);
    expect(nv.opts.isColorbar).toBe(true);
  });

  it('sets isColorbar to false when no layer has showColorbar', async () => {
    const volumes = [makeVolume('/mri.nii', 'id-mri')];
    await loadVolumesAndApplySettings(nv, volumes, [makeLayerSetting({ showColorbar: false })]);
    expect(nv.opts.isColorbar).toBe(false);
  });

  it('calls updateGLVolume after applying all settings', async () => {
    const volumes = [makeVolume('/mri.nii', 'id-mri')];
    await loadVolumesAndApplySettings(nv, volumes, [makeLayerSetting()]);
    expect(nv.updateGLVolume).toHaveBeenCalledOnce();
  });
});

describe('detectVolumeType', () => {
  describe('BIDS suffix detection', () => {
    it('detects T1w in .nii as MRI with nameWithoutExtension as subtype', () => {
      expect(detectVolumeType('sub-01_T1w.nii')).toEqual({ type: 'MRI', subtype: 'sub-01_T1w' });
    });

    it('detects T1w in .nii.gz (compressed) as MRI — extension must not interfere', () => {
      expect(detectVolumeType('sub-01_T1w.nii.gz')).toEqual({ type: 'MRI', subtype: 'sub-01_T1w' });
    });

    it('detects T2w as MRI with nameWithoutExtension as subtype', () => {
      expect(detectVolumeType('sub-01_ses-01_T2w.nii.gz')).toEqual({
        type: 'MRI',
        subtype: 'sub-01_ses-01_T2w',
      });
    });

    it('detects FLAIR as MRI with nameWithoutExtension as subtype', () => {
      expect(detectVolumeType('sub-01_FLAIR.nii.gz')).toEqual({
        type: 'MRI',
        subtype: 'sub-01_FLAIR',
      });
    });

    it('detects T2star as MRI with nameWithoutExtension as subtype', () => {
      expect(detectVolumeType('sub-01_T2star.nii.gz')).toEqual({
        type: 'MRI',
        subtype: 'sub-01_T2star',
      });
    });

    it('detects pet suffix as PET with nameWithoutExtension as subtype', () => {
      expect(detectVolumeType('sub-01_pet.nii.gz')).toEqual({ type: 'PET', subtype: 'sub-01_pet' });
    });

    it('detects spect suffix as SPECT with nameWithoutExtension as subtype', () => {
      expect(detectVolumeType('sub-01_spect.nii.gz')).toEqual({
        type: 'SPECT',
        subtype: 'sub-01_spect',
      });
    });

    it('does not match PET (uppercase) as BIDS pet — falls through to keyword with nameWithoutExtension as subtype', () => {
      // BIDS suffix 'pet' is lowercase; 'PET' does not match BIDS but keyword fallback catches it
      expect(detectVolumeType('scan_PET.nii')).toEqual({ type: 'PET', subtype: 'scan_PET' });
    });
  });

  describe('keyword fallback for non-BIDS filenames', () => {
    it('detects t1 keyword as MRI with nameWithoutExtension as subtype', () => {
      expect(detectVolumeType('my_t1_scan.nii')).toEqual({ type: 'MRI', subtype: 'my_t1_scan' });
    });

    it('detects fdg keyword as PET with nameWithoutExtension as subtype', () => {
      expect(detectVolumeType('fdg_uptake.nii.gz')).toEqual({ type: 'PET', subtype: 'fdg_uptake' });
    });

    it('detects siscom keyword as SPECT with nameWithoutExtension as subtype', () => {
      expect(detectVolumeType('pat_siscom_17-13.nii')).toEqual({
        type: 'SPECT',
        subtype: 'pat_siscom_17-13',
      });
    });

    it('detects mprage keyword as MRI with nameWithoutExtension as subtype', () => {
      expect(detectVolumeType('mprage.nii.gz')).toEqual({ type: 'MRI', subtype: 'mprage' });
    });
  });

  describe('unknown filenames', () => {
    it('returns the filename without extension as type with no subtype', () => {
      expect(detectVolumeType('scan.nii')).toEqual({ type: 'scan', subtype: null });
    });

    it('handles files with no extension', () => {
      expect(detectVolumeType('unknown_volume')).toEqual({ type: 'unknown_volume', subtype: null });
    });

    it('uses the full name without extension when no _ separator is present', () => {
      expect(detectVolumeType('brainmask.nii.gz')).toEqual({ type: 'brainmask', subtype: null });
    });
  });
});

describe('NiiViewer', () => {
  describe('getInitialLayerSettings', () => {
    it('starts all layers visible', () => {
      const result = getInitialLayerSettings([{ type: 'MRI' }, { type: 'PET' }, { type: 'SPECT' }]);
      expect(result.every((layer) => layer.visible)).toBe(true);
    });

    it('first layer is fully opaque, subsequent layers default to 0.6', () => {
      const result = getInitialLayerSettings([{ type: 'MRI' }, { type: 'PET' }, { type: 'SPECT' }]);
      expect(result[0].opacity).toBe(1.0);
      expect(result[1].opacity).toBe(0.6);
      expect(result[2].opacity).toBe(0.6);
    });

    it('derives colormap from volume type via TYPE_COLORMAP_DEFAULTS', () => {
      const result = getInitialLayerSettings([{ type: 'MRI' }, { type: 'PET' }, { type: 'SPECT' }]);
      expect(result[0].colormap).toBe('gray');
      expect(result[1].colormap).toBe('viridis');
      expect(result[2].colormap).toBe('magma');
    });

    it('defaults colormap to gray for unknown types', () => {
      const result = getInitialLayerSettings([{ type: 'unknown_scan' }]);
      expect(result[0].colormap).toBe('gray');
    });

    it('defaults invert and showColorbar to false', () => {
      const result = getInitialLayerSettings([{ type: 'MRI' }]);
      expect(result[0].invert).toBe(false);
      expect(result[0].showColorbar).toBe(false);
    });
  });

  describe('component rendering', () => {
    it('renders a label for each loaded volume', async () => {
      const volumes = [
        { type: 'MRI', url: '/mri.nii' },
        { type: 'PET', url: '/pet.nii' },
        { type: 'SPECT', url: '/spect.nii' },
      ];
      render(<NiiViewer volumes={volumes} />);
      await waitFor(() => expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument());
      expect(screen.getByText('MRI')).toBeInTheDocument();
      expect(screen.getByText('PET')).toBeInTheDocument();
      expect(screen.getByText('SPECT')).toBeInTheDocument();
    });

    it('shows a loading spinner while volumes are loading', async () => {
      const { Niivue } = await import('@niivue/niivue');
      // Block loadVolumes so the loading state never resolves during this test
      Niivue.mockImplementationOnce(function () {
        return {
          attachToCanvas: vi.fn(),
          loadVolumes: vi.fn().mockReturnValue(new Promise(() => {})),
          setOpacity: vi.fn(),
          setColormap: vi.fn(),
          updateGLVolume: vi.fn(),
          setSliceType: vi.fn(),
          setMultiplanarLayout: vi.fn(),
          setCornerOrientationText: vi.fn(),
          opts: { isColorbar: false, multiplanarShowRender: null, multiplanarEqualSize: true },
          sliceTypeMultiplanar: 1,
          volumes: [],
        };
      });

      render(<NiiViewer volumes={[{ type: 'MRI', url: '/mri.nii' }]} />);
      expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
    });

    it('hides the loading spinner once volumes have loaded', async () => {
      render(<NiiViewer volumes={[{ type: 'MRI', url: '/mri.nii' }]} />);
      await waitFor(() => expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument());
    });

    it('shows a toast error when loadVolumes rejects', async () => {
      const { Niivue } = await import('@niivue/niivue');
      Niivue.mockImplementationOnce(function () {
        return {
          attachToCanvas: vi.fn(),
          loadVolumes: vi.fn().mockRejectedValue(new Error('Network error')),
          setOpacity: vi.fn(),
          setColormap: vi.fn(),
          updateGLVolume: vi.fn(),
          setSliceType: vi.fn(),
          setMultiplanarLayout: vi.fn(),
          setCornerOrientationText: vi.fn(),
          opts: { isColorbar: false, multiplanarShowRender: null, multiplanarEqualSize: true },
          sliceTypeMultiplanar: 1,
          volumes: [],
        };
      });

      const { default: toast } = await import('react-hot-toast');
      render(<NiiViewer volumes={[{ type: 'MRI', url: '/mri.nii' }]} />);

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/failed to load image/i))
      );
    });

    it('calls nv.setColormap when the colormap setting changes', async () => {
      const { Niivue } = await import('@niivue/niivue');
      render(<NiiViewer volumes={[{ type: 'MRI', url: '/mri.nii', id: 'mri-id' }]} />);
      await waitFor(() => expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument());

      // Expand the MRI card and change the colormap
      await userEvent.click(screen.getByRole('button', { name: 'Expand MRI controls' }));
      await userEvent.selectOptions(screen.getByLabelText('MRI colormap'), 'magma');

      const nv = Niivue.mock.results[Niivue.mock.results.length - 1].value;
      // toHaveBeenLastCalledWith isolates the handleSettingChange call from the initial loadVolumesAndApplySettings call
      expect(nv.setColormap).toHaveBeenLastCalledWith('mri-id', 'magma');
    });
  });

  describe('canvas aspect ratio layout', () => {
    let resizeCallback;

    beforeEach(() => {
      global.ResizeObserver = class {
        constructor(cb) {
          resizeCallback = cb;
        }
        observe() {}
        disconnect() {}
      };
      // shouldAdvanceTime keeps real-time-driven helpers like waitFor working alongside fake timers
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    const setup = async () => {
      const { Niivue } = await import('@niivue/niivue');
      render(<NiiViewer volumes={[{ type: 'MRI', url: '/mri.nii' }]} />);
      await waitFor(() => expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument());
      const nv = Niivue.mock.results[Niivue.mock.results.length - 1].value;
      nv.setMultiplanarLayout.mockClear();
      return nv;
    };

    it('switches to AUTO layout when canvas width is at least 2× the height', async () => {
      const { MULTIPLANAR_TYPE } = await import('@niivue/niivue');
      const nv = await setup();

      act(() => {
        resizeCallback([{ contentRect: { width: 800, height: 200 } }]);
        vi.advanceTimersByTime(150); // flush the resize-size debounce
      });

      expect(nv.setMultiplanarLayout).toHaveBeenCalledWith(MULTIPLANAR_TYPE.AUTO);
    });

    it('uses GRID layout when canvas width is less than 2× the height', async () => {
      const { MULTIPLANAR_TYPE } = await import('@niivue/niivue');
      const nv = await setup();

      act(() => {
        resizeCallback([{ contentRect: { width: 400, height: 300 } }]);
        vi.advanceTimersByTime(150); // flush the resize-size debounce
      });

      expect(nv.setMultiplanarLayout).toHaveBeenCalledWith(MULTIPLANAR_TYPE.GRID);
    });

    it('switches back to GRID when canvas becomes narrow again', async () => {
      const { MULTIPLANAR_TYPE } = await import('@niivue/niivue');
      const nv = await setup();

      act(() => {
        resizeCallback([{ contentRect: { width: 800, height: 200 } }]);
        vi.advanceTimersByTime(150); // flush the resize-size debounce
      });
      nv.setMultiplanarLayout.mockClear();
      act(() => {
        resizeCallback([{ contentRect: { width: 400, height: 300 } }]);
        vi.advanceTimersByTime(150); // flush the resize-size debounce
      });

      expect(nv.setMultiplanarLayout).toHaveBeenCalledWith(MULTIPLANAR_TYPE.GRID);
    });
  });

  describe('handleSettingChange', () => {
    // Helper: render NiiViewer, wait for load, return the nv mock instance with mocks cleared
    const setup = async () => {
      const { Niivue } = await import('@niivue/niivue');
      render(<NiiViewer volumes={[{ type: 'MRI', url: '/mri.nii' }]} />);
      await waitFor(() => expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument());
      const nv = Niivue.mock.results[Niivue.mock.results.length - 1].value;
      // Clear calls from initial load so assertions only count post-load interactions
      nv.setOpacity.mockClear();
      nv.updateGLVolume.mockClear();
      return nv;
    };

    it('calls nv.setOpacity with 0 when hiding a visible volume', async () => {
      const nv = await setup();
      await userEvent.click(screen.getByRole('button', { name: 'Hide MRI' }));
      expect(nv.setOpacity).toHaveBeenCalledWith(0, 0);
    });

    it('sets colormapInvert on the NVImage and calls updateGLVolume when invert is toggled', async () => {
      const nv = await setup();
      await userEvent.click(screen.getByRole('button', { name: 'Expand MRI controls' }));
      await userEvent.click(screen.getByRole('switch', { name: 'Invert MRI colormap' }));
      expect(nv.volumes[0].colormapInvert).toBe(true);
      expect(nv.updateGLVolume).toHaveBeenCalledOnce();
    });

    it('sets colorbarVisible on the NVImage and calls updateGLVolume when colorbar is toggled', async () => {
      const nv = await setup();
      await userEvent.click(screen.getByRole('button', { name: 'Expand MRI controls' }));
      await userEvent.click(screen.getByRole('switch', { name: 'Show MRI colorbar' }));
      expect(nv.volumes[0].colorbarVisible).toBe(true);
      expect(nv.updateGLVolume).toHaveBeenCalledOnce();
    });
  });

  describe('handleSliceTypeChange', () => {
    // Helper: render NiiViewer, wait for load, return the nv mock instance with mocks cleared
    const setup = async () => {
      const { Niivue, SLICE_TYPE } = await import('@niivue/niivue');
      render(<NiiViewer volumes={[{ type: 'MRI', url: '/mri.nii' }]} />);
      await waitFor(() => expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument());
      const nv = Niivue.mock.results[Niivue.mock.results.length - 1].value;
      // Clear calls from initial load so assertions only count post-load interactions
      nv.setSliceType.mockClear();
      return { nv, SLICE_TYPE };
    };

    it.each(SLICE_TYPE_OPTIONS.map((option) => [option.ariaLabel, option.key]))(
      'calls setSliceType with %s',
      async (ariaLabel, sliceTypeKey) => {
        const { nv, SLICE_TYPE } = await setup();
        await userEvent.click(screen.getByRole('button', { name: ariaLabel }));
        expect(nv.setSliceType).toHaveBeenCalledWith(SLICE_TYPE[sliceTypeKey]);
      }
    );

    it('renders all slice type buttons', async () => {
      await setup();
      expect(screen.getByRole('button', { name: 'Axial view' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Coronal view' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Sagittal view' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Multiplanar view' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '3D view' })).toBeInTheDocument();
    });

    it.each(SLICE_TYPE_OPTIONS.map((option) => [option.ariaLabel]))(
      'clicking %s sets aria-pressed correctly',
      async (ariaLabel) => {
        const allLabels = SLICE_TYPE_OPTIONS.map((option) => option.ariaLabel);
        await setup();
        // click the button
        await userEvent.click(screen.getByRole('button', { name: ariaLabel }));
        // the clicked button should have aria-pressed true
        expect(screen.getByRole('button', { name: ariaLabel })).toHaveAttribute(
          'aria-pressed',
          'true'
        );
        // all other buttons should have aria-pressed false
        for (const otherLabel of allLabels.filter((l) => l !== ariaLabel)) {
          expect(screen.getByRole('button', { name: otherLabel })).toHaveAttribute(
            'aria-pressed',
            'false'
          );
        }
      }
    );
  });
});
