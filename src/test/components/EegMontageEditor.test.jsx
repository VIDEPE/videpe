import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import toast from 'react-hot-toast';
import { downloadTextFile } from '@/utils/fileDownload';
import { EegMontageEditor } from '@/components/EegMontageEditor';

vi.mock('@/components/ThemeContext', () => ({
  useTheme: () => ({ isDarkMode: false }),
}));

vi.mock('react-hot-toast', () => {
  const toastFn = vi.fn();
  toastFn.error = vi.fn();
  return { default: toastFn };
});

vi.mock('@/utils/fileDownload', () => ({
  downloadTextFile: vi.fn(),
}));

const CHANNEL_NAMES = ['FP1', 'FP2', 'FP3'];

const CHANNEL_SETTINGS = {
  FP1: { type: 'eeg', bad: false },
  FP2: { type: 'eeg', bad: true },
  FP3: { type: 'seeg', bad: false },
};

// Only FP1 matched an electrode position — FP2/FP3 should show the Pos checkbox unchecked.
const MATCHED = [{ channelIdx: 0, name: 'FP1', pos: { label: 'FP1', x: 0, y: 0, z: 0 } }];

const MONTAGE_CHANNELS = CHANNEL_NAMES.map((name) => ({
  id: name,
  channel: name,
  reference: null,
  color: null,
}));

const defaultProps = {
  channelNames: CHANNEL_NAMES,
  matched: MATCHED,
  channelSettings: CHANNEL_SETTINGS,
  onApplyChannelSettings: vi.fn(),
  montageChannels: MONTAGE_CHANNELS,
  onApplyMontageChannels: vi.fn(),
  onClose: vi.fn(),
};

describe('EegMontageEditor', () => {
  it('renders without crashing', () => {
    const { container } = render(<EegMontageEditor {...defaultProps} />);
    expect(container.firstChild).toBeTruthy();
  });

  it('renders a row for every channel name', () => {
    // Each channel name now appears once per pane (channel selection + montage settings).
    render(<EegMontageEditor {...defaultProps} />);
    CHANNEL_NAMES.forEach((name) => expect(screen.getAllByText(name).length).toBeGreaterThan(0));
  });

  it('renders the column headers', () => {
    // "Channel" and "Type" each label a column in both panes.
    render(<EegMontageEditor {...defaultProps} />);
    expect(screen.getAllByText('Channel').length).toBeGreaterThan(0);
    expect(screen.getByText('Pos')).toBeTruthy();
    expect(screen.getAllByText('Type').length).toBeGreaterThan(0);
    expect(screen.getByText('Bad')).toBeTruthy();
  });

  describe('draft seeded from channelSettings', () => {
    it("shows each channel's type from the channelSettings prop", () => {
      render(<EegMontageEditor {...defaultProps} />);
      expect(screen.getByTestId('channel-type-FP1')).toHaveValue('eeg');
      expect(screen.getByTestId('channel-type-FP3')).toHaveValue('seeg');
    });

    it("shows each channel's bad flag from the channelSettings prop", () => {
      render(<EegMontageEditor {...defaultProps} />);
      expect(screen.getByTestId('channel-bad-FP1')).not.toBeChecked();
      expect(screen.getByTestId('channel-bad-FP2')).toBeChecked();
    });
  });

  describe('electrode position match indicator', () => {
    it('checks the Pos checkbox for a matched channel', () => {
      render(<EegMontageEditor {...defaultProps} />);
      expect(screen.getByTestId('channel-pos-FP1')).toBeChecked();
    });

    it('leaves the Pos checkbox unchecked for an unmatched channel', () => {
      render(<EegMontageEditor {...defaultProps} />);
      expect(screen.getByTestId('channel-pos-FP2')).not.toBeChecked();
    });

    it('disables the Pos checkbox — it is a read-only indicator', () => {
      render(<EegMontageEditor {...defaultProps} />);
      expect(screen.getByTestId('channel-pos-FP1')).toBeDisabled();
    });
  });

  describe('electrode position match tooltip', () => {
    it('names the matched electrode and the standard template by default', () => {
      render(<EegMontageEditor {...defaultProps} />);
      expect(screen.getByTestId('channel-pos-FP1')).toHaveAttribute(
        'title',
        'Matched to electrode "FP1" in the standard 10-05 template'
      );
    });

    it('names the loaded file instead of the standard template when one is active', () => {
      render(
        <EegMontageEditor
          {...defaultProps}
          isStandardElectrodes={false}
          customFileName="my_positions"
        />
      );
      expect(screen.getByTestId('channel-pos-FP1')).toHaveAttribute(
        'title',
        'Matched to electrode "FP1" in "my_positions"'
      );
    });

    it('explains there is no match for an unmatched channel', () => {
      render(<EegMontageEditor {...defaultProps} />);
      expect(screen.getByTestId('channel-pos-FP2')).toHaveAttribute(
        'title',
        'No match for "FP2" in the standard 10-05 template'
      );
    });
  });

  describe('unsaved-changes indicator', () => {
    it('shows no asterisk before any edits', () => {
      render(<EegMontageEditor {...defaultProps} />);
      expect(screen.getByText('Montage Editor')).toBeTruthy();
      expect(screen.queryByText('Montage Editor *')).toBeNull();
    });

    it('shows an asterisk after changing a channel type', async () => {
      render(<EegMontageEditor {...defaultProps} />);
      await userEvent.selectOptions(screen.getByTestId('channel-type-FP1'), 'seeg');
      expect(screen.getByText('Montage Editor *')).toBeTruthy();
    });

    it('shows an asterisk after toggling a bad checkbox', async () => {
      render(<EegMontageEditor {...defaultProps} />);
      await userEvent.click(screen.getByTestId('channel-bad-FP1'));
      expect(screen.getByText('Montage Editor *')).toBeTruthy();
    });
  });

  describe('Apply / OK / Cancel', () => {
    it('Cancel closes without committing the draft', async () => {
      const onClose = vi.fn();
      const onApplyChannelSettings = vi.fn();
      render(
        <EegMontageEditor
          {...defaultProps}
          onClose={onClose}
          onApplyChannelSettings={onApplyChannelSettings}
        />
      );
      await userEvent.selectOptions(screen.getByTestId('channel-type-FP1'), 'seeg');
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(onClose).toHaveBeenCalledOnce();
      expect(onApplyChannelSettings).not.toHaveBeenCalled();
    });

    it('Apply commits the edited draft but keeps the window open', async () => {
      const onClose = vi.fn();
      const onApplyChannelSettings = vi.fn();
      render(
        <EegMontageEditor
          {...defaultProps}
          onClose={onClose}
          onApplyChannelSettings={onApplyChannelSettings}
        />
      );
      await userEvent.selectOptions(screen.getByTestId('channel-type-FP1'), 'seeg');
      await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

      expect(onApplyChannelSettings).toHaveBeenCalledWith({
        ...CHANNEL_SETTINGS,
        FP1: { type: 'seeg', bad: false },
      });
      expect(onClose).not.toHaveBeenCalled();
    });

    it('OK commits the edited draft and closes', async () => {
      const onClose = vi.fn();
      const onApplyChannelSettings = vi.fn();
      render(
        <EegMontageEditor
          {...defaultProps}
          onClose={onClose}
          onApplyChannelSettings={onApplyChannelSettings}
        />
      );
      await userEvent.click(screen.getByTestId('channel-bad-FP1'));
      await userEvent.click(screen.getByRole('button', { name: 'OK' }));

      expect(onApplyChannelSettings).toHaveBeenCalledWith({
        ...CHANNEL_SETTINGS,
        FP1: { type: 'eeg', bad: true },
      });
      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  describe('Set all Bad / Set all Good', () => {
    const ALL_BAD_SETTINGS = {
      FP1: { type: 'eeg', bad: true },
      FP2: { type: 'eeg', bad: true },
      FP3: { type: 'seeg', bad: true },
    };

    it('shows "Set all Bad" when not every channel is already bad', () => {
      render(<EegMontageEditor {...defaultProps} />);
      expect(screen.getByRole('button', { name: 'Set all Bad' })).toBeTruthy();
    });

    it('shows "Set all Good" when every channel is already bad', () => {
      render(<EegMontageEditor {...defaultProps} channelSettings={ALL_BAD_SETTINGS} />);
      expect(screen.getByRole('button', { name: 'Set all Good' })).toBeTruthy();
    });

    it('marks every channel bad when clicked while not all are bad', async () => {
      render(<EegMontageEditor {...defaultProps} />);
      await userEvent.click(screen.getByRole('button', { name: 'Set all Bad' }));

      CHANNEL_NAMES.forEach((name) =>
        expect(screen.getByTestId(`channel-bad-${name}`)).toBeChecked()
      );
      expect(screen.getByRole('button', { name: 'Set all Good' })).toBeTruthy();
    });

    it('marks every channel good when clicked while all are bad', async () => {
      render(<EegMontageEditor {...defaultProps} channelSettings={ALL_BAD_SETTINGS} />);
      await userEvent.click(screen.getByRole('button', { name: 'Set all Good' }));

      CHANNEL_NAMES.forEach((name) =>
        expect(screen.getByTestId(`channel-bad-${name}`)).not.toBeChecked()
      );
      expect(screen.getByRole('button', { name: 'Set all Bad' })).toBeTruthy();
    });

    it('updates the label when a channel is unchecked by hand, not just via the button', async () => {
      render(<EegMontageEditor {...defaultProps} channelSettings={ALL_BAD_SETTINGS} />);
      await userEvent.click(screen.getByTestId('channel-bad-FP1'));
      expect(screen.getByRole('button', { name: 'Set all Bad' })).toBeTruthy();
    });
  });

  describe('Set all as [type]', () => {
    it('defaults the bulk type select to "eeg"', () => {
      render(<EegMontageEditor {...defaultProps} />);
      expect(screen.getByTestId('bulk-type-select')).toHaveValue('eeg');
    });

    it('sets every channel to the picked type when clicked', async () => {
      render(<EegMontageEditor {...defaultProps} />);
      await userEvent.selectOptions(screen.getByTestId('bulk-type-select'), 'seeg');
      await userEvent.click(screen.getByRole('button', { name: 'Set all as' }));

      CHANNEL_NAMES.forEach((name) =>
        expect(screen.getByTestId(`channel-type-${name}`)).toHaveValue('seeg')
      );
    });

    it("leaves each channel's bad flag untouched", async () => {
      render(<EegMontageEditor {...defaultProps} />);
      await userEvent.selectOptions(screen.getByTestId('bulk-type-select'), 'other');
      await userEvent.click(screen.getByRole('button', { name: 'Set all as' }));

      expect(screen.getByTestId('channel-bad-FP2')).toBeChecked();
      expect(screen.getByTestId('channel-bad-FP1')).not.toBeChecked();
    });
  });

  describe('montage settings pane', () => {
    it('renders a reference/color row for every montageChannels entry', () => {
      render(<EegMontageEditor {...defaultProps} />);
      // MONTAGE_CHANNELS seeds id === channel, so these testids double as an id check.
      CHANNEL_NAMES.forEach((name) => {
        expect(screen.getByTestId(`reference-${name}`)).toBeTruthy();
        expect(screen.getByTestId(`color-${name}`)).toBeTruthy();
      });
    });

    it('shows "— n/a —" for a row with no reference, instead of defaulting to the first channel', () => {
      // MONTAGE_CHANNELS seeds every row with reference: null.
      render(<EegMontageEditor {...defaultProps} />);
      expect(screen.getByTestId('reference-FP1')).toHaveValue('');
    });

    it('Apply commits an edited reference and color to onApplyMontageChannels', async () => {
      const onApplyMontageChannels = vi.fn();
      render(
        <EegMontageEditor {...defaultProps} onApplyMontageChannels={onApplyMontageChannels} />
      );
      await userEvent.selectOptions(screen.getByTestId('reference-FP1'), 'FP2');
      await userEvent.selectOptions(screen.getByTestId('color-FP1'), 'red');
      await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

      expect(onApplyMontageChannels).toHaveBeenCalledWith([
        { id: 'FP1', channel: 'FP1', reference: 'FP2', color: 'red' },
        { id: 'FP2', channel: 'FP2', reference: null, color: null },
        { id: 'FP3', channel: 'FP3', reference: null, color: null },
      ]);
    });

    it('editing a reference/color shows the unsaved-changes asterisk', async () => {
      render(<EegMontageEditor {...defaultProps} />);
      await userEvent.selectOptions(screen.getByTestId('reference-FP1'), 'FP2');
      expect(screen.getByText('Montage Editor *')).toBeTruthy();
    });

    it('highlights a row in alert styling when its channel is marked bad', () => {
      // CHANNEL_SETTINGS marks FP2 bad; FP1/FP3 are not.
      render(<EegMontageEditor {...defaultProps} />);
      expect(screen.getByTestId('reference-FP2').closest('div').className).toContain('bg-alert');
      expect(screen.getByTestId('reference-FP1').closest('div').className).not.toContain(
        'bg-alert'
      );
    });

    it('un-marking a channel as bad removes the row highlight', async () => {
      render(<EegMontageEditor {...defaultProps} />);
      await userEvent.click(screen.getByTestId('channel-bad-FP2'));
      expect(screen.getByTestId('reference-FP2').closest('div').className).not.toContain(
        'bg-alert'
      );
    });

    it('highlights a row whose reference channel is marked bad, even if its own channel is fine', async () => {
      render(<EegMontageEditor {...defaultProps} />);
      // FP1 isn't bad, but referencing bad FP2 should still flag FP1's row.
      await userEvent.selectOptions(screen.getByTestId('reference-FP1'), 'FP2');
      expect(screen.getByTestId('reference-FP1').closest('div').className).toContain('bg-alert');
    });

    it('colors only the channel name text-alert when the channel itself is bad, not the reference select', () => {
      // CHANNEL_SETTINGS marks FP2 bad; its reference is unset (not bad).
      render(<EegMontageEditor {...defaultProps} />);
      expect(screen.getByTestId('montage-channel-FP2').className).toContain('text-alert');
      expect(screen.getByTestId('reference-FP2').className).not.toContain('text-alert');
    });

    it('colors only the reference select text-alert when the reference channel is bad, not the channel name', async () => {
      render(<EegMontageEditor {...defaultProps} />);
      // FP1 isn't bad, but referencing bad FP2 should flag only the reference select.
      await userEvent.selectOptions(screen.getByTestId('reference-FP1'), 'FP2');
      expect(screen.getByTestId('reference-FP1').className).toContain('text-alert');
      expect(screen.getByTestId('montage-channel-FP1').className).not.toContain('text-alert');
    });

    it('colors both the channel name and reference select text-alert when both are bad', async () => {
      render(<EegMontageEditor {...defaultProps} />);
      await userEvent.click(screen.getByTestId('channel-bad-FP1'));
      await userEvent.selectOptions(screen.getByTestId('reference-FP1'), 'FP2');
      expect(screen.getByTestId('montage-channel-FP1').className).toContain('text-alert');
      expect(screen.getByTestId('reference-FP1').className).toContain('text-alert');
    });
  });

  describe('montage row color', () => {
    it("defaults the color select to 'Default' (not White/Black) regardless of theme", () => {
      render(<EegMontageEditor {...defaultProps} />);
      const select = screen.getByTestId('color-FP1');
      expect(select).toHaveValue('');
      const defaultOption = Array.from(select.options).find((o) => o.value === '');
      expect(defaultOption.textContent).toBe('Default');
    });

    it('selecting Default after picking a color commits color: null, not a literal white/black value', async () => {
      const onApplyMontageChannels = vi.fn();
      render(
        <EegMontageEditor {...defaultProps} onApplyMontageChannels={onApplyMontageChannels} />
      );
      await userEvent.selectOptions(screen.getByTestId('color-FP1'), 'red');
      await userEvent.selectOptions(screen.getByTestId('color-FP1'), '');
      await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

      expect(onApplyMontageChannels).toHaveBeenCalledWith([
        { id: 'FP1', channel: 'FP1', reference: null, color: null },
        { id: 'FP2', channel: 'FP2', reference: null, color: null },
        { id: 'FP3', channel: 'FP3', reference: null, color: null },
      ]);
    });

    it("tints (not fully saturates) a montage row's background with its selected color", async () => {
      render(<EegMontageEditor {...defaultProps} />);
      await userEvent.selectOptions(screen.getByTestId('color-FP1'), 'red');
      const background = screen.getByTestId('reference-FP1').closest('div').style.backgroundColor;
      // isDarkMode: false in this file's mock → the 20% (light-mode) tint strength
      expect(background).toContain('color-mix');
      expect(background).toContain('red');
      expect(background).toContain('40%');
    });

    it('leaves a default-colored (unset) row background untouched', () => {
      render(<EegMontageEditor {...defaultProps} />);
      expect(screen.getByTestId('reference-FP1').closest('div').style.backgroundColor).toBe('');
    });

    it('lets the bad-row bg-alert highlight override a selected color', async () => {
      // FP2 is bad per CHANNEL_SETTINGS
      render(<EegMontageEditor {...defaultProps} />);
      await userEvent.selectOptions(screen.getByTestId('color-FP2'), 'red');
      const row = screen.getByTestId('reference-FP2').closest('div');
      expect(row.style.backgroundColor).toBe('');
      expect(row.className).toContain('bg-alert');
    });
  });

  describe('montage row type', () => {
    it('renders a Type column header in the montage settings pane', () => {
      render(<EegMontageEditor {...defaultProps} />);
      // "Type" already labels the channel-selection pane's column; the montage pane now
      // has its own, so the text appears twice.
      expect(screen.getAllByText('Type').length).toBeGreaterThan(1);
    });

    it("displays a newly added row's type (as its friendly label), read from live channelSettings", async () => {
      const { container } = render(<EegMontageEditor {...defaultProps} montageChannels={[]} />);
      await userEvent.click(screen.getByTestId('channel-select-FP3'));
      await userEvent.click(screen.getByTestId('add-selected-button'));

      // FP3 is 'seeg' per CHANNEL_SETTINGS — displayed via TYPE_LIST as 'SEEG'.
      const typeSpan = container.querySelector('[data-testid^="montage-type-"]');
      expect(typeSpan.textContent).toBe('SEEG');
    });

    it("updates a row's displayed type when the channel's type is changed afterward, instead of freezing it", async () => {
      // MONTAGE_CHANNELS seeds id === channel; FP1 starts 'eeg' per CHANNEL_SETTINGS.
      render(<EegMontageEditor {...defaultProps} />);
      expect(screen.getByTestId('montage-type-FP1').textContent).toBe('EEG');

      await userEvent.selectOptions(screen.getByTestId('channel-type-FP1'), 'seeg');

      expect(screen.getByTestId('montage-type-FP1').textContent).toBe('SEEG');
    });

    it('does not add a type field to the committed montage row — type is derived, not stored', async () => {
      const onApplyMontageChannels = vi.fn();
      render(
        <EegMontageEditor
          {...defaultProps}
          montageChannels={[]}
          onApplyMontageChannels={onApplyMontageChannels}
        />
      );
      await userEvent.click(screen.getByTestId('add-all-button'));
      await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

      const committed = onApplyMontageChannels.mock.calls[0][0];
      expect(committed.every((row) => !('type' in row))).toBe(true);
    });
  });

  describe('reordering montage rows', () => {
    it('renders Move Up, Move Down, Sort by Name, and Sort by Type controls', () => {
      render(<EegMontageEditor {...defaultProps} />);
      expect(screen.getByTestId('move-up-button')).toBeTruthy();
      expect(screen.getByTestId('move-down-button')).toBeTruthy();
      expect(screen.getByTestId('sort-by-name-button')).toBeTruthy();
      expect(screen.getByTestId('sort-by-type-button')).toBeTruthy();
    });

    it('disables Move Up/Down until a row is selected', () => {
      render(<EegMontageEditor {...defaultProps} />);
      expect(screen.getByTestId('move-up-button')).toBeDisabled();
      expect(screen.getByTestId('move-down-button')).toBeDisabled();
    });

    it('clicking a row’s channel name selects it, enabling Move Up/Down', async () => {
      render(<EegMontageEditor {...defaultProps} />);
      await userEvent.click(screen.getByTestId('montage-channel-FP2'));
      expect(screen.getByTestId('move-up-button')).not.toBeDisabled();
      expect(screen.getByTestId('move-down-button')).not.toBeDisabled();
    });

    it('clicking a selected row’s channel name again deselects it', async () => {
      render(<EegMontageEditor {...defaultProps} />);
      await userEvent.click(screen.getByTestId('montage-channel-FP2'));
      await userEvent.click(screen.getByTestId('montage-channel-FP2'));
      expect(screen.getByTestId('move-up-button')).toBeDisabled();
    });

    it('Move Up swaps the selected row with its predecessor', async () => {
      const onApplyMontageChannels = vi.fn();
      render(
        <EegMontageEditor {...defaultProps} onApplyMontageChannels={onApplyMontageChannels} />
      );
      await userEvent.click(screen.getByTestId('montage-channel-FP2'));
      await userEvent.click(screen.getByTestId('move-up-button'));
      await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

      const committed = onApplyMontageChannels.mock.calls[0][0];
      expect(committed.map((row) => row.channel)).toEqual(['FP2', 'FP1', 'FP3']);
    });

    it('Move Up is a no-op when the selected row is already first', async () => {
      const onApplyMontageChannels = vi.fn();
      render(
        <EegMontageEditor {...defaultProps} onApplyMontageChannels={onApplyMontageChannels} />
      );
      await userEvent.click(screen.getByTestId('montage-channel-FP1'));
      await userEvent.click(screen.getByTestId('move-up-button'));
      await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

      const committed = onApplyMontageChannels.mock.calls[0][0];
      expect(committed.map((row) => row.channel)).toEqual(['FP1', 'FP2', 'FP3']);
    });

    it('Move Down swaps the selected row with its successor', async () => {
      const onApplyMontageChannels = vi.fn();
      render(
        <EegMontageEditor {...defaultProps} onApplyMontageChannels={onApplyMontageChannels} />
      );
      await userEvent.click(screen.getByTestId('montage-channel-FP2'));
      await userEvent.click(screen.getByTestId('move-down-button'));
      await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

      const committed = onApplyMontageChannels.mock.calls[0][0];
      expect(committed.map((row) => row.channel)).toEqual(['FP1', 'FP3', 'FP2']);
    });

    it('Move Down is a no-op when the selected row is already last', async () => {
      const onApplyMontageChannels = vi.fn();
      render(
        <EegMontageEditor {...defaultProps} onApplyMontageChannels={onApplyMontageChannels} />
      );
      await userEvent.click(screen.getByTestId('montage-channel-FP3'));
      await userEvent.click(screen.getByTestId('move-down-button'));
      await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

      const committed = onApplyMontageChannels.mock.calls[0][0];
      expect(committed.map((row) => row.channel)).toEqual(['FP1', 'FP2', 'FP3']);
    });

    it('moving several selected rows up preserves their relative order to each other', async () => {
      // Two rows share channel FP1 — distinguished by id, not channel name, since a
      // channel can have several montage rows.
      const FOUR_ROWS = [
        { id: 'r1', channel: 'FP1', reference: null, color: null },
        { id: 'r2', channel: 'FP2', reference: null, color: null },
        { id: 'r3', channel: 'FP3', reference: null, color: null },
        { id: 'r4', channel: 'FP1', reference: null, color: null },
      ];
      const onApplyMontageChannels = vi.fn();
      render(
        <EegMontageEditor
          {...defaultProps}
          montageChannels={FOUR_ROWS}
          onApplyMontageChannels={onApplyMontageChannels}
        />
      );
      await userEvent.click(screen.getByTestId('montage-channel-r2'));
      await userEvent.click(screen.getByTestId('montage-channel-r4'));
      await userEvent.click(screen.getByTestId('move-up-button'));
      await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

      const committed = onApplyMontageChannels.mock.calls[0][0];
      expect(committed.map((row) => row.id)).toEqual(['r2', 'r1', 'r4', 'r3']);
    });

    it('removing a selected row also drops it from the selection', async () => {
      render(<EegMontageEditor {...defaultProps} />);
      await userEvent.click(screen.getByTestId('montage-channel-FP2'));
      expect(screen.getByTestId('move-up-button')).not.toBeDisabled();

      await userEvent.click(screen.getByTestId('remove-row-FP2'));
      expect(screen.getByTestId('move-up-button')).toBeDisabled();
    });

    it('Sort by Name reorders rows alphabetically by channel name', async () => {
      const SCRAMBLED = [
        { id: 'a', channel: 'FP3', reference: null, color: null },
        { id: 'b', channel: 'FP1', reference: null, color: null },
        { id: 'c', channel: 'FP2', reference: null, color: null },
      ];
      const onApplyMontageChannels = vi.fn();
      render(
        <EegMontageEditor
          {...defaultProps}
          montageChannels={SCRAMBLED}
          onApplyMontageChannels={onApplyMontageChannels}
        />
      );
      await userEvent.click(screen.getByTestId('sort-by-name-button'));
      await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

      const committed = onApplyMontageChannels.mock.calls[0][0];
      expect(committed.map((row) => row.channel)).toEqual(['FP1', 'FP2', 'FP3']);
    });

    it('Sort by Type groups rows by channel type (eeg, seeg, other), then alphabetically within each group', async () => {
      // FP1 is 'seeg' here (unlike the shared CHANNEL_SETTINGS fixture) so type-order and
      // name-order genuinely diverge, proving this isn't just an alphabetical sort in disguise.
      const CUSTOM_SETTINGS = {
        FP1: { type: 'seeg', bad: false },
        FP2: { type: 'eeg', bad: false },
        FP3: { type: 'eeg', bad: false },
      };
      const onApplyMontageChannels = vi.fn();
      render(
        <EegMontageEditor
          {...defaultProps}
          channelSettings={CUSTOM_SETTINGS}
          onApplyMontageChannels={onApplyMontageChannels}
        />
      );
      await userEvent.click(screen.getByTestId('sort-by-type-button'));
      await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

      const committed = onApplyMontageChannels.mock.calls[0][0];
      expect(committed.map((row) => row.channel)).toEqual(['FP2', 'FP3', 'FP1']);
    });

    it('reordering rows shows the unsaved-changes asterisk', async () => {
      render(<EegMontageEditor {...defaultProps} />);
      await userEvent.click(screen.getByTestId('montage-channel-FP2'));
      await userEvent.click(screen.getByTestId('move-up-button'));
      expect(screen.getByText('Montage Editor *')).toBeTruthy();
    });

    it('clicking Sort by Name a second time reverses to descending order', async () => {
      const onApplyMontageChannels = vi.fn();
      render(
        <EegMontageEditor {...defaultProps} onApplyMontageChannels={onApplyMontageChannels} />
      );
      await userEvent.click(screen.getByTestId('sort-by-name-button')); // ascending
      await userEvent.click(screen.getByTestId('sort-by-name-button')); // descending
      await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

      const committed = onApplyMontageChannels.mock.calls[0][0];
      expect(committed.map((row) => row.channel)).toEqual(['FP3', 'FP2', 'FP1']);
    });

    it('clicking Sort by Type a second time reverses the group order (and the alphabetical tiebreaker)', async () => {
      const CUSTOM_SETTINGS = {
        FP1: { type: 'seeg', bad: false },
        FP2: { type: 'eeg', bad: false },
        FP3: { type: 'eeg', bad: false },
      };
      const onApplyMontageChannels = vi.fn();
      render(
        <EegMontageEditor
          {...defaultProps}
          channelSettings={CUSTOM_SETTINGS}
          onApplyMontageChannels={onApplyMontageChannels}
        />
      );
      await userEvent.click(screen.getByTestId('sort-by-type-button')); // ascending: FP2,FP3,FP1
      await userEvent.click(screen.getByTestId('sort-by-type-button')); // descending
      await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

      const committed = onApplyMontageChannels.mock.calls[0][0];
      expect(committed.map((row) => row.channel)).toEqual(['FP1', 'FP3', 'FP2']);
    });

    it('clicking empty space in the montage row list clears the row selection', async () => {
      render(<EegMontageEditor {...defaultProps} />);
      await userEvent.click(screen.getByTestId('montage-channel-FP2'));
      expect(screen.getByTestId('move-up-button')).not.toBeDisabled();

      await userEvent.click(screen.getByTestId('montage-row-list'));
      expect(screen.getByTestId('move-up-button')).toBeDisabled();
    });

    it('clicking a row does not bubble up and immediately clear its own selection', async () => {
      render(<EegMontageEditor {...defaultProps} />);
      await userEvent.click(screen.getByTestId('montage-channel-FP2'));
      expect(screen.getByTestId('move-up-button')).not.toBeDisabled();
    });

    it("clicking a row's type cell selects the row, same as its channel name", async () => {
      render(<EegMontageEditor {...defaultProps} />);
      await userEvent.click(screen.getByTestId('montage-type-FP2'));
      expect(screen.getByTestId('move-up-button')).not.toBeDisabled();

      await userEvent.click(screen.getByTestId('montage-type-FP2'));
      expect(screen.getByTestId('move-up-button')).toBeDisabled();
    });

    it("clicking a row's Reference select does not change the row selection", async () => {
      render(<EegMontageEditor {...defaultProps} />);
      await userEvent.click(screen.getByTestId('reference-FP2'));
      expect(screen.getByTestId('move-up-button')).toBeDisabled();
    });

    it("clicking a row's Color select does not change the row selection", async () => {
      render(<EegMontageEditor {...defaultProps} />);
      await userEvent.click(screen.getByTestId('color-FP2'));
      expect(screen.getByTestId('move-up-button')).toBeDisabled();
    });

    it("clicking a selected row's remove button removes it without re-toggling the selection", async () => {
      const onApplyMontageChannels = vi.fn();
      render(
        <EegMontageEditor {...defaultProps} onApplyMontageChannels={onApplyMontageChannels} />
      );
      await userEvent.click(screen.getByTestId('montage-channel-FP1'));
      await userEvent.click(screen.getByTestId('remove-row-FP2'));
      await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

      // FP2 is gone, and FP1 stays selected (so Move Up/Down remain enabled).
      const committed = onApplyMontageChannels.mock.calls[0][0];
      expect(committed.map((row) => row.channel)).toEqual(['FP1', 'FP3']);
      expect(screen.getByTestId('move-up-button')).not.toBeDisabled();
    });
  });

  describe('clicking empty space clears selections', () => {
    it('clicking empty space in the channel list clears the channel selection', async () => {
      render(<EegMontageEditor {...defaultProps} montageChannels={[]} />);
      await userEvent.click(screen.getByTestId('channel-select-FP1'));
      expect(screen.getByTestId('add-selected-button')).not.toBeDisabled();

      await userEvent.click(screen.getByTestId('channel-list'));
      expect(screen.getByTestId('add-selected-button')).toBeDisabled();
    });

    it('clicking a channel row itself does not also clear the selection it just set', async () => {
      render(<EegMontageEditor {...defaultProps} montageChannels={[]} />);
      await userEvent.click(screen.getByTestId('channel-select-FP1'));
      expect(screen.getByTestId('add-selected-button')).not.toBeDisabled();
    });

    it('clicking empty space in the montage add-row controls column clears the montage row selection', async () => {
      render(<EegMontageEditor {...defaultProps} />);
      await userEvent.click(screen.getByTestId('montage-channel-FP2'));
      expect(screen.getByTestId('move-up-button')).not.toBeDisabled();

      await userEvent.click(screen.getByTestId('add-all-button').parentElement.parentElement);
      expect(screen.getByTestId('move-up-button')).toBeDisabled();
    });

    it('clicking a Move Up/Down button does not clear the montage row selection it needs to act on', async () => {
      const onApplyMontageChannels = vi.fn();
      render(
        <EegMontageEditor {...defaultProps} onApplyMontageChannels={onApplyMontageChannels} />
      );
      await userEvent.click(screen.getByTestId('montage-channel-FP2'));
      await userEvent.click(screen.getByTestId('move-up-button'));
      // A second Move Up on the still-selected row proves the selection survived the first click.
      await userEvent.click(screen.getByTestId('move-up-button'));
      await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

      const committed = onApplyMontageChannels.mock.calls[0][0];
      expect(committed.map((row) => row.channel)).toEqual(['FP2', 'FP1', 'FP3']);
    });
  });

  describe('building montage rows from channel selection', () => {
    it('shows a placeholder message when there are no montage rows yet', () => {
      render(<EegMontageEditor {...defaultProps} montageChannels={[]} />);
      expect(screen.getByText(/No montage rows yet/i)).toBeTruthy();
    });

    it('disables "+ Add selected" until a channel is selected', () => {
      render(<EegMontageEditor {...defaultProps} montageChannels={[]} />);
      expect(screen.getByTestId('add-selected-button')).toBeDisabled();
    });

    it('clicking a channel name toggles it selected, enabling "+ Add selected"', async () => {
      render(<EegMontageEditor {...defaultProps} montageChannels={[]} />);
      await userEvent.click(screen.getByTestId('channel-select-FP1'));
      expect(screen.getByTestId('add-selected-button')).not.toBeDisabled();
    });

    it('clicking a selected channel name again deselects it', async () => {
      render(<EegMontageEditor {...defaultProps} montageChannels={[]} />);
      await userEvent.click(screen.getByTestId('channel-select-FP1'));
      await userEvent.click(screen.getByTestId('channel-select-FP1'));
      expect(screen.getByTestId('add-selected-button')).toBeDisabled();
    });

    it('"+ Add selected" adds one montage row per selected channel and clears the selection', async () => {
      const onApplyMontageChannels = vi.fn();
      render(
        <EegMontageEditor
          {...defaultProps}
          montageChannels={[]}
          onApplyMontageChannels={onApplyMontageChannels}
        />
      );
      await userEvent.click(screen.getByTestId('channel-select-FP1'));
      await userEvent.click(screen.getByTestId('channel-select-FP2'));
      await userEvent.click(screen.getByTestId('add-selected-button'));

      expect(screen.getByTestId('add-selected-button')).toBeDisabled(); // selection cleared

      await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
      const committed = onApplyMontageChannels.mock.calls[0][0];
      expect(committed.map((row) => row.channel).sort()).toEqual(['FP1', 'FP2']);
      expect(committed.every((row) => row.reference === null && row.color === null)).toBe(true);
    });

    it('allows adding a second row for a channel that already has one, each with a unique id', async () => {
      const onApplyMontageChannels = vi.fn();
      render(
        <EegMontageEditor {...defaultProps} onApplyMontageChannels={onApplyMontageChannels} />
      );
      await userEvent.click(screen.getByTestId('channel-select-FP1'));
      await userEvent.click(screen.getByTestId('add-selected-button'));
      await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

      const committed = onApplyMontageChannels.mock.calls[0][0];
      expect(committed.filter((row) => row.channel === 'FP1')).toHaveLength(2);
      expect(new Set(committed.map((row) => row.id)).size).toBe(committed.length);
    });

    it('"Add all" adds a row for every channel, regardless of selection', async () => {
      const onApplyMontageChannels = vi.fn();
      render(
        <EegMontageEditor
          {...defaultProps}
          montageChannels={[]}
          onApplyMontageChannels={onApplyMontageChannels}
        />
      );
      await userEvent.click(screen.getByTestId('add-all-button'));
      await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

      const committed = onApplyMontageChannels.mock.calls[0][0];
      expect(committed.map((row) => row.channel)).toEqual(CHANNEL_NAMES);
      expect(committed.every((row) => row.reference === null && row.color === null)).toBe(true);
    });

    it('"Add all" adds a row for every channel even when some already have one', async () => {
      const onApplyMontageChannels = vi.fn();
      render(
        // MONTAGE_CHANNELS already seeds one row per channel.
        <EegMontageEditor {...defaultProps} onApplyMontageChannels={onApplyMontageChannels} />
      );
      await userEvent.click(screen.getByTestId('add-all-button'));
      await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

      const committed = onApplyMontageChannels.mock.calls[0][0];
      CHANNEL_NAMES.forEach((name) => {
        expect(committed.filter((row) => row.channel === name)).toHaveLength(2);
      });
      expect(new Set(committed.map((row) => row.id)).size).toBe(committed.length);
    });

    it('"Add all" does not touch the current channel selection', async () => {
      render(<EegMontageEditor {...defaultProps} montageChannels={[]} />);
      await userEvent.click(screen.getByTestId('channel-select-FP1'));
      await userEvent.click(screen.getByTestId('add-all-button'));
      expect(screen.getByTestId('add-selected-button')).not.toBeDisabled();
    });

    it('adding all rows shows the unsaved-changes asterisk', async () => {
      render(<EegMontageEditor {...defaultProps} montageChannels={[]} />);
      await userEvent.click(screen.getByTestId('add-all-button'));
      expect(screen.getByText('Montage Editor *')).toBeTruthy();
    });

    it('"Add by type" adds a row for every channel currently of the picked type', async () => {
      const onApplyMontageChannels = vi.fn();
      render(
        <EegMontageEditor
          {...defaultProps}
          montageChannels={[]}
          onApplyMontageChannels={onApplyMontageChannels}
        />
      );
      // CHANNEL_SETTINGS: FP1/FP2 are 'eeg', FP3 is 'seeg'.
      await userEvent.selectOptions(screen.getByTestId('add-by-type-select'), 'seeg');
      await userEvent.click(screen.getByTestId('add-by-type-button'));
      await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

      const committed = onApplyMontageChannels.mock.calls[0][0];
      expect(committed.map((row) => row.channel)).toEqual(['FP3']);
    });

    it('adding a row shows the unsaved-changes asterisk', async () => {
      render(<EegMontageEditor {...defaultProps} montageChannels={[]} />);
      await userEvent.click(screen.getByTestId('channel-select-FP1'));
      await userEvent.click(screen.getByTestId('add-selected-button'));
      expect(screen.getByText('Montage Editor *')).toBeTruthy();
    });
  });

  describe('removing montage rows', () => {
    it('disables "Clear all" when there are no montage rows', () => {
      render(<EegMontageEditor {...defaultProps} montageChannels={[]} />);
      expect(screen.getByTestId('clear-all-button')).toBeDisabled();
    });

    it('"Clear all" removes every montage row', async () => {
      const onApplyMontageChannels = vi.fn();
      render(
        <EegMontageEditor {...defaultProps} onApplyMontageChannels={onApplyMontageChannels} />
      );
      await userEvent.click(screen.getByTestId('clear-all-button'));
      await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

      expect(onApplyMontageChannels).toHaveBeenCalledWith([]);
    });

    it("clicking a row's remove button removes only that row", async () => {
      const onApplyMontageChannels = vi.fn();
      render(
        <EegMontageEditor {...defaultProps} onApplyMontageChannels={onApplyMontageChannels} />
      );
      await userEvent.click(screen.getByTestId('remove-row-FP1'));
      await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

      const committed = onApplyMontageChannels.mock.calls[0][0];
      expect(committed.map((row) => row.channel)).toEqual(['FP2', 'FP3']);
    });

    it('removing a row shows the unsaved-changes asterisk', async () => {
      render(<EegMontageEditor {...defaultProps} />);
      await userEvent.click(screen.getByTestId('remove-row-FP1'));
      expect(screen.getByText('Montage Editor *')).toBeTruthy();
    });
  });

  describe('rows referencing a channel not present in this recording', () => {
    // Only reachable via a loaded montage file naming a channel this recording doesn't
    // have — the editor's own row-building controls can never produce this.
    it("greys out the row and disables Reference/Color when the row's own channel is missing", () => {
      const montageChannels = [{ id: 'row-1', channel: 'GHOST', reference: null, color: null }];
      render(<EegMontageEditor {...defaultProps} montageChannels={montageChannels} />);

      const name = screen.getByTestId('montage-channel-row-1');
      expect(name.className).toContain('text-red-500');
      expect(name.title).toBe('Channel not found in this recording');
      expect(name.closest('div').className).toContain('opacity-50');
      expect(screen.getByTestId('reference-row-1')).toBeDisabled();
      expect(screen.getByTestId('color-row-1')).toBeDisabled();
    });

    it('shows "—" for a missing channel\'s type instead of a misleading default', () => {
      const montageChannels = [{ id: 'row-1', channel: 'GHOST', reference: null, color: null }];
      render(<EegMontageEditor {...defaultProps} montageChannels={montageChannels} />);
      expect(screen.getByTestId('montage-type-row-1').textContent).toBe('—');
    });

    it('still lets Remove work on a row with a missing channel', async () => {
      const onApplyMontageChannels = vi.fn();
      const montageChannels = [{ id: 'row-1', channel: 'GHOST', reference: null, color: null }];
      render(
        <EegMontageEditor
          {...defaultProps}
          montageChannels={montageChannels}
          onApplyMontageChannels={onApplyMontageChannels}
        />
      );
      await userEvent.click(screen.getByTestId('remove-row-row-1'));
      await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
      expect(onApplyMontageChannels).toHaveBeenCalledWith([]);
    });

    it('keeps a row interactive (not greyed/disabled) when only its reference is missing, injecting a labeled option instead of falling back to blank', () => {
      const montageChannels = [{ id: 'row-1', channel: 'FP1', reference: 'GHOST', color: null }];
      render(<EegMontageEditor {...defaultProps} montageChannels={montageChannels} />);

      const name = screen.getByTestId('montage-channel-row-1');
      expect(name.className).not.toContain('text-red-500');
      expect(name.closest('div').className).not.toContain('opacity-50');

      const referenceSelect = screen.getByTestId('reference-row-1');
      expect(referenceSelect).not.toBeDisabled();
      expect(referenceSelect).toHaveValue('GHOST');
      expect(referenceSelect.className).toContain('text-red-500');
      expect(referenceSelect.title).toBe('Reference channel not found in this recording');
      const injectedOption = Array.from(referenceSelect.options).find((o) => o.value === 'GHOST');
      expect(injectedOption.textContent).toBe('GHOST (missing)');
      expect(screen.getByTestId('color-row-1')).not.toBeDisabled();
    });

    it('shows a tooltip on a bad (not missing) channel name and reference too', () => {
      // FP2 is bad per CHANNEL_SETTINGS; FP1 is a valid reference so only badness applies.
      const montageChannels = [{ id: 'row-1', channel: 'FP2', reference: 'FP1', color: null }];
      const channelSettings = {
        ...CHANNEL_SETTINGS,
        FP1: { type: 'eeg', bad: true },
      };
      render(
        <EegMontageEditor
          {...defaultProps}
          channelSettings={channelSettings}
          montageChannels={montageChannels}
        />
      );
      expect(screen.getByTestId('montage-channel-row-1').title).toBe('Channel marked as bad');
      expect(screen.getByTestId('reference-row-1').title).toBe('Reference channel marked bad');
    });
  });

  describe('add-row controls flip when the panes are swapped', () => {
    it('sit on the left (order-1) by default', () => {
      render(<EegMontageEditor {...defaultProps} />);
      const controls = screen.getByTestId('add-selected-button').parentElement;
      expect(controls.className).toContain('order-1');
      expect(controls.className).not.toContain('order-2');
    });

    it('flip to the right (order-2) once the panes are swapped', async () => {
      render(<EegMontageEditor {...defaultProps} />);
      await userEvent.click(screen.getAllByTitle('Swap panels')[0]);
      const controls = screen.getByTestId('add-selected-button').parentElement;
      expect(controls.className).toContain('order-2');
      expect(controls.className).not.toContain('order-1');
    });
  });

  describe('Load / Save montage', () => {
    const ANYWAVE_FILE_TEXT = `<!DOCTYPE AnyWaveMontage>
<Montage>
	<Channel name="FP1">
		<type>SEEG</type>
		<reference></reference>
		<color>darkblue</color>
	</Channel>
	<Channel name="FP2">
		<type>EEG</type>
		<reference>FP1</reference>
		<color></color>
	</Channel>
</Montage>`;

    const CARTOOL_FILE_TEXT = 'MT01\nFP1\tFP2\nFP2\tFP3\n';

    beforeEach(() => {
      toast.error.mockClear();
      downloadTextFile.mockClear();
    });

    it('renders Load and Save buttons', () => {
      render(<EegMontageEditor {...defaultProps} />);
      expect(screen.getByRole('button', { name: 'Load' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
    });

    it('disables Save when there are no montage rows', () => {
      render(<EegMontageEditor {...defaultProps} montageChannels={[]} />);
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    });

    it('enables Save when there are montage rows', () => {
      render(<EegMontageEditor {...defaultProps} />);
      expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled();
    });

    it('loading a valid AnyWave file replaces the montage rows and updates channel types', async () => {
      render(<EegMontageEditor {...defaultProps} />);
      const file = new File([ANYWAVE_FILE_TEXT], 'custom.mtg');
      await userEvent.upload(screen.getByTestId('montage-file-input'), file);

      // Row list is now exactly the 2 rows from the file, replacing the original 3.
      expect(screen.queryByTestId('montage-channel-FP3')).toBeNull();
      const rows = screen.getAllByTestId(/^montage-channel-/);
      expect(rows.map((r) => r.textContent)).toEqual(['FP1', 'FP2']);

      // FP1's type was updated to SEEG in the channel-selection pane.
      expect(screen.getByTestId('channel-type-FP1')).toHaveValue('seeg');
      // Loaded rows get freshly-generated ids (not the channel name), so reference selects
      // are matched by list order (FP1, then FP2) rather than a `reference-FP2` testid.
      // FP1 is referential (no reference); FP2's row is now bipolar against FP1.
      const referenceSelects = screen.getAllByTestId(/^reference-/);
      expect(referenceSelects.map((s) => s.value)).toEqual(['', 'FP1']);
      expect(toast.error).not.toHaveBeenCalled();
    });

    it('loading a valid Cartool file replaces the montage rows and leaves channel types untouched', async () => {
      render(<EegMontageEditor {...defaultProps} />);
      const file = new File([CARTOOL_FILE_TEXT], 'custom.mtg');
      await userEvent.upload(screen.getByTestId('montage-file-input'), file);

      const rows = screen.getAllByTestId(/^montage-channel-/);
      expect(rows.map((r) => r.textContent)).toEqual(['FP1', 'FP2']);
      // Both rows are bipolar per the Cartool file's channel/reference pairs.
      const referenceSelects = screen.getAllByTestId(/^reference-/);
      expect(referenceSelects.map((s) => s.value)).toEqual(['FP2', 'FP3']);
      // Channel types are exactly as seeded from CHANNEL_SETTINGS — untouched.
      expect(screen.getByTestId('channel-type-FP1')).toHaveValue('eeg');
      expect(toast.error).not.toHaveBeenCalled();
    });

    it('loading invalid content shows a toast error and leaves the draft unchanged', async () => {
      render(<EegMontageEditor {...defaultProps} />);
      const file = new File(['this is not a montage file'], 'bad.mtg');
      await userEvent.upload(screen.getByTestId('montage-file-input'), file);

      expect(toast.error).toHaveBeenCalledTimes(1);
      // Original 3 rows and channel types are untouched.
      const rows = screen.getAllByTestId(/^montage-channel-/);
      expect(rows.map((r) => r.textContent)).toEqual(['FP1', 'FP2', 'FP3']);
      expect(screen.getByTestId('channel-type-FP1')).toHaveValue('eeg');
    });

    it('clicking Save downloads the current draft as AnyWave XML named montage.mtg', async () => {
      render(<EegMontageEditor {...defaultProps} />);
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));

      expect(downloadTextFile).toHaveBeenCalledTimes(1);
      const [xml, filename] = downloadTextFile.mock.calls[0];
      expect(filename).toBe('montage.mtg');
      expect(xml).toContain('<Channel name="FP1">');
      expect(xml).toContain('<Channel name="FP2">');
      expect(xml).toContain('<Channel name="FP3">');
    });

    it("a row with a non-preset color (e.g. an AnyWave import's 'darkblue') renders as the select's actual selected value", async () => {
      const montageChannels = [{ id: 'FP1', channel: 'FP1', reference: null, color: 'darkblue' }];
      render(<EegMontageEditor {...defaultProps} montageChannels={montageChannels} />);
      const select = screen.getByTestId('color-FP1');
      expect(select).toHaveValue('darkblue');
      const injectedOption = Array.from(select.options).find((o) => o.value === 'darkblue');
      expect(injectedOption).toBeTruthy();
    });
  });
});
