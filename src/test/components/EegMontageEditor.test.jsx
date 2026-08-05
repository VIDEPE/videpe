import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EegMontageEditor } from '@/components/EegMontageEditor';

vi.mock('@/components/ThemeContext', () => ({
  useTheme: () => ({ isDarkMode: false }),
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
    // "Channel" is the first column header in both panes.
    render(<EegMontageEditor {...defaultProps} />);
    expect(screen.getAllByText('Channel').length).toBeGreaterThan(0);
    expect(screen.getByText('Pos')).toBeTruthy();
    expect(screen.getByText('Type')).toBeTruthy();
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

  describe('Check all Bad / Check all Good', () => {
    const ALL_BAD_SETTINGS = {
      FP1: { type: 'eeg', bad: true },
      FP2: { type: 'eeg', bad: true },
      FP3: { type: 'seeg', bad: true },
    };

    it('shows "Check all Bad" when not every channel is already bad', () => {
      render(<EegMontageEditor {...defaultProps} />);
      expect(screen.getByRole('button', { name: 'Check all Bad' })).toBeTruthy();
    });

    it('shows "Check all Good" when every channel is already bad', () => {
      render(<EegMontageEditor {...defaultProps} channelSettings={ALL_BAD_SETTINGS} />);
      expect(screen.getByRole('button', { name: 'Check all Good' })).toBeTruthy();
    });

    it('marks every channel bad when clicked while not all are bad', async () => {
      render(<EegMontageEditor {...defaultProps} />);
      await userEvent.click(screen.getByRole('button', { name: 'Check all Bad' }));

      CHANNEL_NAMES.forEach((name) =>
        expect(screen.getByTestId(`channel-bad-${name}`)).toBeChecked()
      );
      expect(screen.getByRole('button', { name: 'Check all Good' })).toBeTruthy();
    });

    it('marks every channel good when clicked while all are bad', async () => {
      render(<EegMontageEditor {...defaultProps} channelSettings={ALL_BAD_SETTINGS} />);
      await userEvent.click(screen.getByRole('button', { name: 'Check all Good' }));

      CHANNEL_NAMES.forEach((name) =>
        expect(screen.getByTestId(`channel-bad-${name}`)).not.toBeChecked()
      );
      expect(screen.getByRole('button', { name: 'Check all Bad' })).toBeTruthy();
    });

    it('updates the label when a channel is unchecked by hand, not just via the button', async () => {
      render(<EegMontageEditor {...defaultProps} channelSettings={ALL_BAD_SETTINGS} />);
      await userEvent.click(screen.getByTestId('channel-bad-FP1'));
      expect(screen.getByRole('button', { name: 'Check all Bad' })).toBeTruthy();
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
});
