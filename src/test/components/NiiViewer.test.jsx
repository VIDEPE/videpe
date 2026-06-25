import { StrictMode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getInitialLayerSettings, detectVolumeType } from '@/components/NiiViewer.utils';
import { NiiViewer, syncVolumesAndApplySettings } from '@/components/NiiViewer';

const SLICE_TYPE_OPTIONS = [
  { ariaLabel: 'Axial view', key: 'AXIAL' },
  { ariaLabel: 'Coronal view', key: 'CORONAL' },
  { ariaLabel: 'Sagittal view', key: 'SAGITTAL' },
  { ariaLabel: 'Multiplanar view', key: 'MULTIPLANAR' },
  { ariaLabel: '3D view', key: 'RENDER' },
];

const makeConnectomeVolume = (overrides = {}) => ({
  url: '__intracranial-electrodes__',
  name: 'Intracranial Electrodes',
  type: 'Intracranial',
  subtype: 'Electrodes',
  kind: 'connectome',
  nodes: [{ name: 'B1', x: 0, y: 0, z: 0, colorValue: 1, sizeValue: 1 }],
  edges: [],
  calMax: 1,
  ...overrides,
});

vi.mock('react-hot-toast', () => ({
  default: {
    error: vi.fn(),
    loading: vi.fn(),
    success: vi.fn(),
    dismiss: vi.fn(),
  },
}));

vi.mock('@niivue/niivue', () => ({
  Niivue: vi.fn().mockImplementation(function () {
    const instance = {
      attachToCanvas: vi.fn(),
      loadVolumes: vi.fn().mockImplementation(async function (vols) {
        instance.volumes = vols; // mirrors what real NiiVue does so updateSetting can look up by url
      }),
      addVolumesFromUrl: vi.fn().mockImplementation(async function (vols) {
        // mirrors what real NiiVue does — appends the newly loaded volumes to the existing ones
        instance.volumes = [...instance.volumes, ...vols];
      }),
      removeVolumeByIndex: vi.fn().mockImplementation(async function (index) {
        // mirrors what real NiiVue does — removes the volume with a certain index
        instance.volumes = instance.volumes.filter((_, i) => i !== index);
      }),
      setOpacity: vi.fn(),
      setColormap: vi.fn(),
      addColormap: vi.fn(),
      // loadConnectomeAsMesh is synchronous in real NiiVue (returns but doesn't add the mesh) —
      // mirror that by handing back a plain object carrying the json's properties plus the
      // opacity/visible defaults the real NVConnectome constructor would apply.
      loadConnectomeAsMesh: vi
        .fn()
        .mockImplementation((json) => ({ ...json, opacity: 1, visible: true })),
      addMesh: vi.fn().mockImplementation(function (mesh) {
        // mirrors what real NiiVue does — appends the mesh to the existing ones
        instance.meshes = [...instance.meshes, mesh];
      }),
      removeMesh: vi.fn().mockImplementation(function (mesh) {
        // mirrors what real NiiVue does — drops the mesh from the existing ones
        instance.meshes = instance.meshes.filter((m) => m !== mesh);
      }),
      updateGLVolume: vi.fn(),
      setSliceType: vi.fn(),
      setMultiplanarLayout: vi.fn(),
      setCornerOrientationText: vi.fn(),
      opts: { isColorbar: false, multiplanarShowRender: null, multiplanarEqualSize: true },
      sliceTypeMultiplanar: 1,
      volumes: [],
      meshes: [],
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

describe('syncVolumesAndApplySettings', () => {
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
    await syncVolumesAndApplySettings(nv, volumes, [makeLayerSetting()]);
    expect(nv.loadVolumes).toHaveBeenCalledWith(volumes);
  });

  it('sets colormap for each volume after loading', async () => {
    const volumes = [makeVolume('/mri.nii', 'id-mri'), makeVolume('/pet.nii', 'id-pet')];
    const settings = [
      makeLayerSetting({ colormap: 'gray' }),
      makeLayerSetting({ colormap: 'viridis' }),
    ];
    await syncVolumesAndApplySettings(nv, volumes, settings);
    expect(nv.setColormap).toHaveBeenCalledWith('id-mri', 'gray');
    expect(nv.setColormap).toHaveBeenCalledWith('id-pet', 'viridis');
  });

  it('sets full opacity for a visible volume', async () => {
    const volumes = [makeVolume('/mri.nii', 'id-mri')];
    await syncVolumesAndApplySettings(nv, volumes, [
      makeLayerSetting({ visible: true, opacity: 0.7 }),
    ]);
    expect(nv.setOpacity).toHaveBeenCalledWith(0, 0.7);
  });

  it('sets opacity to 0 for a hidden volume regardless of its opacity value', async () => {
    const volumes = [makeVolume('/mri.nii', 'id-mri')];
    await syncVolumesAndApplySettings(nv, volumes, [
      makeLayerSetting({ visible: false, opacity: 0.8 }),
    ]);
    expect(nv.setOpacity).toHaveBeenCalledWith(0, 0);
  });

  it('sets colormapInvert on the volume object when invert is true', async () => {
    const volumes = [makeVolume('/mri.nii', 'id-mri')];
    await syncVolumesAndApplySettings(nv, volumes, [makeLayerSetting({ invert: true })]);
    expect(nv.volumes[0].colormapInvert).toBe(true);
  });

  it('does not set colormapInvert when invert is false', async () => {
    const volumes = [makeVolume('/mri.nii', 'id-mri')];
    await syncVolumesAndApplySettings(nv, volumes, [makeLayerSetting({ invert: false })]);
    expect(nv.volumes[0].colormapInvert).toBeUndefined();
  });

  it('sets colorbarVisible to true on a volume with showColorbar true', async () => {
    const volumes = [makeVolume('/mri.nii', 'id-mri')];
    await syncVolumesAndApplySettings(nv, volumes, [makeLayerSetting({ showColorbar: true })]);
    expect(nv.volumes[0].colorbarVisible).toBe(true);
  });

  it('sets colorbarVisible to false on a volume with showColorbar false', async () => {
    const volumes = [makeVolume('/mri.nii', 'id-mri')];
    await syncVolumesAndApplySettings(nv, volumes, [makeLayerSetting({ showColorbar: false })]);
    expect(nv.volumes[0].colorbarVisible).toBe(false);
  });

  it('sets colorbarVisible independently per volume', async () => {
    const volumes = [makeVolume('/mri.nii', 'id-mri'), makeVolume('/pet.nii', 'id-pet')];
    const settings = [
      makeLayerSetting({ showColorbar: true }),
      makeLayerSetting({ showColorbar: false }),
    ];
    await syncVolumesAndApplySettings(nv, volumes, settings);
    expect(nv.volumes[0].colorbarVisible).toBe(true);
    expect(nv.volumes[1].colorbarVisible).toBe(false);
  });

  it('sets isColorbar to true when any layer has showColorbar', async () => {
    const volumes = [makeVolume('/mri.nii', 'id-mri'), makeVolume('/pet.nii', 'id-pet')];
    const settings = [
      makeLayerSetting({ showColorbar: false }),
      makeLayerSetting({ showColorbar: true }),
    ];
    await syncVolumesAndApplySettings(nv, volumes, settings);
    expect(nv.opts.isColorbar).toBe(true);
  });

  it('sets isColorbar to false when no layer has showColorbar', async () => {
    const volumes = [makeVolume('/mri.nii', 'id-mri')];
    await syncVolumesAndApplySettings(nv, volumes, [makeLayerSetting({ showColorbar: false })]);
    expect(nv.opts.isColorbar).toBe(false);
  });

  it('calls updateGLVolume after applying all settings', async () => {
    const volumes = [makeVolume('/mri.nii', 'id-mri')];
    await syncVolumesAndApplySettings(nv, volumes, [makeLayerSetting()]);
    expect(nv.updateGLVolume).toHaveBeenCalledOnce();
  });

  describe('appending volumes to an already-loaded NiiVue instance', () => {
    beforeEach(() => {
      // Simulate an instance that already finished its initial load
      nv.volumes = [makeVolume('/mri.nii', 'id-mri')];
      nv.addVolumesFromUrl = vi.fn().mockImplementation(async (vols) => {
        nv.volumes = [...nv.volumes, ...vols];
      });
    });

    it('calls addVolumesFromUrl with only the newly added volumes', async () => {
      const petVolume = makeVolume('/pet.nii', 'id-pet');
      const allVolumes = [makeVolume('/mri.nii', 'id-mri'), petVolume];
      const allSettings = [makeLayerSetting(), makeLayerSetting({ colormap: 'viridis' })];

      await syncVolumesAndApplySettings(nv, allVolumes, allSettings);

      expect(nv.addVolumesFromUrl).toHaveBeenCalledWith([petVolume]);
      expect(nv.loadVolumes).not.toHaveBeenCalled();
    });

    it('applies settings to pre-existing volumes as well as newly added ones', async () => {
      const allVolumes = [makeVolume('/mri.nii', 'id-mri'), makeVolume('/pet.nii', 'id-pet')];
      const allSettings = [
        makeLayerSetting({ colormap: 'gray' }),
        makeLayerSetting({ colormap: 'viridis' }),
      ];

      await syncVolumesAndApplySettings(nv, allVolumes, allSettings);

      expect(nv.setColormap).toHaveBeenCalledWith('id-mri', 'gray');
      expect(nv.setColormap).toHaveBeenCalledWith('id-pet', 'viridis');
    });

    it('does not call loadVolumes or addVolumesFromUrl when there are no new volumes', async () => {
      const allVolumes = [makeVolume('/mri.nii', 'id-mri')];

      await syncVolumesAndApplySettings(nv, allVolumes, [makeLayerSetting()]);

      expect(nv.loadVolumes).not.toHaveBeenCalled();
      expect(nv.addVolumesFromUrl).not.toHaveBeenCalled();
    });
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

    it('with startIndex > 0 (volumes already loaded), the first new volume does not get full opacity', () => {
      const result = getInitialLayerSettings([{ type: 'PET' }, { type: 'SPECT' }], 1);
      expect(result[0].opacity).toBe(0.6);
      expect(result[1].opacity).toBe(0.6);
    });
  });

  describe('component rendering', () => {
    it('renders a label for each loaded volume', async () => {
      const { Niivue } = await import('@niivue/niivue');
      const nvRef = { current: new Niivue() };
      const volumes = [
        { type: 'MRI', url: '/mri.nii' },
        { type: 'PET', url: '/pet.nii' },
        { type: 'SPECT', url: '/spect.nii' },
      ];
      render(<NiiViewer nvRef={nvRef} layers={volumes} />);
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
          addColormap: vi.fn(),
          updateGLVolume: vi.fn(),
          setSliceType: vi.fn(),
          setMultiplanarLayout: vi.fn(),
          setCornerOrientationText: vi.fn(),
          opts: { isColorbar: false, multiplanarShowRender: null, multiplanarEqualSize: true },
          sliceTypeMultiplanar: 1,
          volumes: [],
        };
      });
      const nvRef = { current: new Niivue() };

      render(<NiiViewer nvRef={nvRef} layers={[{ type: 'MRI', url: '/mri.nii' }]} />);
      expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
    });

    it('hides the loading spinner once volumes have loaded', async () => {
      const { Niivue } = await import('@niivue/niivue');
      const nvRef = { current: new Niivue() };
      render(<NiiViewer nvRef={nvRef} layers={[{ type: 'MRI', url: '/mri.nii' }]} />);
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
          addColormap: vi.fn(),
          updateGLVolume: vi.fn(),
          setSliceType: vi.fn(),
          setMultiplanarLayout: vi.fn(),
          setCornerOrientationText: vi.fn(),
          opts: { isColorbar: false, multiplanarShowRender: null, multiplanarEqualSize: true },
          sliceTypeMultiplanar: 1,
          volumes: [],
        };
      });

      const nvRef = { current: new Niivue() };
      const { default: toast } = await import('react-hot-toast');
      render(<NiiViewer nvRef={nvRef} layers={[{ type: 'MRI', url: '/mri.nii' }]} />);

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/failed to load image/i))
      );
    });

    it('calls nv.setColormap when the colormap setting changes', async () => {
      const { Niivue } = await import('@niivue/niivue');
      const nvRef = { current: new Niivue() };
      render(<NiiViewer nvRef={nvRef} layers={[{ type: 'MRI', url: '/mri.nii', id: 'mri-id' }]} />);
      await waitFor(() => expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument());

      // Expand the MRI card and change the colormap
      await userEvent.click(screen.getByRole('button', { name: 'Expand MRI controls' }));
      await userEvent.selectOptions(screen.getByLabelText('MRI colormap'), 'magma');

      const nv = nvRef.current;
      // toHaveBeenLastCalledWith isolates the handleSettingChange call from the initial syncVolumesAndApplySettings call
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
      const nvRef = { current: new Niivue() };
      render(<NiiViewer nvRef={nvRef} layers={[{ type: 'MRI', url: '/mri.nii' }]} />);
      await waitFor(() => expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument());
      const nv = nvRef.current;
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
      const nvRef = { current: new Niivue() };
      render(<NiiViewer nvRef={nvRef} layers={[{ type: 'MRI', url: '/mri.nii' }]} />);
      await waitFor(() => expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument());
      const nv = nvRef.current;
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
      const nvRef = { current: new Niivue() };
      render(<NiiViewer nvRef={nvRef} layers={[{ type: 'MRI', url: '/mri.nii' }]} />);
      await waitFor(() => expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument());
      const nv = nvRef.current;
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

  describe('slice type buttons without an image volume', () => {
    it('disables the 2D slice buttons but keeps 3D enabled', async () => {
      const { Niivue } = await import('@niivue/niivue');
      const nvRef = { current: new Niivue() };
      render(<NiiViewer nvRef={nvRef} layers={[]} />);
      await waitFor(() => expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument());

      expect(screen.getByRole('button', { name: 'Axial view' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Coronal view' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Sagittal view' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Multiplanar view' })).toBeDisabled();
      expect(screen.getByRole('button', { name: '3D view' })).not.toBeDisabled();
    });

    it('forces the 3D view as active when there is no image volume', async () => {
      const { Niivue, SLICE_TYPE } = await import('@niivue/niivue');
      const nvRef = { current: new Niivue() };
      render(<NiiViewer nvRef={nvRef} layers={[]} />);
      await waitFor(() => expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument());

      expect(screen.getByRole('button', { name: '3D view' })).toHaveAttribute(
        'aria-pressed',
        'true'
      );
      expect(nvRef.current.setSliceType).toHaveBeenCalledWith(SLICE_TYPE.RENDER);
    });

    it('re-enables the 2D buttons once an image volume is loaded', async () => {
      const { Niivue } = await import('@niivue/niivue');
      const nvRef = { current: new Niivue() };
      const { rerender } = render(<NiiViewer nvRef={nvRef} layers={[]} />);
      await waitFor(() => expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument());

      rerender(<NiiViewer nvRef={nvRef} layers={[{ type: 'MRI', url: '/mri.nii' }]} />);
      await waitFor(() => expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument());

      expect(screen.getByRole('button', { name: 'Axial view' })).not.toBeDisabled();
    });

    it('forces back to 3D when the last image volume is removed (e.g. an imaging-only reset)', async () => {
      const { Niivue } = await import('@niivue/niivue');
      const nvRef = { current: new Niivue() };
      const { rerender } = render(
        <NiiViewer nvRef={nvRef} layers={[{ type: 'MRI', url: '/mri.nii' }]} />
      );
      await waitFor(() => expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument());

      await userEvent.click(screen.getByRole('button', { name: 'Axial view' }));
      expect(screen.getByRole('button', { name: 'Axial view' })).toHaveAttribute(
        'aria-pressed',
        'true'
      );

      rerender(<NiiViewer nvRef={nvRef} layers={[]} />);

      expect(screen.getByRole('button', { name: '3D view' })).toHaveAttribute(
        'aria-pressed',
        'true'
      );
      expect(screen.getByRole('button', { name: 'Axial view' })).toBeDisabled();
    });

    it('re-enables the buttons once a volume is added via the internal drop zone, not just via the layers prop', async () => {
      const { Niivue } = await import('@niivue/niivue');
      const nvRef = { current: new Niivue() };
      // layers prop never changes here — the connectome is what keeps the component
      // mounted, and the new volume below arrives only through the component's own
      // "Drop additional files" zone, bypassing `layers` entirely.
      render(<NiiViewer nvRef={nvRef} layers={[]} connectomeLayer={makeConnectomeVolume()} />);
      await waitFor(() => expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument());
      expect(screen.getByRole('button', { name: 'Axial view' })).toBeDisabled();

      const input = document.querySelector('input[type="file"]');
      await userEvent.upload(input, new File(['data'], 'scan.nii'));
      await waitFor(() => expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument());

      expect(screen.getByRole('button', { name: 'Axial view' })).not.toBeDisabled();
    });

    it('explicitly syncs nv to the current slice type once an image volume is present, instead of leaving nv at whatever it was last set to', async () => {
      const { Niivue, SLICE_TYPE } = await import('@niivue/niivue');
      const nvRef = { current: new Niivue() };
      render(<NiiViewer nvRef={nvRef} layers={[{ type: 'MRI', url: '/mri.nii' }]} />);
      await waitFor(() => expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument());

      // Without this explicit sync, a fresh mount with a volume already present would
      // never call setSliceType at all, silently inheriting nv's last value (e.g. RENDER,
      // forced during an earlier connectome-only phase on this same long-lived instance)
      // while the buttons show React's own (different) default of MULTIPLANAR.
      expect(nvRef.current.setSliceType).toHaveBeenCalledWith(SLICE_TYPE.MULTIPLANAR);
    });
  });

  describe('appending volumes via the file drop zone', () => {
    it('does not give a newly-appended volume full opacity when other volumes are already loaded', async () => {
      const { Niivue } = await import('@niivue/niivue');
      const nvRef = { current: new Niivue() };
      render(<NiiViewer nvRef={nvRef} layers={[{ type: 'MRI', url: '/mri.nii' }]} />);
      await waitFor(() => expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument());

      const input = document.querySelector('input[type="file"]');
      await userEvent.upload(input, new File(['data'], 'scan.nii'));

      await waitFor(() => expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument());

      await userEvent.click(screen.getByRole('button', { name: 'Expand scan controls' }));
      expect(screen.getByLabelText('scan opacity')).toHaveValue(60);
    });

    it('does not pass the connectome to nv.loadVolumes and clears the spinner when adding a file while a connectome is loaded', async () => {
      const { Niivue } = await import('@niivue/niivue');
      const nvRef = { current: new Niivue() };
      render(<NiiViewer nvRef={nvRef} layers={[]} connectomeLayer={makeConnectomeVolume()} />);
      await waitFor(() => expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument());

      const nv = nvRef.current;
      const input = document.querySelector('input[type="file"]');
      await userEvent.upload(input, new File(['data'], 'scan.nii'));

      // Previously this never resolved: syncVolumesAndApplySettings tried to nv.loadVolumes()
      // the connectome's sentinel url as if it were a real image file, and with no try/catch
      // the spinner stayed stuck forever.
      await waitFor(() => expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument());

      expect(nv.loadVolumes).toHaveBeenCalledTimes(1);
      const loadedUrls = nv.loadVolumes.mock.calls[0][0].map((l) => l.url);
      expect(loadedUrls).not.toContain('__intracranial-electrodes__');

      // Both cards are present — the new volume alongside the untouched connectome.
      expect(screen.getByRole('button', { name: 'Expand scan controls' })).toBeInTheDocument();
      expect(screen.getByText('Intracranial')).toBeInTheDocument();
    });
  });

  describe('handleDeleteVolume', () => {
    const setup = async () => {
      const { Niivue } = await import('@niivue/niivue');
      const nvRef = { current: new Niivue() };
      render(
        <NiiViewer
          nvRef={nvRef}
          layers={[
            { type: 'MRI', url: '/mri.nii' },
            { type: 'PET', url: '/pet.nii' },
          ]}
        />
      );
      await waitFor(() => expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument());
      const nv = nvRef.current;
      // Clear calls from initial load so assertions only count post-load interactions
      nv.setOpacity.mockClear();
      nv.updateGLVolume.mockClear();
      return nv;
    };

    it('removes the correct volume from the NiiVue instance when delete is clicked', async () => {
      const nv = await setup();

      // click expand settings on the first volume (=> index = 0 )
      await userEvent.click(screen.getByRole('button', { name: `Expand MRI controls` }));
      // click the delete volume button
      await userEvent.click(screen.getByRole('button', { name: 'Close MRI volume' }));
      // expect to only have 1 volume left
      expect(nv.volumes.length).toBe(1);
      // expect the remaining volume to have the right url
      expect(nv.volumes[0].url).toBe('/pet.nii');
    });

    it('removes the volume settings card from the UI when delete is clicked', async () => {
      const nv = await setup();

      // click expand settings on the first volume (=> index = 0 )
      await userEvent.click(screen.getByRole('button', { name: `Expand MRI controls` }));
      // click the delete volume button
      await userEvent.click(screen.getByRole('button', { name: 'Close MRI volume' }));
      // expect the settings card to be removed
      expect(screen.queryByText('MRI')).not.toBeInTheDocument();
      // expect the other settings card to still be there
      expect(screen.queryByText('PET')).toBeInTheDocument();
    });
  });

  describe('canvas resize handle', () => {
    const MIN_CANVAS_HEIGHT = 350;

    const setup = async () => {
      const { Niivue } = await import('@niivue/niivue');
      const nvRef = { current: new Niivue() };
      render(<NiiViewer nvRef={nvRef} layers={[]} />);
      const row = screen.getByTestId('nii-canvas-row');
      vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({ height: 400 });
      return row;
    };

    it('renders a resize handle below the canvas', async () => {
      await setup();
      expect(screen.getByTestId('nii-canvas-resize-handle')).toBeInTheDocument();
    });

    it('raises the canvas row min-height when the handle is dragged down', async () => {
      const row = await setup();
      fireEvent.mouseDown(screen.getByTestId('nii-canvas-resize-handle'), { clientY: 0 });
      fireEvent.mouseMove(window, { clientY: 150 });
      fireEvent.mouseUp(window);

      expect(row.style.minHeight).toBe('550px'); // 400 (starting height) + 150 (drag delta)
    });

    it('lowers the canvas row min-height when the handle is dragged up', async () => {
      const row = await setup();
      fireEvent.mouseDown(screen.getByTestId('nii-canvas-resize-handle'), { clientY: 0 });
      fireEvent.mouseMove(window, { clientY: -50 });
      fireEvent.mouseUp(window);

      expect(row.style.minHeight).toBe('350px'); // 400 (starting height) - 50 (drag delta)
    });

    it('clamps at the 350px floor instead of shrinking further', async () => {
      const row = await setup();
      fireEvent.mouseDown(screen.getByTestId('nii-canvas-resize-handle'), { clientY: 0 });
      fireEvent.mouseMove(window, { clientY: -2000 }); // drag far past any reasonable minimum
      fireEvent.mouseUp(window);

      expect(row.style.minHeight).toBe(`${MIN_CANVAS_HEIGHT}px`);
    });

    it('stops responding to mouse movement once the drag ends', async () => {
      const row = await setup();
      fireEvent.mouseDown(screen.getByTestId('nii-canvas-resize-handle'), { clientY: 0 });
      fireEvent.mouseMove(window, { clientY: 100 });
      fireEvent.mouseUp(window);
      fireEvent.mouseMove(window, { clientY: 500 }); // should be ignored — drag already ended

      expect(row.style.minHeight).toBe('500px');
    });
  });

  describe('connectome layer (intracranial electrodes)', () => {
    it('builds and adds a connectome mesh via loadConnectomeAsMesh + addMesh when connectomeLayer is provided', async () => {
      const { Niivue } = await import('@niivue/niivue');
      const nvRef = { current: new Niivue() };
      render(<NiiViewer nvRef={nvRef} layers={[]} connectomeLayer={makeConnectomeVolume()} />);
      await waitFor(() => expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument());

      const nv = nvRef.current;
      expect(nv.loadConnectomeAsMesh).toHaveBeenCalled();
      expect(nv.addMesh).toHaveBeenCalled();
    });

    it('renders a card for the connectome layer in ImagingControls alongside image volumes', async () => {
      const { Niivue } = await import('@niivue/niivue');
      const nvRef = { current: new Niivue() };
      render(
        <NiiViewer
          nvRef={nvRef}
          layers={[{ type: 'MRI', url: '/mri.nii' }]}
          connectomeLayer={makeConnectomeVolume()}
        />
      );
      await waitFor(() => expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument());

      // type and subtype render as separate text nodes (see "renders subtype with a dash
      // prefix" in ImagingControls.test.jsx for the same pattern), so query them separately.
      expect(screen.getByText('MRI')).toBeInTheDocument();
      expect(screen.getByText('Intracranial')).toBeInTheDocument();
      expect(screen.getByText('- Electrodes')).toBeInTheDocument();
    });

    it('never passes the connectome through nv.loadVolumes', async () => {
      const { Niivue } = await import('@niivue/niivue');
      const nvRef = { current: new Niivue() };
      const mriLayer = { type: 'MRI', url: '/mri.nii' };
      render(
        <NiiViewer nvRef={nvRef} layers={[mriLayer]} connectomeLayer={makeConnectomeVolume()} />
      );
      await waitFor(() => expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument());

      // Compares against the same object reference passed in — syncVolumesAndApplySettings
      // mutates layer objects in place (e.g. colorbarVisible), so a fresh literal here would
      // diverge from the (by-then-mutated) recorded call argument despite being the same data.
      expect(nvRef.current.loadVolumes).toHaveBeenCalledWith([mriLayer]);
    });

    it('rebuilds the mesh when connectomeLayer data changes, without resetting other layers settings or reloading images', async () => {
      const { Niivue } = await import('@niivue/niivue');
      const nvRef = { current: new Niivue() };
      // Held in a variable and reused across the rerender below — mirrors how PatientView's
      // own image-volumes state keeps the same array reference across EEG voltage updates;
      // only the separately-tracked connectomeLayer prop changes.
      const mriLayers = [{ type: 'MRI', url: '/mri.nii' }];
      const { rerender } = render(
        <NiiViewer nvRef={nvRef} layers={mriLayers} connectomeLayer={makeConnectomeVolume()} />
      );
      await waitFor(() => expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument());

      // Customize the MRI volume's visibility before the connectome refreshes
      await userEvent.click(screen.getByRole('button', { name: 'Hide MRI' }));

      const nv = nvRef.current;
      nv.loadVolumes.mockClear();
      nv.addMesh.mockClear();
      nv.removeMesh.mockClear();

      // Simulate an EEG voltage update producing a fresh connectome object
      rerender(
        <NiiViewer
          nvRef={nvRef}
          layers={mriLayers}
          connectomeLayer={makeConnectomeVolume({
            nodes: [{ name: 'B1', x: 0, y: 0, z: 0, colorValue: -5, sizeValue: 1 }],
          })}
        />
      );
      await waitFor(() => expect(nv.removeMesh).toHaveBeenCalled());

      expect(nv.addMesh).toHaveBeenCalled(); // rebuilt with the new data
      expect(nv.loadVolumes).not.toHaveBeenCalled(); // images untouched, not re-loaded
      // MRI's visibility change survived the connectome refresh
      expect(screen.getByRole('button', { name: 'Show MRI' })).toBeInTheDocument();
    });

    it('toggling the connectome card visibility sets mesh.opacity directly, not nv.setOpacity', async () => {
      const { Niivue } = await import('@niivue/niivue');
      const nvRef = { current: new Niivue() };
      render(
        <NiiViewer
          nvRef={nvRef}
          layers={[{ type: 'MRI', url: '/mri.nii' }]}
          connectomeLayer={makeConnectomeVolume()}
        />
      );
      await waitFor(() => expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument());

      const nv = nvRef.current;
      const mesh = nv.addMesh.mock.calls.at(-1)[0];
      nv.setOpacity.mockClear();

      await userEvent.click(screen.getByRole('button', { name: 'Hide Intracranial - Electrodes' }));

      expect(mesh.opacity).toBe(0);
      expect(nv.setOpacity).not.toHaveBeenCalled();
    });

    it('removes the mesh and its card when connectomeLayer becomes null', async () => {
      const { Niivue } = await import('@niivue/niivue');
      const nvRef = { current: new Niivue() };
      const { rerender } = render(
        <NiiViewer nvRef={nvRef} layers={[]} connectomeLayer={makeConnectomeVolume()} />
      );
      await waitFor(() => expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument());

      const nv = nvRef.current;
      const mesh = nv.addMesh.mock.calls.at(-1)[0];

      rerender(<NiiViewer nvRef={nvRef} layers={[]} connectomeLayer={null} />);

      expect(nv.removeMesh).toHaveBeenCalledWith(mesh);
      expect(screen.queryByText('Intracranial - Electrodes')).not.toBeInTheDocument();
    });

    it('deleting the connectome card calls nv.removeMesh, not nv.removeVolumeByIndex', async () => {
      const { Niivue } = await import('@niivue/niivue');
      const nvRef = { current: new Niivue() };
      render(
        <NiiViewer
          nvRef={nvRef}
          layers={[{ type: 'MRI', url: '/mri.nii' }]}
          connectomeLayer={makeConnectomeVolume()}
        />
      );
      await waitFor(() => expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument());

      const nv = nvRef.current;
      const mesh = nv.addMesh.mock.calls.at(-1)[0];
      nv.removeVolumeByIndex.mockClear();

      await userEvent.click(
        screen.getByRole('button', { name: 'Expand Intracranial - Electrodes controls' })
      );
      await userEvent.click(
        screen.getByRole('button', { name: 'Close Intracranial - Electrodes volume' })
      );

      expect(nv.removeMesh).toHaveBeenCalledWith(mesh);
      expect(nv.removeVolumeByIndex).not.toHaveBeenCalled();
    });

    it('clears volumes and meshes from the shared nv instance when the component unmounts', async () => {
      const { Niivue } = await import('@niivue/niivue');
      const nvRef = { current: new Niivue() };
      const { unmount } = render(
        <NiiViewer
          nvRef={nvRef}
          layers={[{ type: 'MRI', url: '/mri.nii' }]}
          connectomeLayer={makeConnectomeVolume()}
        />
      );
      await waitFor(() => expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument());

      const nv = nvRef.current;
      expect(nv.volumes.length).toBe(1);
      expect(nv.meshes.length).toBe(1);

      unmount();

      expect(nv.volumes.length).toBe(0);
      expect(nv.meshes.length).toBe(0);
    });

    it('clears stale volumes from nv when layers drops to empty while a connectome keeps the component mounted', async () => {
      const { Niivue } = await import('@niivue/niivue');
      const nvRef = { current: new Niivue() };
      const { rerender } = render(
        <NiiViewer
          nvRef={nvRef}
          layers={[{ type: 'MRI', url: '/mri.nii' }]}
          connectomeLayer={makeConnectomeVolume()}
        />
      );
      await waitFor(() => expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument());

      const nv = nvRef.current;
      expect(nv.volumes.length).toBe(1);

      // Imaging-only reset: layers clears but the connectome stays, so the component
      // never unmounts — the early-return branch must clear nv directly instead.
      rerender(<NiiViewer nvRef={nvRef} layers={[]} connectomeLayer={makeConnectomeVolume()} />);

      expect(nv.volumes.length).toBe(0);
      expect(nv.meshes.length).toBe(1); // connectome mesh is untouched by this reset
    });

    it('drops the stale MRI card from ImagingControls on an imaging-only reset, keeping the connectome card', async () => {
      const { Niivue } = await import('@niivue/niivue');
      const nvRef = { current: new Niivue() };
      const { rerender } = render(
        <NiiViewer
          nvRef={nvRef}
          layers={[{ type: 'MRI', url: '/mri.nii' }]}
          connectomeLayer={makeConnectomeVolume()}
        />
      );
      await waitFor(() => expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument());
      expect(screen.getByText('MRI')).toBeInTheDocument();

      // Same imaging-only reset as above — this time checking the rendered card list,
      // which previously kept showing the MRI card even after its volume was removed.
      rerender(<NiiViewer nvRef={nvRef} layers={[]} connectomeLayer={makeConnectomeVolume()} />);

      expect(screen.queryByText('MRI')).not.toBeInTheDocument();
      expect(screen.getByText('Intracranial')).toBeInTheDocument();
    });

    it('does not crash when adding an image volume right after mounting with a connectome already present, under StrictMode', async () => {
      const { Niivue } = await import('@niivue/niivue');
      const nvRef = { current: new Niivue() };
      // StrictMode double-invokes updater functions passed to setState (for purity
      // checking) — this used to duplicate the connectome's settings entry the first time
      // it was merged in (see the comment on the connectomeLayer merge effect), silently
      // misaligning orderedLayers/layerSettings by one. That misalignment only surfaced
      // later, as a crash here when adding an image volume via the internal drop zone —
      // exactly the repro reported: EEG + electrode positions loaded first, then an MRI.
      render(
        <StrictMode>
          <NiiViewer nvRef={nvRef} layers={[]} connectomeLayer={makeConnectomeVolume()} />
        </StrictMode>
      );
      await waitFor(() => expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument());

      const input = document.querySelector('input[type="file"]');
      await userEvent.upload(input, new File(['data'], 'scan.nii'));
      await waitFor(() => expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument());

      expect(screen.getByRole('button', { name: 'Expand scan controls' })).toBeInTheDocument();
      expect(screen.getByText('Intracranial')).toBeInTheDocument();
    });
  });
});
