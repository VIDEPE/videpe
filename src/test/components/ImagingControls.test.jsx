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
  cal_min: 0,
  cal_max: 1,
  ...overrides,
});

// Helper to render the component with default props and allow overrides
const renderControls = (layers, settings, onSettingChange = vi.fn(), onDeleteLayer = vi.fn()) =>
  render(
    <ImagingControls
      layers={layers}
      layerSettings={settings}
      onSettingChange={onSettingChange}
      onDeleteLayer={onDeleteLayer}
    />
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
      renderControls([{ type: 'MRI', subtype: 'T1w', url: '/t1w.nii' }], [makeSettings()]);
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
      // Controls are always rendered (for the collapse animation) but hidden via aria-hidden on the wrapper
      expect(screen.getByLabelText('MRI opacity').closest('[aria-hidden]')).toHaveAttribute(
        'aria-hidden',
        'true'
      );
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
      // Controls are always rendered (for the collapse animation) but hidden via aria-hidden on the wrapper
      expect(screen.getByLabelText('MRI opacity').closest('[aria-hidden]')).toHaveAttribute(
        'aria-hidden',
        'true'
      );
    });

    it('expanding one card collapses another', async () => {
      renderControls(
        [makeVolume('MRI', '/mri.nii'), makeVolume('PET', '/pet.nii')],
        [makeSettings(), makeSettings({ colormap: 'viridis' })]
      );
      await userEvent.click(screen.getByRole('button', { name: 'Expand MRI controls' }));
      expect(screen.getByLabelText('MRI opacity')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Expand PET controls' }));
      // Controls are always rendered (for the collapse animation) but hidden via aria-hidden on the wrapper
      expect(screen.getByLabelText('MRI opacity').closest('[aria-hidden]')).toHaveAttribute(
        'aria-hidden',
        'true'
      );
      expect(screen.getByLabelText('PET opacity').closest('[aria-hidden]')).toHaveAttribute(
        'aria-hidden',
        'false'
      );
    });
  });

  describe('expanded controls', () => {
    // setup does two things: renders one volume and expands it.
    const setup = async (
      volumeType,
      settings,
      onSettingChange = vi.fn(),
      onDeleteVolume = vi.fn()
    ) => {
      renderControls(
        [makeVolume(volumeType, `/${volumeType}.nii`)],
        [settings],
        onSettingChange,
        onDeleteVolume
      );
      await userEvent.click(screen.getByRole('button', { name: `Expand ${volumeType} controls` }));
      return { onSettingChange, onDeleteVolume };
    };

    it('opacity slider reflects current opacity as a 0–100 value', async () => {
      await setup('MRI', makeSettings({ opacity: 0.6 }));
      expect(screen.getByLabelText('MRI opacity slider')).toHaveValue('60');
    });

    it('opacity number input reflects current opacity as a 0–100 integer', async () => {
      await setup('MRI', makeSettings({ opacity: 0.6 }));
      expect(screen.getByLabelText('MRI opacity')).toHaveValue(60);
    });

    it('opacity slider change calls onSettingChange with a 0–1 float value', async () => {
      const { onSettingChange } = await setup('MRI', makeSettings({ opacity: 1.0 }));
      fireEvent.change(screen.getByLabelText('MRI opacity slider'), { target: { value: '50' } });
      expect(onSettingChange).toHaveBeenCalledWith(0, 'opacity', 0.5);
    });

    it('opacity number input change calls onSettingChange with rounded 0–1 value', async () => {
      const { onSettingChange } = await setup('MRI', makeSettings({ opacity: 1.0 }));
      fireEvent.change(screen.getByLabelText('MRI opacity'), { target: { value: '75' } });
      expect(onSettingChange).toHaveBeenCalledWith(0, 'opacity', 0.75);
    });

    it('opacity number input clamps to 0–100 on blur', async () => {
      const { onSettingChange } = await setup('MRI', makeSettings({ opacity: 0.5 }));
      fireEvent.change(screen.getByLabelText('MRI opacity'), { target: { value: '150' } });
      fireEvent.blur(screen.getByLabelText('MRI opacity'));
      expect(onSettingChange).toHaveBeenLastCalledWith(0, 'opacity', 1);
    });

    it('opacity slider change updates the number input display', async () => {
      await setup('MRI', makeSettings({ opacity: 1.0 }));
      fireEvent.change(screen.getByLabelText('MRI opacity slider'), { target: { value: '40' } });
      expect(screen.getByLabelText('MRI opacity')).toHaveValue(40);
    });

    it('colormap select reflects current colormap', async () => {
      await setup('PET', makeSettings({ colormap: 'viridis' }));
      expect(screen.getByLabelText('PET colormap')).toHaveValue('viridis');
    });

    it('colormap select change calls onSettingChange', async () => {
      const { onSettingChange } = await setup('MRI', makeSettings({ colormap: 'gray' }));
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
      const { onSettingChange } = await setup('MRI', makeSettings({ invert: false }));
      await userEvent.click(screen.getByRole('switch', { name: 'Invert MRI colormap' }));
      expect(onSettingChange).toHaveBeenCalledWith(0, 'invert', true);
    });

    it('colorbar toggle click calls onSettingChange with toggled value', async () => {
      const { onSettingChange } = await setup('MRI', makeSettings({ showColorbar: false }));
      await userEvent.click(screen.getByRole('switch', { name: 'Show MRI colorbar' }));
      expect(onSettingChange).toHaveBeenCalledWith(0, 'showColorbar', true);
    });

    it('the delete volume button is rendered', async () => {
      await setup('MRI', makeSettings());
      expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
    });

    it('delete volume button calls onDeleteVolume', async () => {
      const { onDeleteVolume } = await setup('MRI', makeSettings());
      await userEvent.click(screen.getByRole('button', { name: /close/i }));
      expect(onDeleteVolume).toHaveBeenCalledWith(0);
    });

    it('delete volume button in settingsCard 1, calls onDeleteVolume with 1 and not with 0', async () => {
      // Mock onDeleteVolume
      const onDeleteVolume = vi.fn();

      // render controls for 2 volumes
      renderControls(
        [makeVolume('MRI', '/mri.nii'), makeVolume('PET', '/pet.nii')],
        [makeSettings(), makeSettings()],
        vi.fn(),
        onDeleteVolume
      );

      // click expand on the 2nd (=> index = 1 )
      await userEvent.click(screen.getByRole('button', { name: `Expand PET controls` }));
      // click the delete volume button
      await userEvent.click(screen.getByRole('button', { name: 'Close PET volume' }));
      // expect onDeleteVolume to be called with index 1
      expect(onDeleteVolume).toHaveBeenCalledWith(1);
    });
  });

  describe('threshold', () => {
    const setup = async (settings, onSettingChange = vi.fn()) => {
      renderControls([makeVolume('MRI', '/mri.nii')], [settings], onSettingChange);
      await userEvent.click(screen.getByRole('button', { name: 'Expand MRI controls' }));
      return { onSettingChange };
    };

    it('min/max sliders and number inputs reflect current cal_min/cal_max as 0-100 values', async () => {
      await setup(makeSettings({ cal_min: 0.3, cal_max: 0.8 }));
      expect(screen.getByLabelText('MRI Threshold minimum slider')).toHaveValue('30');
      expect(screen.getByLabelText('MRI Threshold minimum')).toHaveValue(30);
      expect(screen.getByLabelText('MRI Threshold maximum slider')).toHaveValue('80');
      expect(screen.getByLabelText('MRI Threshold maximum')).toHaveValue(80);
    });

    it('min slider change calls onSettingChange with a 0-1 fraction', async () => {
      const { onSettingChange } = await setup(makeSettings({ cal_min: 0, cal_max: 1 }));
      fireEvent.change(screen.getByLabelText('MRI Threshold minimum slider'), {
        target: { value: '40' },
      });
      expect(onSettingChange).toHaveBeenCalledWith(0, 'cal_min', 0.4);
    });

    it('max number input change calls onSettingChange with a 0-1 fraction', async () => {
      const { onSettingChange } = await setup(makeSettings({ cal_min: 0, cal_max: 1 }));
      fireEvent.change(screen.getByLabelText('MRI Threshold maximum'), { target: { value: '70' } });
      expect(onSettingChange).toHaveBeenCalledWith(0, 'cal_max', 0.7);
    });

    it('min number input clamps to the current cal_max rather than exceeding it', async () => {
      const { onSettingChange } = await setup(makeSettings({ cal_min: 0.3, cal_max: 0.5 }));
      fireEvent.change(screen.getByLabelText('MRI Threshold minimum'), { target: { value: '80' } });
      expect(onSettingChange).toHaveBeenCalledWith(0, 'cal_min', 0.5);
    });

    it('max number input clamps to the current cal_min rather than going below it', async () => {
      const { onSettingChange } = await setup(makeSettings({ cal_min: 0.4, cal_max: 0.7 }));
      fireEvent.change(screen.getByLabelText('MRI Threshold maximum'), { target: { value: '10' } });
      expect(onSettingChange).toHaveBeenCalledWith(0, 'cal_max', 0.4);
    });

    it('min number input blur clamps to the current cal_max', async () => {
      const { onSettingChange } = await setup(makeSettings({ cal_min: 0.3, cal_max: 0.5 }));
      fireEvent.change(screen.getByLabelText('MRI Threshold minimum'), { target: { value: '90' } });
      fireEvent.blur(screen.getByLabelText('MRI Threshold minimum'));
      expect(onSettingChange).toHaveBeenLastCalledWith(0, 'cal_min', 0.5);
    });

    it('min slider max attribute tracks the current cal_max so it cannot be dragged past it', async () => {
      await setup(makeSettings({ cal_min: 0.2, cal_max: 0.6 }));
      expect(screen.getByLabelText('MRI Threshold minimum slider')).toHaveAttribute('max', '60');
    });

    it('max slider min attribute tracks the current cal_min so it cannot be dragged below it', async () => {
      await setup(makeSettings({ cal_min: 0.2, cal_max: 0.6 }));
      expect(screen.getByLabelText('MRI Threshold maximum slider')).toHaveAttribute('min', '20');
    });

    it('does not render Threshold controls for the intracranial electrode connectome layer', async () => {
      renderControls(
        [
          {
            kind: 'connectome',
            type: 'Intracranial',
            subtype: 'Electrodes',
            url: '__intracranial-electrodes__',
          },
        ],
        [makeSettings()]
      );
      await userEvent.click(
        screen.getByRole('button', { name: 'Expand Intracranial - Electrodes controls' })
      );
      expect(
        screen.queryByLabelText('Intracranial - Electrodes Threshold minimum')
      ).not.toBeInTheDocument();
    });

    it('renders Threshold controls for the ESI layer even in connectome mode', async () => {
      renderControls(
        [
          {
            kind: 'connectome',
            type: 'Electrical Source Imaging',
            url: '__esi-source-power__',
          },
        ],
        [makeSettings()]
      );
      await userEvent.click(
        screen.getByRole('button', { name: 'Expand Electrical Source Imaging controls' })
      );
      expect(
        screen.getByLabelText('Electrical Source Imaging Threshold minimum')
      ).toBeInTheDocument();
    });
  });

  describe('connectome layer', () => {
    const makeIntracranialLayer = () => ({
      kind: 'connectome',
      type: 'Intracranial',
      subtype: 'Electrodes',
      url: '__intracranial-electrodes__',
    });

    it('does not render Colormap, Invert, or Colorbar controls for a connectome-kind layer', async () => {
      renderControls([makeIntracranialLayer()], [makeSettings()]);
      await userEvent.click(
        screen.getByRole('button', { name: 'Expand Intracranial - Electrodes controls' })
      );

      expect(screen.queryByLabelText('Intracranial - Electrodes colormap')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('switch', { name: 'Invert Intracranial - Electrodes colormap' })
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('switch', { name: 'Show Intracranial - Electrodes colorbar' })
      ).not.toBeInTheDocument();
    });

    it('still renders the Opacity slider and Delete button for a connectome-kind layer', async () => {
      renderControls([makeIntracranialLayer()], [makeSettings()]);
      await userEvent.click(
        screen.getByRole('button', { name: 'Expand Intracranial - Electrodes controls' })
      );

      expect(screen.getByLabelText('Intracranial - Electrodes opacity slider')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Close Intracranial - Electrodes volume' })
      ).toBeInTheDocument();
    });

    it('still renders the visibility toggle and drag handle in the header for a connectome-kind layer', () => {
      renderControls([makeIntracranialLayer()], [makeSettings()]);

      expect(
        screen.getByRole('button', { name: 'Hide Intracranial - Electrodes' })
      ).toBeInTheDocument();
      expect(
        screen.getByLabelText('Drag to reorder Intracranial - Electrodes')
      ).toBeInTheDocument();
    });

    it('renders Colormap/Invert/Colorbar controls normally for non-connectome layers (regression)', async () => {
      renderControls([makeVolume('MRI', '/mri.nii')], [makeSettings()]);
      await userEvent.click(screen.getByRole('button', { name: 'Expand MRI controls' }));

      expect(screen.getByLabelText('MRI colormap')).toBeInTheDocument();
      expect(screen.getByRole('switch', { name: 'Invert MRI colormap' })).toBeInTheDocument();
      expect(screen.getByRole('switch', { name: 'Show MRI colorbar' })).toBeInTheDocument();
    });
  });
});
