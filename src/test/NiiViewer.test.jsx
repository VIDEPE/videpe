import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getInitialVisibility, applyToggle } from '@/components/NiiViewer.utils';
import { NiiViewer } from '@/components/NiiViewer';

vi.mock('@niivue/niivue', () => ({
  Niivue: vi.fn().mockImplementation(() => ({
    attachToCanvas: vi.fn(),
    loadVolumes: vi.fn().mockResolvedValue(undefined),
    setOpacity: vi.fn(),
    setSliceType: vi.fn(),
    opts: {},
    sliceTypeMultiplanar: 1,
  })),
  SHOW_RENDER: { ALWAYS: 2 },
}));

describe('NiiViewer', () => {
  describe('getInitialVisibility', () => {
    it('hides PET when MRI, PET and SPECT are all loaded', () => {
      expect(getInitialVisibility([{ type: 'MRI' }, { type: 'PET' }, { type: 'SPECT' }])).toEqual([
        true,
        false,
        true,
      ]);
    });

    it('shows a single volume', () => {
      expect(getInitialVisibility([{ type: 'MRI' }])).toEqual([true]);
      expect(getInitialVisibility([{ type: 'PET' }])).toEqual([true]);
      expect(getInitialVisibility([{ type: 'SPECT' }])).toEqual([true]);
    });

    it('shows both volumes when SPECT is loaded with either MRI or PET', () => {
      expect(getInitialVisibility([{ type: 'PET' }, { type: 'SPECT' }])).toEqual([true, true]);
      expect(getInitialVisibility([{ type: 'MRI' }, { type: 'SPECT' }])).toEqual([true, true]);
    });
  });

  describe('applyToggle', () => {
    const volumes = [{ type: 'MRI' }, { type: 'PET' }, { type: 'SPECT' }];

    it('toggles a volume off', () => {
      expect(applyToggle(volumes, [true, false, false], 0)).toEqual([false, false, false]);
    });

    it('toggles a volume on', () => {
      expect(applyToggle(volumes, [false, false, false], 0)).toEqual([true, false, false]);
    });

    it('turning MRI on hides PET', () => {
      expect(applyToggle(volumes, [false, true, true], 0)).toEqual([true, false, true]);
    });

    it('turning PET on hides MRI', () => {
      expect(applyToggle(volumes, [true, false, true], 1)).toEqual([false, true, true]);
    });

    it('SPECT toggles independently of MRI and PET', () => {
      expect(applyToggle(volumes, [true, false, true], 2)).toEqual([true, false, false]);
      expect(applyToggle(volumes, [true, false, false], 2)).toEqual([true, false, true]);
    });
  });

  describe('button style toggle behaviour', () => {
    const volumes = [{ type: 'MRI', url: '/mri.nii' }, { type: 'PET', url: '/pet.nii' }];

    it('button gets thin-button-toggled class when clicked off', async () => {
      const user = userEvent.setup();
      render(<NiiViewer volumes={volumes} />);

      const mriButton = screen.getByRole('button', { name: /toggle MRI/i });
      expect(mriButton.className).not.toContain('thin-button-toggled');

      await user.click(mriButton);

      expect(mriButton.className).toContain('thin-button-toggled');
    });
  });
});
