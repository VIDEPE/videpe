import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getInitialLayerSettings, detectVolumeType } from '@/components/NiiViewer.utils';
import { NiiViewer } from '@/components/NiiViewer';

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
      opts: { isColorbar: false },
      sliceTypeMultiplanar: 1,
      volumes: [],
    };
    return instance;
  }),
  SHOW_RENDER: { ALWAYS: 2 },
}));

describe('detectVolumeType', () => {
  describe('BIDS suffix detection', () => {
    it('detects T1w in .nii as MRI with gray colormap', () => {
      expect(detectVolumeType('sub-01_T1w.nii')).toEqual({ type: 'MRI', colormap: 'gray' });
    });

    it('detects T1w in .nii.gz (compressed) as MRI — extension must not interfere', () => {
      expect(detectVolumeType('sub-01_T1w.nii.gz')).toEqual({ type: 'MRI', colormap: 'gray' });
    });

    it('detects T2w as MRI', () => {
      expect(detectVolumeType('sub-01_ses-01_T2w.nii.gz')).toEqual({ type: 'MRI', colormap: 'gray' });
    });

    it('detects FLAIR as MRI', () => {
      expect(detectVolumeType('sub-01_FLAIR.nii.gz')).toEqual({ type: 'MRI', colormap: 'gray' });
    });

    it('detects pet suffix as PET with viridis colormap', () => {
      expect(detectVolumeType('sub-01_pet.nii.gz')).toEqual({ type: 'PET', colormap: 'viridis' });
    });

    it('detects spect suffix as SPECT with magma colormap', () => {
      expect(detectVolumeType('sub-01_spect.nii.gz')).toEqual({ type: 'SPECT', colormap: 'magma' });
    });

    it('does not match PET (uppercase) as BIDS pet — falls through to keyword', () => {
      // BIDS suffix 'pet' is lowercase; 'PET' does not match BIDS but keyword fallback catches it
      expect(detectVolumeType('scan_PET.nii')).toEqual({ type: 'PET', colormap: 'viridis' });
    });
  });

  describe('keyword fallback for non-BIDS filenames', () => {
    it('detects t1 keyword as MRI', () => {
      expect(detectVolumeType('my_t1_scan.nii')).toEqual({ type: 'MRI', colormap: 'gray' });
    });

    it('detects fdg keyword as PET', () => {
      expect(detectVolumeType('fdg_uptake.nii.gz')).toEqual({ type: 'PET', colormap: 'viridis' });
    });

    it('detects siscom keyword as SPECT', () => {
      expect(detectVolumeType('pat_siscom_17-13.nii')).toEqual({ type: 'SPECT', colormap: 'magma' });
    });

    it('detects mprage keyword as MRI', () => {
      expect(detectVolumeType('mprage.nii.gz')).toEqual({ type: 'MRI', colormap: 'gray' });
    });
  });

  describe('unknown filenames', () => {
    it('returns the bare filename (no extension) as type with gray colormap', () => {
      expect(detectVolumeType('scan.nii')).toEqual({ type: 'scan', colormap: 'gray' });
    });

    it('handles files with no extension', () => {
      expect(detectVolumeType('unknown_volume')).toEqual({ type: 'unknown_volume', colormap: 'gray' });
    });

    it('uses the full bare name when no _ separator is present', () => {
      expect(detectVolumeType('brainmask.nii.gz')).toEqual({ type: 'brainmask', colormap: 'gray' });
    });
  });
});

describe('NiiViewer', () => {
  describe('getInitialLayerSettings', () => {
    it('starts all layers visible with full opacity', () => {
      const result = getInitialLayerSettings([{ type: 'MRI' }, { type: 'PET' }, { type: 'SPECT' }]);
      expect(result.every((layer) => layer.visible)).toBe(true);
      expect(result.every((layer) => layer.opacity === 1.0)).toBe(true);
    });

    it('takes colormap from the volume object', () => {
      const result = getInitialLayerSettings([
        { type: 'MRI', colormap: 'gray' },
        { type: 'PET', colormap: 'viridis' },
        { type: 'SPECT', colormap: 'magma' },
      ]);
      expect(result[0].colormap).toBe('gray');
      expect(result[1].colormap).toBe('viridis');
      expect(result[2].colormap).toBe('magma');
    });

    it('defaults colormap to gray when not set on the volume', () => {
      const result = getInitialLayerSettings([{ type: 'MRI' }]);
      expect(result[0].colormap).toBe('gray');
    });

    it('defaults invert and showColorbar to false', () => {
      const result = getInitialLayerSettings([{ type: 'MRI', colormap: 'gray' }]);
      expect(result[0].invert).toBe(false);
      expect(result[0].showColorbar).toBe(false);
    });
  });

  describe('button style toggle behaviour', () => {
    const volumes = [
      { type: 'MRI', url: '/mri.nii' },
      { type: 'PET', url: '/pet.nii' },
    ];

    it('button gets button-toggled class when clicked off', async () => {
      const user = userEvent.setup();
      render(<NiiViewer volumes={volumes} />);

      const mriButton = screen.getByRole('button', { name: /toggle MRI/i });
      expect(mriButton.className).not.toContain('button-toggled');

      await user.click(mriButton);

      expect(mriButton.className).toContain('button-toggled');
    });
  });

  describe('component rendering', () => {
    it('renders one toggle button per volume', async () => {
      const volumes = [
        { type: 'MRI', url: '/mri.nii' },
        { type: 'PET', url: '/pet.nii' },
        { type: 'SPECT', url: '/spect.nii' },
      ];
      render(<NiiViewer volumes={volumes} />);
      await waitFor(() => expect(screen.queryByText('Loading image...')).not.toBeInTheDocument());
      expect(screen.getByRole('button', { name: /toggle MRI/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /toggle PET/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /toggle SPECT/i })).toBeInTheDocument();
    });

    it('shows "Loading image..." while volumes are loading', async () => {
      const { Niivue } = await import('@niivue/niivue');
      // Block loadVolumes so the loading state never resolves during this test
      Niivue.mockImplementationOnce(function () {
        return {
          attachToCanvas: vi.fn(),
          loadVolumes: vi.fn().mockReturnValue(new Promise(() => {})),
          setOpacity: vi.fn(),
          setSliceType: vi.fn(),
          opts: {},
          sliceTypeMultiplanar: 1,
          volumes: [],
        };
      });

      render(<NiiViewer volumes={[{ type: 'MRI', url: '/mri.nii' }]} />);
      expect(screen.getByText('Loading image...')).toBeInTheDocument();
    });

    it('hides "Loading image..." once volumes have loaded', async () => {
      render(<NiiViewer volumes={[{ type: 'MRI', url: '/mri.nii' }]} />);
      await waitFor(() => expect(screen.queryByText('Loading image...')).not.toBeInTheDocument());
    });

    it('shows an error message when loadVolumes rejects', async () => {
      const { Niivue } = await import('@niivue/niivue');
      Niivue.mockImplementationOnce(function () {
        return {
          attachToCanvas: vi.fn(),
          loadVolumes: vi.fn().mockRejectedValue(new Error('Network error')),
          setOpacity: vi.fn(),
          setSliceType: vi.fn(),
          opts: {},
          sliceTypeMultiplanar: 1,
          volumes: [],
        };
      });

      render(<NiiViewer volumes={[{ type: 'MRI', url: '/mri.nii' }]} />);

      await waitFor(() => expect(screen.getByText(/failed to load image/i)).toBeInTheDocument());
    });
  });
});
