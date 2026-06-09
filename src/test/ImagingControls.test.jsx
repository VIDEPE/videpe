import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImagingControls } from '@/components/ImagingControls';

const makeVolume = (type, url) => ({ type, url });

const makeSettings = (overrides = {}) => ({
  visible: true,
  opacity: 1.0,
  colormap: 'gray',
  invert: false,
  showColorbar: false,
  ...overrides,
});

const renderControls = (volumes, settings, onSettingChange = vi.fn()) =>
  render(
    <ImagingControls volumes={volumes} layerSettings={settings} onSettingChange={onSettingChange} />
  );

describe('ImagingControls', () => {
  describe('header row', () => {
    it('renders one card per volume showing the volume label', () => {
      renderControls(
        [makeVolume('MRI', '/mri.nii'), makeVolume('PET', '/pet.nii')],
        [makeSettings(), makeSettings({ colormap: 'viridis' })]
      );
      expect(screen.getByText('MRI')).toBeInTheDocument();
      expect(screen.getByText('PET')).toBeInTheDocument();
    });

    it('renders subtype with a dash prefix in muted style when subtype is present', () => {
      renderControls(
        [{ type: 'MRI', subtype: 'T1w', url: '/t1w.nii' }],
        [makeSettings()]
      );
      expect(screen.getByText('MRI')).toBeInTheDocument();
      const subtypeEl = screen.getByText('- T1w');
      expect(subtypeEl).toBeInTheDocument();
      expect(subtypeEl).toHaveClass('text-foreground/60');
    });

    it('shows only type when subtype is null', () => {
      renderControls(
        [{ type: 'PET', subtype: null, url: '/pet.nii' }],
        [makeSettings({ colormap: 'viridis' })]
      );
      expect(screen.getByText('PET')).toBeInTheDocument();
    });

    it('falls back to "Volume N" when volume has no type', () => {
      renderControls([{ url: '/scan.nii' }], [makeSettings()]);
      expect(screen.getByText('Layer 1')).toBeInTheDocument();
    });

    it('shows Hide button when volume is visible', () => {
      renderControls([makeVolume('MRI', '/mri.nii')], [makeSettings({ visible: true })]);
      expect(screen.getByRole('button', { name: 'Hide MRI' })).toBeInTheDocument();
    });

    it('shows Show button when volume is hidden', () => {
      renderControls([makeVolume('MRI', '/mri.nii')], [makeSettings({ visible: false })]);
      expect(screen.getByRole('button', { name: 'Show MRI' })).toBeInTheDocument();
    });

    it('calls onSettingChange with visible=false when clicking Hide', async () => {
      const onSettingChange = vi.fn();
      renderControls([makeVolume('MRI', '/mri.nii')], [makeSettings()], onSettingChange);
      await userEvent.click(screen.getByRole('button', { name: 'Hide MRI' }));
      expect(onSettingChange).toHaveBeenCalledWith(0, 'visible', false);
    });

    it('calls onSettingChange with visible=true when clicking Show', async () => {
      const onSettingChange = vi.fn();
      renderControls(
        [makeVolume('MRI', '/mri.nii')],
        [makeSettings({ visible: false })],
        onSettingChange
      );
      await userEvent.click(screen.getByRole('button', { name: 'Show MRI' }));
      expect(onSettingChange).toHaveBeenCalledWith(0, 'visible', true);
    });
  });

  describe('expand / collapse', () => {
    it('expanded controls are not visible by default', () => {
      renderControls([makeVolume('MRI', '/mri.nii')], [makeSettings()]);
      expect(screen.queryByLabelText('MRI opacity')).not.toBeInTheDocument();
    });

    it('clicking Expand shows the controls', async () => {
      renderControls([makeVolume('MRI', '/mri.nii')], [makeSettings()]);
      await userEvent.click(screen.getByRole('button', { name: 'Expand MRI controls' }));
      expect(screen.getByLabelText('MRI opacity')).toBeInTheDocument();
      expect(screen.getByLabelText('MRI colormap')).toBeInTheDocument();
      expect(screen.getByRole('switch', { name: 'Invert MRI colormap' })).toBeInTheDocument();
      expect(screen.getByRole('switch', { name: 'Show MRI colorbar' })).toBeInTheDocument();
    });

    it('clicking Collapse hides the controls again', async () => {
      renderControls([makeVolume('MRI', '/mri.nii')], [makeSettings()]);
      await userEvent.click(screen.getByRole('button', { name: 'Expand MRI controls' }));
      await userEvent.click(screen.getByRole('button', { name: 'Collapse MRI controls' }));
      expect(screen.queryByLabelText('MRI opacity')).not.toBeInTheDocument();
    });

    it('expanding one card collapses another', async () => {
      renderControls(
        [makeVolume('MRI', '/mri.nii'), makeVolume('PET', '/pet.nii')],
        [makeSettings(), makeSettings({ colormap: 'viridis' })]
      );
      await userEvent.click(screen.getByRole('button', { name: 'Expand MRI controls' }));
      expect(screen.getByLabelText('MRI opacity')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Expand PET controls' }));
      expect(screen.queryByLabelText('MRI opacity')).not.toBeInTheDocument();
      expect(screen.getByLabelText('PET opacity')).toBeInTheDocument();
    });
  });

  describe('expanded controls', () => {
    const setup = async (volumeType, settings, onSettingChange = vi.fn()) => {
      renderControls([makeVolume(volumeType, `/${volumeType}.nii`)], [settings], onSettingChange);
      await userEvent.click(screen.getByRole('button', { name: `Expand ${volumeType} controls` }));
      return onSettingChange;
    };

    it('opacity slider reflects current opacity as a 0–1 value', async () => {
      await setup('MRI', makeSettings({ opacity: 0.6 }));
      expect(screen.getByLabelText('MRI opacity slider')).toHaveValue('0.6');
    });

    it('opacity number input reflects current opacity as a 0–100 integer', async () => {
      await setup('MRI', makeSettings({ opacity: 0.6 }));
      expect(screen.getByLabelText('MRI opacity')).toHaveValue(60);
    });

    it('opacity slider change calls onSettingChange with 0–1 float value', async () => {
      const onSettingChange = await setup('MRI', makeSettings({ opacity: 1.0 }));
      fireEvent.change(screen.getByLabelText('MRI opacity slider'), { target: { value: '0.5' } });
      expect(onSettingChange).toHaveBeenCalledWith(0, 'opacity', 0.5);
    });

    it('opacity number input change calls onSettingChange with rounded 0–1 value', async () => {
      const onSettingChange = await setup('MRI', makeSettings({ opacity: 1.0 }));
      fireEvent.change(screen.getByLabelText('MRI opacity'), { target: { value: '75' } });
      expect(onSettingChange).toHaveBeenCalledWith(0, 'opacity', 0.75);
    });

    it('opacity number input clamps to 0–100 on blur', async () => {
      const onSettingChange = await setup('MRI', makeSettings({ opacity: 0.5 }));
      fireEvent.change(screen.getByLabelText('MRI opacity'), { target: { value: '150' } });
      fireEvent.blur(screen.getByLabelText('MRI opacity'));
      expect(onSettingChange).toHaveBeenLastCalledWith(0, 'opacity', 1);
    });

    it('opacity slider change updates the number input display', async () => {
      await setup('MRI', makeSettings({ opacity: 1.0 }));
      fireEvent.change(screen.getByLabelText('MRI opacity slider'), { target: { value: '0.4' } });
      expect(screen.getByLabelText('MRI opacity')).toHaveValue(40);
    });

    it('colormap select reflects current colormap', async () => {
      await setup('PET', makeSettings({ colormap: 'viridis' }));
      expect(screen.getByLabelText('PET colormap')).toHaveValue('viridis');
    });

    it('colormap select change calls onSettingChange', async () => {
      const onSettingChange = await setup('MRI', makeSettings({ colormap: 'gray' }));
      await userEvent.selectOptions(screen.getByLabelText('MRI colormap'), 'magma');
      expect(onSettingChange).toHaveBeenCalledWith(0, 'colormap', 'magma');
    });

    it('invert toggle reflects current invert state', async () => {
      await setup('MRI', makeSettings({ invert: false }));
      expect(screen.getByRole('switch', { name: 'Invert MRI colormap' })).toHaveAttribute(
        'aria-checked',
        'false'
      );
    });

    it('invert toggle click calls onSettingChange with toggled value', async () => {
      const onSettingChange = await setup('MRI', makeSettings({ invert: false }));
      await userEvent.click(screen.getByRole('switch', { name: 'Invert MRI colormap' }));
      expect(onSettingChange).toHaveBeenCalledWith(0, 'invert', true);
    });

    it('colorbar toggle click calls onSettingChange with toggled value', async () => {
      const onSettingChange = await setup('MRI', makeSettings({ showColorbar: false }));
      await userEvent.click(screen.getByRole('switch', { name: 'Show MRI colorbar' }));
      expect(onSettingChange).toHaveBeenCalledWith(0, 'showColorbar', true);
    });
  });
});
