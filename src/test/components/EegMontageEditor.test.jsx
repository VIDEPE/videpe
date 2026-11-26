import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import toast from 'react-hot-toast';
import { downloadTextFile } from '@/utils/fileDownload';
import { EegMontageEditor } from '@/components/EegMontageEditor';

vi.mock('@/hooks/useTheme', () => ({
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

// The colors the Color selects should offer, in order. Written out here instead of imported
// from the component, so a color dropped from the component's list fails these tests.
const PRESET_COLORS = [
  'red',
  'blue',
  'green',
  'yellow',
  'cyan',
  'magenta',
  'crimson',
  'steelblue',
  'seagreen',
  'darkgoldenrod',
  'chocolate',
  'mediumpurple',
];

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

// Global filters per type — shown greyed as placeholders in rows without their own value.
// eeg and seeg differ, and seeg's lowPass is off, so a placeholder from the wrong type fails.
const GLOBAL_FILTERS = {
  eeg: { highPass: 0.5, lowPass: 70, notch: 50, notchHarmonics: false },
  seeg: { highPass: 1, lowPass: null, notch: null, notchHarmonics: false },
  other: { highPass: null, lowPass: null, notch: null, notchHarmonics: false },
};

const defaultProps = {
  globalFilters: GLOBAL_FILTERS,
  channelNames: CHANNEL_NAMES,
  matched: MATCHED,
  channelSettings: CHANNEL_SETTINGS,
  onApplyChannelSettings: vi.fn(),
  montageChannels: MONTAGE_CHANNELS,
  onApplyMontageChannels: vi.fn(),
  onClose: vi.fn(),
  fs: 256, // used to compute nyquist for highPass/lowPass/notch clamping
  standardTemplateLabel: 'Standard 10-20', // always passed by EegViewer — no default
};

describe('EegMontageEditor', () => {
  // Apply/OK confirm the commit via window.confirm when the draft has bad/missing rows (see
  // the "Apply/OK warns about bad or missing montage rows" describe block below) — default to
  // confirming so every other test's Apply/OK clicks behave as before that warning existed.
  beforeEach(() => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    window.confirm.mockRestore();
  });

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
    it('names the matched electrode and the standard template when no file is active', () => {
      render(<EegMontageEditor {...defaultProps} />);
      expect(screen.getByTestId('channel-pos-FP1')).toHaveAttribute(
        'title',
        'Matched to electrode "FP1" in the Standard 10-20 template'
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
        'No match for "FP2" in the Standard 10-20 template'
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

  describe('Apply/OK warns about bad or missing montage rows', () => {
    it('does not prompt when no montage row is bad or missing', async () => {
      const onApplyMontageChannels = vi.fn();
      const montageChannels = [{ id: 'row-1', channel: 'FP1', reference: null, color: null }];
      const channelSettings = { FP1: { type: 'eeg', bad: false } };
      render(
        <EegMontageEditor
          {...defaultProps}
          channelSettings={channelSettings}
          montageChannels={montageChannels}
          onApplyMontageChannels={onApplyMontageChannels}
        />
      );
      await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
      expect(window.confirm).not.toHaveBeenCalled();
      expect(onApplyMontageChannels).toHaveBeenCalled();
    });

    it('prompts for confirmation when a montage row uses a bad channel', async () => {
      // Default montageChannels includes a row for FP2, which CHANNEL_SETTINGS marks bad.
      const onApplyMontageChannels = vi.fn();
      render(
        <EegMontageEditor {...defaultProps} onApplyMontageChannels={onApplyMontageChannels} />
      );
      await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
      expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('FP2'));
      expect(onApplyMontageChannels).toHaveBeenCalled();
    });

    it('prompts for confirmation when a montage row references a missing channel', async () => {
      const onApplyMontageChannels = vi.fn();
      const montageChannels = [{ id: 'row-1', channel: 'FP1', reference: 'GHOST', color: null }];
      render(
        <EegMontageEditor
          {...defaultProps}
          montageChannels={montageChannels}
          onApplyMontageChannels={onApplyMontageChannels}
        />
      );
      await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
      expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('GHOST'));
      expect(onApplyMontageChannels).toHaveBeenCalled();
    });

    it('prompts for confirmation when a montage row is itself a missing channel', async () => {
      const onApplyMontageChannels = vi.fn();
      const montageChannels = [{ id: 'row-1', channel: 'GHOST', reference: null, color: null }];
      render(
        <EegMontageEditor
          {...defaultProps}
          montageChannels={montageChannels}
          onApplyMontageChannels={onApplyMontageChannels}
        />
      );
      await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
      expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('GHOST'));
      expect(onApplyMontageChannels).toHaveBeenCalled();
    });

    it('does not commit when the confirmation is cancelled', async () => {
      window.confirm.mockReturnValue(false);
      const onApplyMontageChannels = vi.fn();
      const onApplyChannelSettings = vi.fn();
      render(
        <EegMontageEditor
          {...defaultProps}
          onApplyMontageChannels={onApplyMontageChannels}
          onApplyChannelSettings={onApplyChannelSettings}
        />
      );
      await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
      expect(onApplyMontageChannels).not.toHaveBeenCalled();
      expect(onApplyChannelSettings).not.toHaveBeenCalled();
    });

    it('does not close the window when OK is cancelled at the confirmation', async () => {
      window.confirm.mockReturnValue(false);
      const onClose = vi.fn();
      const onApplyMontageChannels = vi.fn();
      render(
        <EegMontageEditor
          {...defaultProps}
          onClose={onClose}
          onApplyMontageChannels={onApplyMontageChannels}
        />
      );
      await userEvent.click(screen.getByRole('button', { name: 'OK' }));
      expect(onClose).not.toHaveBeenCalled();
      expect(onApplyMontageChannels).not.toHaveBeenCalled();
    });

    it('closes the window when OK is confirmed', async () => {
      const onClose = vi.fn();
      render(<EegMontageEditor {...defaultProps} onClose={onClose} />);
      await userEvent.click(screen.getByRole('button', { name: 'OK' }));
      expect(window.confirm).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  describe('Bad column header checkbox', () => {
    const ALL_BAD_SETTINGS = {
      FP1: { type: 'eeg', bad: true },
      FP2: { type: 'eeg', bad: true },
      FP3: { type: 'seeg', bad: true },
    };

    it('is unchecked when not every channel is already bad', () => {
      render(<EegMontageEditor {...defaultProps} />);
      expect(screen.getByTestId('bulk-bad-checkbox')).not.toBeChecked();
    });

    it('is checked when every channel is already bad', () => {
      render(<EegMontageEditor {...defaultProps} channelSettings={ALL_BAD_SETTINGS} />);
      expect(screen.getByTestId('bulk-bad-checkbox')).toBeChecked();
    });

    it('marks every channel bad when checked while not all are bad', async () => {
      render(<EegMontageEditor {...defaultProps} />);
      await userEvent.click(screen.getByTestId('bulk-bad-checkbox'));

      CHANNEL_NAMES.forEach((name) =>
        expect(screen.getByTestId(`channel-bad-${name}`)).toBeChecked()
      );
      expect(screen.getByTestId('bulk-bad-checkbox')).toBeChecked();
    });

    it('marks every channel good when unchecked while all are bad', async () => {
      render(<EegMontageEditor {...defaultProps} channelSettings={ALL_BAD_SETTINGS} />);
      await userEvent.click(screen.getByTestId('bulk-bad-checkbox'));

      CHANNEL_NAMES.forEach((name) =>
        expect(screen.getByTestId(`channel-bad-${name}`)).not.toBeChecked()
      );
      expect(screen.getByTestId('bulk-bad-checkbox')).not.toBeChecked();
    });

    it('auto-checks itself when a channel is checked by hand, not just via the checkbox itself', async () => {
      const ALL_BAD_BUT_ONE = { ...ALL_BAD_SETTINGS, FP1: { type: 'eeg', bad: false } };
      render(<EegMontageEditor {...defaultProps} channelSettings={ALL_BAD_BUT_ONE} />);
      expect(screen.getByTestId('bulk-bad-checkbox')).not.toBeChecked();

      await userEvent.click(screen.getByTestId('channel-bad-FP1'));
      expect(screen.getByTestId('bulk-bad-checkbox')).toBeChecked();
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
      await userEvent.click(screen.getByTestId('bulk-type-apply-button'));

      CHANNEL_NAMES.forEach((name) =>
        expect(screen.getByTestId(`channel-type-${name}`)).toHaveValue('seeg')
      );
    });

    it("leaves each channel's bad flag untouched", async () => {
      render(<EegMontageEditor {...defaultProps} />);
      await userEvent.selectOptions(screen.getByTestId('bulk-type-select'), 'other');
      await userEvent.click(screen.getByTestId('bulk-type-apply-button'));

      expect(screen.getByTestId('channel-bad-FP2')).toBeChecked();
      expect(screen.getByTestId('channel-bad-FP1')).not.toBeChecked();
    });
  });

  describe('Set all as [reference]', () => {
    it('disables the bulk reference button and select when there are no montage rows', () => {
      render(<EegMontageEditor {...defaultProps} montageChannels={[]} />);
      expect(screen.getByTestId('bulk-reference-apply-button')).toBeDisabled();
      expect(screen.getByTestId('bulk-reference-select')).toBeDisabled();
    });

    it('defaults the bulk reference select to n/a', () => {
      render(<EegMontageEditor {...defaultProps} />);
      expect(screen.getByTestId('bulk-reference-select')).toHaveValue('');
    });

    it('offers n/a, average and median above the channel names, in that order', () => {
      render(<EegMontageEditor {...defaultProps} />);
      const options = Array.from(screen.getByTestId('bulk-reference-select').options).map(
        (option) => option.value
      );
      expect(options.slice(0, 3)).toEqual(['', 'average', 'median']);
      CHANNEL_NAMES.forEach((name) => expect(options).toContain(name));
    });

    it('sets every montage row to "average" when picked', async () => {
      render(<EegMontageEditor {...defaultProps} />);
      await userEvent.selectOptions(screen.getByTestId('bulk-reference-select'), 'average');
      await userEvent.click(screen.getByTestId('bulk-reference-apply-button'));

      // MONTAGE_CHANNELS seeds id === channel, so these testids double as an id check.
      CHANNEL_NAMES.forEach((name) =>
        expect(screen.getByTestId(`reference-${name}`)).toHaveValue('average')
      );
    });

    it('sets every montage row to "median" when picked', async () => {
      render(<EegMontageEditor {...defaultProps} />);
      await userEvent.selectOptions(screen.getByTestId('bulk-reference-select'), 'median');
      await userEvent.click(screen.getByTestId('bulk-reference-apply-button'));

      CHANNEL_NAMES.forEach((name) =>
        expect(screen.getByTestId(`reference-${name}`)).toHaveValue('median')
      );
    });

    it('clears every row back to n/a when picked after a prior bulk set', async () => {
      render(<EegMontageEditor {...defaultProps} />);
      await userEvent.selectOptions(screen.getByTestId('bulk-reference-select'), 'average');
      await userEvent.click(screen.getByTestId('bulk-reference-apply-button'));

      await userEvent.selectOptions(screen.getByTestId('bulk-reference-select'), '');
      await userEvent.click(screen.getByTestId('bulk-reference-apply-button'));

      CHANNEL_NAMES.forEach((name) =>
        expect(screen.getByTestId(`reference-${name}`)).toHaveValue('')
      );
    });

    it("leaves each row's color untouched", async () => {
      const montageChannels = CHANNEL_NAMES.map((name) => ({
        id: name,
        channel: name,
        reference: null,
        color: 'red',
      }));
      render(<EegMontageEditor {...defaultProps} montageChannels={montageChannels} />);
      await userEvent.selectOptions(screen.getByTestId('bulk-reference-select'), 'median');
      await userEvent.click(screen.getByTestId('bulk-reference-apply-button'));

      CHANNEL_NAMES.forEach((name) =>
        expect(screen.getByTestId(`color-${name}`)).toHaveValue('red')
      );
    });
  });

  describe('Set all as [color]', () => {
    it('disables the bulk color button and select when there are no montage rows', () => {
      render(<EegMontageEditor {...defaultProps} montageChannels={[]} />);
      expect(screen.getByTestId('bulk-color-apply-button')).toBeDisabled();
      expect(screen.getByTestId('bulk-color-select')).toBeDisabled();
    });

    it('defaults the bulk color select to Default', () => {
      render(<EegMontageEditor {...defaultProps} />);
      expect(screen.getByTestId('bulk-color-select')).toHaveValue('');
    });

    it('offers Default followed by the preset colors, in that order', () => {
      render(<EegMontageEditor {...defaultProps} />);
      const options = Array.from(screen.getByTestId('bulk-color-select').options).map(
        (option) => option.value
      );
      expect(options).toEqual(['', ...PRESET_COLORS]);
    });

    it("tints each preset option's text to match the color it applies", () => {
      render(<EegMontageEditor {...defaultProps} />);
      const options = Array.from(screen.getByTestId('bulk-color-select').options);
      const byValue = Object.fromEntries(options.map((option) => [option.value, option]));

      PRESET_COLORS.forEach((color) => expect(byValue[color].style.color).toBe(color));
    });

    it('sets every montage row to "red" when picked', async () => {
      render(<EegMontageEditor {...defaultProps} />);
      await userEvent.selectOptions(screen.getByTestId('bulk-color-select'), 'red');
      await userEvent.click(screen.getByTestId('bulk-color-apply-button'));

      // MONTAGE_CHANNELS seeds id === channel, so these testids double as an id check.
      CHANNEL_NAMES.forEach((name) =>
        expect(screen.getByTestId(`color-${name}`)).toHaveValue('red')
      );
    });

    it('sets every montage row to "cyan" when picked', async () => {
      render(<EegMontageEditor {...defaultProps} />);
      await userEvent.selectOptions(screen.getByTestId('bulk-color-select'), 'cyan');
      await userEvent.click(screen.getByTestId('bulk-color-apply-button'));

      CHANNEL_NAMES.forEach((name) =>
        expect(screen.getByTestId(`color-${name}`)).toHaveValue('cyan')
      );
    });

    it('clears every row back to Default when picked after a prior bulk set', async () => {
      render(<EegMontageEditor {...defaultProps} />);
      await userEvent.selectOptions(screen.getByTestId('bulk-color-select'), 'red');
      await userEvent.click(screen.getByTestId('bulk-color-apply-button'));

      await userEvent.selectOptions(screen.getByTestId('bulk-color-select'), '');
      await userEvent.click(screen.getByTestId('bulk-color-apply-button'));

      CHANNEL_NAMES.forEach((name) => expect(screen.getByTestId(`color-${name}`)).toHaveValue(''));
    });

    it("leaves each row's reference untouched", async () => {
      const montageChannels = CHANNEL_NAMES.map((name) => ({
        id: name,
        channel: name,
        reference: 'average',
        color: null,
      }));
      render(<EegMontageEditor {...defaultProps} montageChannels={montageChannels} />);
      await userEvent.selectOptions(screen.getByTestId('bulk-color-select'), 'blue');
      await userEvent.click(screen.getByTestId('bulk-color-apply-button'));

      CHANNEL_NAMES.forEach((name) =>
        expect(screen.getByTestId(`reference-${name}`)).toHaveValue('average')
      );
    });
  });

  describe('Set all Filters (inline per-column headers)', () => {
    it('disables the bulk filter inputs and apply buttons when there are no montage rows', () => {
      render(<EegMontageEditor {...defaultProps} montageChannels={[]} />);
      expect(screen.getByTestId('bulk-highpass-apply-button')).toBeDisabled();
      expect(screen.getByTestId('bulk-lowpass-apply-button')).toBeDisabled();
      expect(screen.getByTestId('bulk-notch-apply-button')).toBeDisabled();
      expect(screen.getByTestId('bulk-highpass-input')).toBeDisabled();
      expect(screen.getByTestId('bulk-lowpass-input')).toBeDisabled();
      expect(screen.getByTestId('bulk-notch-input')).toBeDisabled();
    });

    it('defaults the bulk filter inputs to blank', () => {
      render(<EegMontageEditor {...defaultProps} />);
      expect(screen.getByTestId('bulk-highpass-input')).toHaveValue(null);
      expect(screen.getByTestId('bulk-lowpass-input')).toHaveValue(null);
      expect(screen.getByTestId('bulk-notch-input')).toHaveValue(null);
    });

    it("sets every montage row's highPass when its own column is applied", async () => {
      render(<EegMontageEditor {...defaultProps} />);
      await userEvent.type(screen.getByTestId('bulk-highpass-input'), '1');
      await userEvent.click(screen.getByTestId('bulk-highpass-apply-button'));

      // MONTAGE_CHANNELS seeds id === channel, so these testids double as an id check.
      CHANNEL_NAMES.forEach((name) =>
        expect(screen.getByTestId(`montage-highpass-${name}`)).toHaveValue(1)
      );
    });

    it("sets every montage row's lowPass when its own column is applied", async () => {
      render(<EegMontageEditor {...defaultProps} />);
      await userEvent.type(screen.getByTestId('bulk-lowpass-input'), '40');
      await userEvent.click(screen.getByTestId('bulk-lowpass-apply-button'));

      CHANNEL_NAMES.forEach((name) =>
        expect(screen.getByTestId(`montage-lowpass-${name}`)).toHaveValue(40)
      );
    });

    it("sets every montage row's notch when its own column is applied", async () => {
      render(<EegMontageEditor {...defaultProps} />);
      await userEvent.type(screen.getByTestId('bulk-notch-input'), '50');
      await userEvent.click(screen.getByTestId('bulk-notch-apply-button'));

      CHANNEL_NAMES.forEach((name) =>
        expect(screen.getByTestId(`montage-notch-${name}`)).toHaveValue(50)
      );
    });

    it("applying one column's checkmark leaves the other two filter columns untouched", async () => {
      render(<EegMontageEditor {...defaultProps} />);
      await userEvent.type(screen.getByTestId('bulk-highpass-input'), '1');
      await userEvent.click(screen.getByTestId('bulk-highpass-apply-button'));

      CHANNEL_NAMES.forEach((name) => {
        expect(screen.getByTestId(`montage-lowpass-${name}`)).toHaveValue(null);
        expect(screen.getByTestId(`montage-notch-${name}`)).toHaveValue(null);
      });
    });

    it('clears every row back to off when applied with a blank field after a prior bulk set', async () => {
      render(<EegMontageEditor {...defaultProps} />);
      await userEvent.type(screen.getByTestId('bulk-highpass-input'), '1');
      await userEvent.click(screen.getByTestId('bulk-highpass-apply-button'));

      await userEvent.clear(screen.getByTestId('bulk-highpass-input'));
      await userEvent.click(screen.getByTestId('bulk-highpass-apply-button'));

      CHANNEL_NAMES.forEach((name) =>
        expect(screen.getByTestId(`montage-highpass-${name}`)).toHaveValue(null)
      );
    });

    it("leaves each row's color and reference untouched", async () => {
      const montageChannels = CHANNEL_NAMES.map((name) => ({
        id: name,
        channel: name,
        reference: 'average',
        color: 'red',
      }));
      render(<EegMontageEditor {...defaultProps} montageChannels={montageChannels} />);
      await userEvent.type(screen.getByTestId('bulk-notch-input'), '50');
      await userEvent.click(screen.getByTestId('bulk-notch-apply-button'));

      CHANNEL_NAMES.forEach((name) => {
        expect(screen.getByTestId(`reference-${name}`)).toHaveValue('average');
        expect(screen.getByTestId(`color-${name}`)).toHaveValue('red');
      });
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

    it("colors only the bad channel's own <option> text-alert in the reference dropdown, not the select or the other options", async () => {
      render(<EegMontageEditor {...defaultProps} />);
      // FP1 isn't bad, but referencing bad FP2 should flag only FP2's own <option>.
      await userEvent.selectOptions(screen.getByTestId('reference-FP1'), 'FP2');
      expect(screen.getByTestId('montage-channel-FP1').className).not.toContain('text-alert');
      // The <select> itself must stay uncolored — a class here would cascade onto every
      // <option> in the dropdown, not just the bad one (the bug this test guards against).
      expect(screen.getByTestId('reference-FP1').className).not.toContain('text-alert');
      const options = Array.from(screen.getByTestId('reference-FP1').options);
      const fp2Option = options.find((o) => o.value === 'FP2');
      const fp3Option = options.find((o) => o.value === 'FP3');
      expect(fp2Option.className).toContain('text-alert');
      expect(fp3Option.className).not.toContain('text-alert');
    });

    it('colors both the channel name and its bad reference option text-alert when both are bad', async () => {
      render(<EegMontageEditor {...defaultProps} />);
      await userEvent.click(screen.getByTestId('channel-bad-FP1'));
      await userEvent.selectOptions(screen.getByTestId('reference-FP1'), 'FP2');
      expect(screen.getByTestId('montage-channel-FP1').className).toContain('text-alert');
      const fp2Option = Array.from(screen.getByTestId('reference-FP1').options).find(
        (o) => o.value === 'FP2'
      );
      expect(fp2Option.className).toContain('text-alert');
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

    // The row background colour is kept for status (bad/missing tints), so a muted colour tint
    // can't be mistaken for one — the row's colour is a stripe on its left edge in the trace's
    // own, full colour instead
    it("shows a montage row's selected color as a full-color stripe on its left edge, not a background tint", async () => {
      render(<EegMontageEditor {...defaultProps} />);
      await userEvent.selectOptions(screen.getByTestId('color-FP1'), 'red');

      expect(screen.getByTestId('color-stripe-FP1').style.backgroundColor).toBe('red');
      expect(screen.getByTestId('reference-FP1').closest('div').style.backgroundColor).toBe('');
    });

    it('shows no stripe for a default-colored (unset) row', () => {
      render(<EegMontageEditor {...defaultProps} />);
      expect(screen.queryByTestId('color-stripe-FP1')).toBeNull();
      expect(screen.getByTestId('reference-FP1').closest('div').style.backgroundColor).toBe('');
    });

    it('shows a bad row both ways: the bg-alert tint for its status, the stripe for its color', async () => {
      // FP2 is bad per CHANNEL_SETTINGS
      render(<EegMontageEditor {...defaultProps} />);
      await userEvent.selectOptions(screen.getByTestId('color-FP2'), 'red');

      expect(screen.getByTestId('reference-FP2').closest('div').className).toContain('bg-alert');
      expect(screen.getByTestId('color-stripe-FP2').style.backgroundColor).toBe('red');
    });

    // jsdom doesn't paint, so this checks the classes that set the paint order
    it('marks a selected row with an outline, drawn over the stripe', async () => {
      render(<EegMontageEditor {...defaultProps} />);
      await userEvent.selectOptions(screen.getByTestId('color-FP1'), 'red');
      await userEvent.click(screen.getByTestId('montage-channel-FP1'));

      const row = screen.getByTestId('montage-channel-FP1').closest('div');
      expect(row.className).toContain('outline-primary');
      expect(row.className).not.toContain('ring-primary');
      expect(row.className).toContain('isolate');
      expect(screen.getByTestId('color-stripe-FP1').className).toContain('-z-10');
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

  describe('global filter placeholders', () => {
    it("shows the global filters of the row's channel type as placeholders", () => {
      render(<EegMontageEditor {...defaultProps} />);
      // FP1 is eeg per CHANNEL_SETTINGS
      expect(screen.getByTestId('montage-highpass-FP1')).toHaveAttribute('placeholder', '0.5');
      expect(screen.getByTestId('montage-lowpass-FP1')).toHaveAttribute('placeholder', '70');
      expect(screen.getByTestId('montage-notch-FP1')).toHaveAttribute('placeholder', '50');
      // FP3 is seeg
      expect(screen.getByTestId('montage-highpass-FP3')).toHaveAttribute('placeholder', '1');
    });

    it('shows no placeholder when the global filter for that type is off', () => {
      render(<EegMontageEditor {...defaultProps} />);
      // seeg lowPass and notch are off
      expect(screen.getByTestId('montage-lowpass-FP3')).not.toHaveAttribute('placeholder');
      expect(screen.getByTestId('montage-notch-FP3')).not.toHaveAttribute('placeholder');
    });

    it("keeps the row's own value as the input value, with the global value still as placeholder", () => {
      const montageChannels = [{ ...MONTAGE_CHANNELS[0], highPass: 2 }]; // FP1, eeg
      render(<EegMontageEditor {...defaultProps} montageChannels={montageChannels} />);
      const input = screen.getByTestId('montage-highpass-FP1');
      expect(input).toHaveValue(2);
      expect(input).toHaveAttribute('placeholder', '0.5');
    });

    it("follows a draft type change: switching FP1 to seeg shows seeg's global values", async () => {
      render(<EegMontageEditor {...defaultProps} />);
      await userEvent.selectOptions(screen.getByTestId('channel-type-FP1'), 'seeg');

      expect(screen.getByTestId('montage-highpass-FP1')).toHaveAttribute('placeholder', '1');
      expect(screen.getByTestId('montage-lowpass-FP1')).not.toHaveAttribute('placeholder');
    });

    it('shows no placeholder on a row whose channel is missing from the recording', () => {
      const montageChannels = [{ ...MONTAGE_CHANNELS[0], id: 'X', channel: 'MISSING' }];
      render(<EegMontageEditor {...defaultProps} montageChannels={montageChannels} />);
      expect(screen.getByTestId('montage-highpass-X')).not.toHaveAttribute('placeholder');
    });
  });

  describe('notch harmonics', () => {
    // eeg harmonics on; seeg on too, but seeg has no notch to add them to
    const harmonicsOn = {
      ...GLOBAL_FILTERS,
      eeg: { ...GLOBAL_FILTERS.eeg, notchHarmonics: true },
      seeg: { ...GLOBAL_FILTERS.seeg, notchHarmonics: true },
    };

    it("marks the notch placeholder with +h when the row's type also notches the harmonics", () => {
      render(<EegMontageEditor {...defaultProps} globalFilters={harmonicsOn} />);
      expect(screen.getByTestId('montage-notch-FP1')).toHaveAttribute('placeholder', '50+h'); // eeg
    });

    it('says in the notch tooltip that the harmonics are notched too, and where to change it', () => {
      render(<EegMontageEditor {...defaultProps} globalFilters={harmonicsOn} />);
      const title = screen.getByTestId('montage-notch-FP1').getAttribute('title');
      expect(title).toMatch(/harmonic/i);
      expect(title).toMatch(/Global EEG Filters/);
    });

    it("also shows the tooltip on a row with its own notch, since it gets its type's harmonics", () => {
      const montageChannels = [{ ...MONTAGE_CHANNELS[0], notch: 60 }]; // FP1, eeg
      render(
        <EegMontageEditor
          {...defaultProps}
          montageChannels={montageChannels}
          globalFilters={harmonicsOn}
        />
      );
      expect(screen.getByTestId('montage-notch-FP1')).toHaveAttribute('title');
    });

    it('shows no harmonics marks when the type has them off', () => {
      render(<EegMontageEditor {...defaultProps} />);
      const input = screen.getByTestId('montage-notch-FP1');
      expect(input).toHaveAttribute('placeholder', '50');
      expect(input).not.toHaveAttribute('title');
    });

    it('shows no harmonics marks on a row without any notch, even with the type flag on', () => {
      render(<EegMontageEditor {...defaultProps} globalFilters={harmonicsOn} />);
      // FP3 is seeg: harmonics on, but no notch to add them to
      expect(screen.getByTestId('montage-notch-FP3')).not.toHaveAttribute('title');
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

  describe('Create SEEG Bipolar', () => {
    // FP1/FP2 are contact-shaped ("FP" + digit) and both 'seeg', so they pair (FP1 -> FP2).
    // FP2 has no next-in-group partner (FP3 isn't 'seeg', so it's not indexed as one) and so
    // is monopolar. FP3 stays 'eeg' — it must never appear in the resulting montage.
    const PAIRABLE_SETTINGS = {
      FP1: { type: 'seeg', bad: false },
      FP2: { type: 'seeg', bad: false },
      FP3: { type: 'eeg', bad: false },
    };

    it('disables the button when no SEEG group has a pairable contact', () => {
      const ALL_EEG = {
        FP1: { type: 'eeg', bad: false },
        FP2: { type: 'eeg', bad: false },
        FP3: { type: 'eeg', bad: false },
      };
      render(<EegMontageEditor {...defaultProps} channelSettings={ALL_EEG} />);
      expect(screen.getByTestId('create-seeg-bipolar-button')).toBeDisabled();
    });

    it('enables the button once a SEEG group has at least one pairable contact', () => {
      render(<EegMontageEditor {...defaultProps} channelSettings={PAIRABLE_SETTINGS} />);
      expect(screen.getByTestId('create-seeg-bipolar-button')).not.toBeDisabled();
    });

    it('asks to confirm before replacing unsaved montage-row edits, and aborts if cancelled', async () => {
      const onApplyMontageChannels = vi.fn();
      render(
        <EegMontageEditor
          {...defaultProps}
          channelSettings={PAIRABLE_SETTINGS}
          onApplyMontageChannels={onApplyMontageChannels}
        />
      );
      // Edit the draft first so it diverges from the montageChannels prop (isMontageModified).
      await userEvent.click(screen.getByTestId('clear-all-button'));
      window.confirm.mockReturnValue(false);

      await userEvent.click(screen.getByTestId('create-seeg-bipolar-button'));
      expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('replace'));

      // Cancelled — the draft stays exactly as the prior edit (Clear all) left it, i.e. empty.
      await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
      expect(onApplyMontageChannels).toHaveBeenCalledWith([]);
    });

    it('does not ask for confirmation when the montage draft has not been edited', async () => {
      render(<EegMontageEditor {...defaultProps} channelSettings={PAIRABLE_SETTINGS} />);
      window.confirm.mockClear();
      await userEvent.click(screen.getByTestId('create-seeg-bipolar-button'));
      expect(window.confirm).not.toHaveBeenCalled();
    });

    it('shows "Keep monopolar electrodes?" when a SEEG contact has no next-in-group partner', async () => {
      render(<EegMontageEditor {...defaultProps} channelSettings={PAIRABLE_SETTINGS} />);
      await userEvent.click(screen.getByTestId('create-seeg-bipolar-button'));
      expect(screen.getByText('Keep monopolar electrodes?')).toBeTruthy();
    });

    it('focuses "No" by default, so Enter keeps the recommended (drop monopolar) choice', async () => {
      render(<EegMontageEditor {...defaultProps} channelSettings={PAIRABLE_SETTINGS} />);
      await userEvent.click(screen.getByTestId('create-seeg-bipolar-button'));
      expect(screen.getByTestId('keep-monopolar-no')).toHaveFocus();
    });

    it('"No" drops monopolar contacts, keeping only the bipolar-paired rows', async () => {
      const onApplyMontageChannels = vi.fn();
      render(
        <EegMontageEditor
          {...defaultProps}
          channelSettings={PAIRABLE_SETTINGS}
          onApplyMontageChannels={onApplyMontageChannels}
        />
      );
      await userEvent.click(screen.getByTestId('create-seeg-bipolar-button'));
      await userEvent.click(screen.getByTestId('keep-monopolar-no'));
      await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

      const committed = onApplyMontageChannels.mock.calls[0][0];
      expect(committed).toEqual([
        {
          id: expect.any(String),
          channel: 'FP1',
          reference: 'FP2',
          color: null,
          highPass: null,
          lowPass: null,
          notch: null,
        },
      ]);
    });

    it('"Yes" keeps monopolar contacts unreferenced instead of dropping them', async () => {
      const onApplyMontageChannels = vi.fn();
      render(
        <EegMontageEditor
          {...defaultProps}
          channelSettings={PAIRABLE_SETTINGS}
          onApplyMontageChannels={onApplyMontageChannels}
        />
      );
      await userEvent.click(screen.getByTestId('create-seeg-bipolar-button'));
      await userEvent.click(screen.getByTestId('keep-monopolar-yes'));
      await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

      const committed = onApplyMontageChannels.mock.calls[0][0];
      expect(committed.map((row) => row.channel).sort()).toEqual(['FP1', 'FP2']);
      expect(committed.find((row) => row.channel === 'FP2').reference).toBeNull();
    });

    it('never adds a row for an EEG/Other channel, even ones already in the montage', async () => {
      const onApplyMontageChannels = vi.fn();
      render(
        <EegMontageEditor
          {...defaultProps}
          channelSettings={PAIRABLE_SETTINGS}
          onApplyMontageChannels={onApplyMontageChannels}
        />
      );
      await userEvent.click(screen.getByTestId('create-seeg-bipolar-button'));
      await userEvent.click(screen.getByTestId('keep-monopolar-yes'));
      await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

      const committed = onApplyMontageChannels.mock.calls[0][0];
      expect(committed.some((row) => row.channel === 'FP3')).toBe(false);
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

    it('disables the Clear column header button when there are no montage rows', () => {
      render(<EegMontageEditor {...defaultProps} montageChannels={[]} />);
      expect(screen.getByTestId('clear-all-header-button')).toBeDisabled();
    });

    it('the Clear column header button removes every montage row, same as "Clear all"', async () => {
      const onApplyMontageChannels = vi.fn();
      render(
        <EegMontageEditor {...defaultProps} onApplyMontageChannels={onApplyMontageChannels} />
      );
      await userEvent.click(screen.getByTestId('clear-all-header-button'));
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
      expect(name.className).toContain('text-error');
      expect(name.title).toBe('Channel not found in this recording');
      expect(name.closest('div').className).toContain('opacity-50');
      // tinted like every row that can't be drawn: error (red) for missing
      expect(name.closest('div').className).toContain('bg-error/');
      expect(screen.getByTestId('reference-row-1')).toBeDisabled();
      expect(screen.getByTestId('color-row-1')).toBeDisabled();
    });

    it('tints a row that is both bad and missing something as missing (the one to fix)', () => {
      // FP2 is bad in CHANNEL_SETTINGS; GHOST isn't in the recording
      const montageChannels = [{ id: 'row-1', channel: 'FP2', reference: 'GHOST', color: null }];
      render(<EegMontageEditor {...defaultProps} montageChannels={montageChannels} />);

      const row = screen.getByTestId('montage-channel-row-1').closest('div');
      expect(row.className).toContain('bg-error/');
      expect(row.className).not.toContain('bg-alert');
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
      expect(name.className).not.toContain('text-error');
      expect(name.closest('div').className).not.toContain('opacity-50');

      const referenceSelect = screen.getByTestId('reference-row-1');
      expect(referenceSelect).not.toBeDisabled();
      expect(referenceSelect).toHaveValue('GHOST');
      expect(referenceSelect.title).toBe('Reference channel not found in this recording');
      const injectedOption = Array.from(referenceSelect.options).find((o) => o.value === 'GHOST');
      expect(injectedOption.textContent).toBe('GHOST (missing)');
      expect(injectedOption.className).toContain('text-error');
      expect(screen.getByTestId('color-row-1')).not.toBeDisabled();
    });

    it('makes a missing reference stand out without opening its dropdown: red row tint, red select', () => {
      const montageChannels = [{ id: 'row-1', channel: 'FP1', reference: 'GHOST', color: null }];
      render(<EegMontageEditor {...defaultProps} montageChannels={montageChannels} />);

      const referenceSelect = screen.getByTestId('reference-row-1');
      // a closed <select> shows its selected option in the select's own colour, not the option's
      expect(referenceSelect.className).toContain('text-error');
      expect(referenceSelect.className).toContain('border-error');
      expect(screen.getByTestId('montage-channel-row-1').closest('div').className).toContain(
        'bg-error/'
      );
      // the other options keep their own colour, instead of inheriting the select's red
      // (FP3: FP2 is bad in CHANNEL_SETTINGS, so it's text-alert)
      // and so do n/a, Average and Median
      for (const value of ['FP3', '', 'average', 'median']) {
        const option = Array.from(referenceSelect.options).find((o) => o.value === value);
        expect(option.className).toContain('text-foreground');
        expect(option.className).not.toContain('text-error');
      }
    });

    it("keeps the row's colour stripe next to the red tint while its reference is missing", () => {
      const montageChannels = [{ id: 'row-1', channel: 'FP1', reference: 'GHOST', color: 'blue' }];
      render(<EegMontageEditor {...defaultProps} montageChannels={montageChannels} />);

      const row = screen.getByTestId('montage-channel-row-1').closest('div');
      expect(row.className).toContain('bg-error/');
      expect(screen.getByTestId('color-stripe-row-1').style.backgroundColor).toBe('blue');
    });

    it('leaves the reference select and row untinted when the reference is present', () => {
      const montageChannels = [{ id: 'row-1', channel: 'FP1', reference: 'FP3', color: null }];
      render(<EegMontageEditor {...defaultProps} montageChannels={montageChannels} />);

      const referenceSelect = screen.getByTestId('reference-row-1');
      expect(referenceSelect.className).not.toContain('error');
      expect(screen.getByTestId('montage-channel-row-1').closest('div').className).not.toContain(
        'bg-error'
      );
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

    it("loads a file spelled differently from the recording under the recording's own names", async () => {
      render(<EegMontageEditor {...defaultProps} />);
      const file = new File([ANYWAVE_FILE_TEXT.replaceAll('FP', 'Fp')], 'custom.mtg');
      await userEvent.upload(screen.getByTestId('montage-file-input'), file);

      const rows = screen.getAllByTestId(/^montage-channel-/);
      expect(rows.map((r) => r.textContent)).toEqual(['FP1', 'FP2']);
      const referenceSelects = screen.getAllByTestId(/^reference-/);
      expect(referenceSelects.map((s) => s.value)).toEqual(['', 'FP1']);
      // channelSettings is keyed by the recording's names, so the type lands on FP1 too.
      expect(screen.getByTestId('channel-type-FP1')).toHaveValue('seeg');
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

    // Save exports the effective (resolved) filters per row: a row without its own value
    // writes the global filter of its channel type, so the file filters the same as the viewer
    describe('Save writes the resolved filters', () => {
      // The <filters .../> element of one channel in the saved XML
      const savedFilters = (channel) => {
        const xml = downloadTextFile.mock.calls[0][0];
        return xml.match(new RegExp(`<Channel name="${channel}">[\\s\\S]*?(<filters [^>]*/>)`))[1];
      };

      it("writes the global filters of each row's channel type for a row without its own", async () => {
        render(<EegMontageEditor {...defaultProps} />);
        await userEvent.click(screen.getByRole('button', { name: 'Save' }));

        // FP1 is eeg; FP3 is seeg, whose lowPass and notch are off (-1 and 0 in AnyWave)
        expect(savedFilters('FP1')).toBe('<filters highPass="0.5" lowPass="70" notch="50"/>');
        expect(savedFilters('FP3')).toBe('<filters highPass="1" lowPass="-1" notch="0"/>');
      });

      it("writes a row's own value over the global one, per field", async () => {
        const montageChannels = [{ ...MONTAGE_CHANNELS[0], highPass: 2 }]; // FP1, eeg
        render(<EegMontageEditor {...defaultProps} montageChannels={montageChannels} />);
        await userEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(savedFilters('FP1')).toBe('<filters highPass="2" lowPass="70" notch="50"/>');
      });

      it("uses the draft channel type: FP3 switched to eeg saves eeg's global filters", async () => {
        render(<EegMontageEditor {...defaultProps} />);
        await userEvent.selectOptions(screen.getByTestId('channel-type-FP3'), 'eeg');
        await userEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(savedFilters('FP3')).toBe('<filters highPass="0.5" lowPass="70" notch="50"/>');
      });

      it('writes all filters off when there are no global filters and no own values', async () => {
        render(<EegMontageEditor {...defaultProps} globalFilters={undefined} />);
        await userEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(savedFilters('FP1')).toBe('<filters highPass="-1" lowPass="-1" notch="0"/>');
      });
    });

    // Load is the inverse of Save above: filters shared by every row of a type become that
    // type's global filters (see extractGlobalFilters). Like the rows, they're a draft: shown
    // as the rows' placeholders, committed on Apply/OK, discarded on Cancel.
    describe('Load recognises global filters', () => {
      // FP1 and FP2 (both EEG) share all three filters; FP3 (seeg) isn't in the file
      const filtersFile = (fp2LowPass = 40) =>
        new File(
          [
            `<!DOCTYPE AnyWaveMontage>
<Montage>
	<Channel name="FP1">
		<type>EEG</type>
		<reference></reference>
		<color></color>
		<filters highPass="2" lowPass="40" notch="60"/>
	</Channel>
	<Channel name="FP2">
		<type>EEG</type>
		<reference>FP1</reference>
		<color></color>
		<filters highPass="2" lowPass="${fp2LowPass}" notch="60"/>
	</Channel>
</Montage>`,
          ],
          'filters.mtg'
        );

      // Loaded rows get fresh random ids, so their filter inputs are found by list order
      const filterInputs = (field) => screen.getAllByTestId(new RegExp(`^montage-${field}-`));

      it('shows the shared filters as the global placeholders, and leaves the rows own values empty', async () => {
        render(<EegMontageEditor {...defaultProps} />);
        await userEvent.upload(screen.getByTestId('montage-file-input'), filtersFile());

        for (const [field, value] of [
          ['highpass', '2'],
          ['lowpass', '40'],
          ['notch', '60'],
        ]) {
          filterInputs(field).forEach((input) => {
            expect(input).toHaveValue(null);
            expect(input).toHaveAttribute('placeholder', value);
          });
        }
      });

      it('keeps a filter that differs between rows of a type on the rows, per field', async () => {
        render(<EegMontageEditor {...defaultProps} />);
        await userEvent.upload(screen.getByTestId('montage-file-input'), filtersFile(30));

        // low-pass differs (40 vs 30): stays on the rows; eeg's global low-pass is unchanged
        expect(filterInputs('lowpass').map((input) => input.value)).toEqual(['40', '30']);
        expect(filterInputs('lowpass')[0]).toHaveAttribute('placeholder', '70');
        // high-pass is shared: lifted to the global filters
        expect(filterInputs('highpass')[0]).toHaveValue(null);
        expect(filterInputs('highpass')[0]).toHaveAttribute('placeholder', '2');
      });

      it('OK commits the loaded global filters, keeping the settings the file has no say over', async () => {
        const onApplyGlobalFilters = vi.fn();
        const onApplyMontageChannels = vi.fn();
        // notchHarmonics isn't part of the .mtg format, so loading a file must keep it
        const globalFilters = {
          ...GLOBAL_FILTERS,
          eeg: { ...GLOBAL_FILTERS.eeg, notchHarmonics: true },
        };
        render(
          <EegMontageEditor
            {...defaultProps}
            globalFilters={globalFilters}
            onApplyGlobalFilters={onApplyGlobalFilters}
            onApplyMontageChannels={onApplyMontageChannels}
          />
        );
        await userEvent.upload(screen.getByTestId('montage-file-input'), filtersFile());
        await userEvent.click(screen.getByRole('button', { name: 'OK' }));

        expect(onApplyGlobalFilters).toHaveBeenCalledWith({
          ...GLOBAL_FILTERS, // seeg and other untouched: the file has no rows of those types
          eeg: { highPass: 2, lowPass: 40, notch: 60, notchHarmonics: true },
        });
        // the committed rows follow the new global filters instead of carrying their own
        const committedRows = onApplyMontageChannels.mock.calls[0][0];
        committedRows.forEach((row) =>
          expect(row).toMatchObject({ highPass: null, lowPass: null, notch: null })
        );
      });

      it('Cancel discards the loaded global filters', async () => {
        const onApplyGlobalFilters = vi.fn();
        render(<EegMontageEditor {...defaultProps} onApplyGlobalFilters={onApplyGlobalFilters} />);
        await userEvent.upload(screen.getByTestId('montage-file-input'), filtersFile());
        await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(onApplyGlobalFilters).not.toHaveBeenCalled();
      });

      // Only global filters this window changed itself (through Load) are committed, so an
      // unchanged copy never overwrites what the Global Filters window applied
      it('does not commit global filters on Apply when nothing changed them', async () => {
        const onApplyGlobalFilters = vi.fn();
        render(<EegMontageEditor {...defaultProps} onApplyGlobalFilters={onApplyGlobalFilters} />);
        await userEvent.click(screen.getByTestId('channel-bad-FP1'));
        await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

        expect(onApplyGlobalFilters).not.toHaveBeenCalled();
      });

      it('leaves the global filters as they were after loading a file without filters', async () => {
        const onApplyGlobalFilters = vi.fn();
        render(<EegMontageEditor {...defaultProps} onApplyGlobalFilters={onApplyGlobalFilters} />);
        await userEvent.upload(
          screen.getByTestId('montage-file-input'),
          new File([CARTOOL_FILE_TEXT], 'custom.mtg')
        );

        expect(filterInputs('highpass')[0]).toHaveAttribute('placeholder', '0.5'); // FP1, eeg
        await userEvent.click(screen.getByRole('button', { name: 'OK' }));
        expect(onApplyGlobalFilters).not.toHaveBeenCalled();
      });

      // The Global Filters window can apply new global filters while this window is open
      it('follows global filters applied elsewhere while open, and OK without a Load leaves them alone', async () => {
        const onApplyGlobalFilters = vi.fn();
        const { rerender } = render(
          <EegMontageEditor {...defaultProps} onApplyGlobalFilters={onApplyGlobalFilters} />
        );
        rerender(
          <EegMontageEditor
            {...defaultProps}
            globalFilters={{ ...GLOBAL_FILTERS, eeg: { ...GLOBAL_FILTERS.eeg, highPass: 1.5 } }}
            onApplyGlobalFilters={onApplyGlobalFilters}
          />
        );

        expect(filterInputs('highpass')[0]).toHaveAttribute('placeholder', '1.5'); // FP1, eeg
        await userEvent.click(screen.getByRole('button', { name: 'OK' }));
        expect(onApplyGlobalFilters).not.toHaveBeenCalled();
      });

      it('commits the loaded global filters once, so a second Apply leaves global filters applied elsewhere alone', async () => {
        const onApplyGlobalFilters = vi.fn();
        const { rerender } = render(
          <EegMontageEditor {...defaultProps} onApplyGlobalFilters={onApplyGlobalFilters} />
        );
        await userEvent.upload(screen.getByTestId('montage-file-input'), filtersFile());
        await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
        expect(onApplyGlobalFilters).toHaveBeenCalledTimes(1);

        // The Global Filters window then applies a different eeg high-pass
        const appliedElsewhere = {
          ...GLOBAL_FILTERS,
          eeg: { highPass: 1.5, lowPass: 40, notch: 60, notchHarmonics: false },
        };
        rerender(
          <EegMontageEditor
            {...defaultProps}
            globalFilters={appliedElsewhere}
            onApplyGlobalFilters={onApplyGlobalFilters}
          />
        );
        expect(filterInputs('highpass')[0]).toHaveAttribute('placeholder', '1.5');

        await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
        expect(onApplyGlobalFilters).toHaveBeenCalledTimes(1);
      });

      it('saving right after loading writes the same filters back', async () => {
        render(<EegMontageEditor {...defaultProps} />);
        await userEvent.upload(screen.getByTestId('montage-file-input'), filtersFile());
        await userEvent.click(screen.getByRole('button', { name: 'Save' }));

        const xml = downloadTextFile.mock.calls[0][0];
        expect(xml.match(/<filters [^>]*\/>/g)).toEqual([
          '<filters highPass="2" lowPass="40" notch="60"/>',
          '<filters highPass="2" lowPass="40" notch="60"/>',
        ]);
      });
    });

    it("a row with a non-preset color (e.g. an AnyWave import's 'darkblue') renders as the select's actual selected value", async () => {
      const montageChannels = [{ id: 'FP1', channel: 'FP1', reference: null, color: 'darkblue' }];
      render(<EegMontageEditor {...defaultProps} montageChannels={montageChannels} />);
      const select = screen.getByTestId('color-FP1');
      expect(select).toHaveValue('darkblue');
      const injectedOption = Array.from(select.options).find((o) => o.value === 'darkblue');
      expect(injectedOption).toBeTruthy();
      expect(injectedOption.style.color).toBe('darkblue');
    });

    it("tints each preset option's text to match the color it applies, in a row's Color select", () => {
      const montageChannels = [{ id: 'FP1', channel: 'FP1', reference: null, color: null }];
      render(<EegMontageEditor {...defaultProps} montageChannels={montageChannels} />);
      const options = Array.from(screen.getByTestId('color-FP1').options);
      const byValue = Object.fromEntries(options.map((option) => [option.value, option]));

      PRESET_COLORS.forEach((color) => expect(byValue[color].style.color).toBe(color));
    });
  });

  // jsdom doesn't paint, so these check the classes that keep the edges grabbable
  describe('window resize handles', () => {
    // the montage rows are positioned and the column headers are z-10, so without a higher
    // z-index they're drawn over the handles at the window's edges
    it('draws the resize handles above the window content', () => {
      render(<EegMontageEditor {...defaultProps} />);
      ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].forEach((direction) =>
        expect(screen.getByTestId(`montage-resize-${direction}`).className).toContain('z-20')
      );
    });

    // so the left and right handles don't cover the panes' content or scrollbars
    it('keeps an empty strip along the left and right edges for the resize handles', () => {
      render(<EegMontageEditor {...defaultProps} />);
      expect(screen.getByTestId('montage-editor-body').className).toContain('px-1.5');
    });

    // side by side, the channel list needs less room than the montage rows; stacked on a phone,
    // both get half the height
    it('splits the panes 27/73 side by side, and 50/50 when stacked on a phone', () => {
      const channelPane = () =>
        screen.getByRole('heading', { name: 'Channel Selection' }).parentElement.parentElement;
      const { unmount } = render(<EegMontageEditor {...defaultProps} />);
      expect(channelPane().style.width).toBe('27%');
      unmount();

      const { innerWidth } = window;
      window.innerWidth = 390;
      try {
        render(<EegMontageEditor {...defaultProps} />);
        expect(channelPane().style.flexGrow).toBe('50');
      } finally {
        window.innerWidth = innerWidth;
      }
    });

    // the fitting itself is tested in useFloatingWindow.test.jsx
    it('opens maximized on a phone, which is narrower than its minimum size', () => {
      const { innerWidth, innerHeight } = window;
      window.innerWidth = 390;
      window.innerHeight = 844;
      try {
        render(<EegMontageEditor {...defaultProps} />);
        expect(
          within(screen.getByTestId('montage-title-bar')).getByTitle('Restore')
        ).toBeInTheDocument();
      } finally {
        window.innerWidth = innerWidth;
        window.innerHeight = innerHeight;
      }
    });

    it('drops the strips when maximized, where there are no resize handles', async () => {
      render(<EegMontageEditor {...defaultProps} />);
      await userEvent.click(within(screen.getByTestId('montage-title-bar')).getByTitle('Maximize'));
      expect(screen.queryByTestId('montage-resize-e')).not.toBeInTheDocument();
      expect(screen.getByTestId('montage-editor-body').className).not.toContain('px-1.5');
    });
  });
});
