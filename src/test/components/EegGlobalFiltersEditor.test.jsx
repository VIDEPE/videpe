import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EegGlobalFiltersEditor } from '@/components/EegGlobalFiltersEditor';
import { TYPE_LIST, DEFAULT_GLOBAL_FILTERS } from '@/utils/channelTypes';

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ isDarkMode: false }),
}));

// Different values per type (and some off), so a value landing in the wrong type's row fails
const GLOBAL_FILTERS = {
  eeg: { highPass: 0.5, lowPass: 70, notch: 50 },
  seeg: { highPass: 1, lowPass: null, notch: null },
  other: { highPass: null, lowPass: null, notch: null },
};

const FS = 256; // nyquist = 128 Hz
const NYQUIST = FS / 2;

// No seeg channels, so the seeg row is dimmed
const CHANNEL_COUNT_BY_TYPE = { eeg: 19, seeg: 0, other: 2 };

// Montage rows: two with their own filter values (exceptions to global), one following global
const MONTAGE_CHANNELS = [
  {
    id: 'r1',
    channel: 'Fp1',
    reference: null,
    color: 'red',
    highPass: 2,
    lowPass: null,
    notch: null,
  },
  {
    id: 'r2',
    channel: 'Fp2',
    reference: 'Fp1',
    color: null,
    highPass: null,
    lowPass: null,
    notch: 60,
  },
  {
    id: 'r3',
    channel: 'ECG',
    reference: null,
    color: null,
    highPass: null,
    lowPass: null,
    notch: null,
  },
];

const defaultProps = {
  globalFilters: GLOBAL_FILTERS,
  fs: FS,
  channelCountByType: CHANNEL_COUNT_BY_TYPE,
  montageChannels: MONTAGE_CHANNELS,
  onApplyMontageChannels: vi.fn(),
  onApplyGlobalFilters: vi.fn(),
  onClose: vi.fn(),
};

// The three filter columns, as named in the inputs' testids — used to run the same bulk test
// for each column instead of writing it out three times
const FILTER_KEYS = ['highPass', 'lowPass', 'notch'];

describe('EegGlobalFiltersEditor', () => {
  // ─── Rendering ─────────────────────────────────────────────────────────────
  describe('rendering', () => {
    it('renders one row per channel type in TYPE_LIST, labelled with its display name', () => {
      // Iterates TYPE_LIST on purpose: a type added there must show up here automatically
      render(<EegGlobalFiltersEditor {...defaultProps} />);
      Object.entries(TYPE_LIST).forEach(([type, label]) => {
        const row = screen.getByTestId(`global-filters-row-${type}`);
        expect(row).toHaveTextContent(label);
      });
    });

    it("shows each type's current global filter values, and blank for a filter that is off", () => {
      render(<EegGlobalFiltersEditor {...defaultProps} />);
      expect(screen.getByTestId('global-highPass-eeg')).toHaveValue(0.5);
      expect(screen.getByTestId('global-lowPass-eeg')).toHaveValue(70);
      expect(screen.getByTestId('global-notch-eeg')).toHaveValue(50);
      expect(screen.getByTestId('global-highPass-seeg')).toHaveValue(1);
      expect(screen.getByTestId('global-lowPass-seeg')).toHaveValue(null); // off
      expect(screen.getByTestId('global-notch-other')).toHaveValue(null); // off
    });

    it("shows each type's channel count next to its label", () => {
      render(<EegGlobalFiltersEditor {...defaultProps} />);
      expect(screen.getByTestId('global-filters-row-eeg')).toHaveTextContent('EEG (19 ch)');
      expect(screen.getByTestId('global-filters-row-seeg')).toHaveTextContent('SEEG (0 ch)');
      expect(screen.getByTestId('global-filters-row-other')).toHaveTextContent('Other (2 ch)');
    });

    it('dims the rows of types without channels, but keeps their inputs editable', () => {
      render(<EegGlobalFiltersEditor {...defaultProps} />);
      expect(screen.getByTestId('global-filters-row-seeg')).toHaveClass('opacity-40');
      expect(screen.getByTestId('global-filters-row-eeg')).not.toHaveClass('opacity-40');
      expect(screen.getByTestId('global-filters-row-other')).not.toHaveClass('opacity-40');
      expect(screen.getByTestId('global-lowPass-seeg')).toBeEnabled();
    });

    it('shows the title without * until the draft is edited, and with * after', async () => {
      render(<EegGlobalFiltersEditor {...defaultProps} />);
      expect(screen.getByText('Global EEG Filters')).toBeTruthy();

      await userEvent.type(screen.getByTestId('global-notch-seeg'), '50');
      expect(screen.getByText('Global EEG Filters *')).toBeTruthy();
    });
  });

  // ─── Apply / OK / Cancel ───────────────────────────────────────────────────
  describe('Apply / OK / Cancel', () => {
    it('Cancel closes without committing the draft', async () => {
      const onClose = vi.fn();
      const onApplyGlobalFilters = vi.fn();
      render(
        <EegGlobalFiltersEditor
          {...defaultProps}
          onClose={onClose}
          onApplyGlobalFilters={onApplyGlobalFilters}
        />
      );
      await userEvent.type(screen.getByTestId('global-notch-seeg'), '50');
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(onClose).toHaveBeenCalledOnce();
      expect(onApplyGlobalFilters).not.toHaveBeenCalled();
    });

    it('Apply commits the edited draft but keeps the window open', async () => {
      const onClose = vi.fn();
      const onApplyGlobalFilters = vi.fn();
      render(
        <EegGlobalFiltersEditor
          {...defaultProps}
          onClose={onClose}
          onApplyGlobalFilters={onApplyGlobalFilters}
        />
      );
      await userEvent.type(screen.getByTestId('global-notch-seeg'), '50');
      await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

      expect(onApplyGlobalFilters).toHaveBeenCalledWith({
        ...GLOBAL_FILTERS,
        seeg: { highPass: 1, lowPass: null, notch: 50 },
      });
      expect(onClose).not.toHaveBeenCalled();
    });

    it('OK commits the edited draft and closes', async () => {
      const onClose = vi.fn();
      const onApplyGlobalFilters = vi.fn();
      render(
        <EegGlobalFiltersEditor
          {...defaultProps}
          onClose={onClose}
          onApplyGlobalFilters={onApplyGlobalFilters}
        />
      );
      await userEvent.type(screen.getByTestId('global-highPass-other'), '5');
      await userEvent.click(screen.getByRole('button', { name: 'OK' }));

      expect(onApplyGlobalFilters).toHaveBeenCalledWith({
        ...GLOBAL_FILTERS,
        other: { highPass: 5, lowPass: null, notch: null },
      });
      expect(onClose).toHaveBeenCalledOnce();
    });

    it('commits a cleared input as null (filter off)', async () => {
      const onApplyGlobalFilters = vi.fn();
      render(
        <EegGlobalFiltersEditor {...defaultProps} onApplyGlobalFilters={onApplyGlobalFilters} />
      );
      await userEvent.clear(screen.getByTestId('global-notch-eeg'));
      await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

      expect(onApplyGlobalFilters).toHaveBeenCalledWith({
        ...GLOBAL_FILTERS,
        eeg: { highPass: 0.5, lowPass: 70, notch: null },
      });
    });
  });

  // ─── Bulk "set all" per column ─────────────────────────────────────────────
  describe('bulk set all', () => {
    it('defaults the bulk filter inputs to blank', () => {
      render(<EegGlobalFiltersEditor {...defaultProps} />);
      FILTER_KEYS.forEach((key) =>
        expect(screen.getByTestId(`bulk-${key}-input`)).toHaveValue(null)
      );
    });

    it.each(FILTER_KEYS)("sets every type's %s when its own column is applied", async (key) => {
      render(<EegGlobalFiltersEditor {...defaultProps} />);
      await userEvent.type(screen.getByTestId(`bulk-${key}-input`), '10');
      await userEvent.click(screen.getByTestId(`bulk-${key}-apply-button`));

      Object.keys(TYPE_LIST).forEach((type) =>
        expect(screen.getByTestId(`global-${key}-${type}`)).toHaveValue(10)
      );
    });

    it("applying one column's checkmark leaves the other two filter columns untouched", async () => {
      render(<EegGlobalFiltersEditor {...defaultProps} />);
      await userEvent.type(screen.getByTestId('bulk-highPass-input'), '2');
      await userEvent.click(screen.getByTestId('bulk-highPass-apply-button'));

      expect(screen.getByTestId('global-lowPass-eeg')).toHaveValue(70);
      expect(screen.getByTestId('global-notch-eeg')).toHaveValue(50);
      expect(screen.getByTestId('global-lowPass-seeg')).toHaveValue(null);
    });

    it('clears every type back to off when applied with a blank field', async () => {
      render(<EegGlobalFiltersEditor {...defaultProps} />);
      // bulk-highPass-input starts blank, so applying it straight away clears the column
      await userEvent.clear(screen.getByTestId('bulk-highPass-input'));
      await userEvent.click(screen.getByTestId('bulk-highPass-apply-button'));

      Object.keys(TYPE_LIST).forEach((type) =>
        expect(screen.getByTestId(`global-highPass-${type}`)).toHaveValue(null)
      );
    });

    it('clamps a bulk value above nyquist to nyquist', async () => {
      render(<EegGlobalFiltersEditor {...defaultProps} />);
      await userEvent.type(screen.getByTestId('bulk-lowPass-input'), '500');
      await userEvent.click(screen.getByTestId('bulk-lowPass-apply-button'));

      Object.keys(TYPE_LIST).forEach((type) =>
        expect(screen.getByTestId(`global-lowPass-${type}`)).toHaveValue(NYQUIST)
      );
    });

    it('only edits the draft: Cancel after a bulk set commits nothing', async () => {
      const onApplyGlobalFilters = vi.fn();
      render(
        <EegGlobalFiltersEditor {...defaultProps} onApplyGlobalFilters={onApplyGlobalFilters} />
      );
      await userEvent.type(screen.getByTestId('bulk-notch-input'), '60');
      await userEvent.click(screen.getByTestId('bulk-notch-apply-button'));
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(onApplyGlobalFilters).not.toHaveBeenCalled();
    });

    it("clamps a bulk highPass per type against that type's own lowPass", async () => {
      render(<EegGlobalFiltersEditor {...defaultProps} />);
      await userEvent.type(screen.getByTestId('bulk-highPass-input'), '80');
      await userEvent.click(screen.getByTestId('bulk-highPass-apply-button'));

      expect(screen.getByTestId('global-highPass-eeg')).toHaveValue(70); // eeg lowPass = 70
      expect(screen.getByTestId('global-highPass-seeg')).toHaveValue(80); // lowPass off
      expect(screen.getByTestId('global-highPass-other')).toHaveValue(80); // lowPass off
    });

    it("clamps a bulk lowPass per type against that type's own highPass", async () => {
      render(<EegGlobalFiltersEditor {...defaultProps} />);
      await userEvent.type(screen.getByTestId('bulk-lowPass-input'), '0.2');
      await userEvent.click(screen.getByTestId('bulk-lowPass-apply-button'));

      expect(screen.getByTestId('global-lowPass-eeg')).toHaveValue(0.5); // eeg highPass = 0.5
      expect(screen.getByTestId('global-lowPass-seeg')).toHaveValue(1); // seeg highPass = 1
      expect(screen.getByTestId('global-lowPass-other')).toHaveValue(0.2); // highPass off, so no clamp
    });
  });

  // ─── Clamping per-type inputs on blur ──────────
  // Same bounds as the montage editor's per-row inputs: highPass ≤ lowPass ≤ nyquist, and
  // notch within [0, nyquist]. Clamped on blur (not on every keystroke) so typing e.g. "100"
  // isn't cut off at "1" first.
  describe('clamping on blur', () => {
    it('clamps a highPass above its own lowPass down to that lowPass', async () => {
      render(<EegGlobalFiltersEditor {...defaultProps} />);
      const input = screen.getByTestId('global-highPass-eeg'); // eeg lowPass = 70
      await userEvent.clear(input);
      await userEvent.type(input, '80');
      await userEvent.tab();

      expect(input).toHaveValue(70);
    });

    it('clamps a highPass above nyquist down to nyquist when lowPass is off', async () => {
      render(<EegGlobalFiltersEditor {...defaultProps} />);
      const input = screen.getByTestId('global-highPass-other'); // other lowPass = off
      await userEvent.type(input, '500');
      await userEvent.tab();

      expect(input).toHaveValue(NYQUIST);
    });

    it('clamps a lowPass below its own highPass up to that highPass', async () => {
      render(<EegGlobalFiltersEditor {...defaultProps} />);
      const input = screen.getByTestId('global-lowPass-seeg'); // seeg highPass = 1
      await userEvent.type(input, '0.5');
      await userEvent.tab();

      expect(input).toHaveValue(1);
    });

    it('clamps a lowPass above nyquist down to nyquist', async () => {
      render(<EegGlobalFiltersEditor {...defaultProps} />);
      const input = screen.getByTestId('global-lowPass-eeg');
      await userEvent.clear(input);
      await userEvent.type(input, '500');
      await userEvent.tab();

      expect(input).toHaveValue(NYQUIST);
    });

    it('clamps a notch above nyquist down to nyquist', async () => {
      render(<EegGlobalFiltersEditor {...defaultProps} />);
      const input = screen.getByTestId('global-notch-eeg');
      await userEvent.clear(input);
      await userEvent.type(input, '500');
      await userEvent.tab();

      expect(input).toHaveValue(NYQUIST);
    });

    it('leaves a cleared input off (null) instead of clamping it to 0', async () => {
      render(<EegGlobalFiltersEditor {...defaultProps} />);
      const input = screen.getByTestId('global-highPass-eeg');
      await userEvent.clear(input);
      await userEvent.tab();

      expect(input).toHaveValue(null);
    });
  });

  // ─── Clear all ─────────────────────────────────────────────────────────────
  describe('Clear all', () => {
    it('clears every global filter of every type in the draft', async () => {
      render(<EegGlobalFiltersEditor {...defaultProps} />);
      await userEvent.click(screen.getByTestId('clear-all-filters-button'));

      Object.keys(TYPE_LIST).forEach((type) =>
        FILTER_KEYS.forEach((key) =>
          expect(screen.getByTestId(`global-${key}-${type}`)).toHaveValue(null)
        )
      );
    });

    it('only edits the draft: nothing is committed until Apply, which commits all filters off', async () => {
      const onApplyGlobalFilters = vi.fn();
      render(
        <EegGlobalFiltersEditor {...defaultProps} onApplyGlobalFilters={onApplyGlobalFilters} />
      );
      await userEvent.click(screen.getByTestId('clear-all-filters-button'));
      expect(onApplyGlobalFilters).not.toHaveBeenCalled();

      await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
      expect(onApplyGlobalFilters).toHaveBeenCalledWith(DEFAULT_GLOBAL_FILTERS);
    });

    it("leaves the montage rows' own filters alone", async () => {
      const onApplyMontageChannels = vi.fn();
      render(
        <EegGlobalFiltersEditor {...defaultProps} onApplyMontageChannels={onApplyMontageChannels} />
      );
      await userEvent.click(screen.getByTestId('clear-all-filters-button'));
      await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

      expect(onApplyMontageChannels).not.toHaveBeenCalled();
    });
  });

  // ─── Montage rows with their own filters ───────────────────────────────────
  describe('montage rows with their own filters', () => {
    it('shows how many montage rows use their own filters', () => {
      render(<EegGlobalFiltersEditor {...defaultProps} />);
      expect(screen.getByTestId('row-filter-overrides')).toHaveTextContent('2 montage rows');
    });

    it('hides the line when no montage row has its own filter', () => {
      render(<EegGlobalFiltersEditor {...defaultProps} montageChannels={[MONTAGE_CHANNELS[2]]} />);
      expect(screen.queryByTestId('row-filter-overrides')).toBeNull();
    });

    it('hides the line when there is no montage', () => {
      render(<EegGlobalFiltersEditor {...defaultProps} montageChannels={[]} />);
      expect(screen.queryByTestId('row-filter-overrides')).toBeNull();
    });

    it("Reset to global + Apply clears every row's own filters and keeps its other fields", async () => {
      const onApplyMontageChannels = vi.fn();
      render(
        <EegGlobalFiltersEditor {...defaultProps} onApplyMontageChannels={onApplyMontageChannels} />
      );
      await userEvent.click(screen.getByTestId('reset-row-filters-button'));
      await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

      expect(onApplyMontageChannels).toHaveBeenCalledWith(
        MONTAGE_CHANNELS.map((row) => ({ ...row, highPass: null, lowPass: null, notch: null }))
      );
    });

    it('Reset to global only takes effect on Apply: Cancel commits nothing', async () => {
      const onApplyMontageChannels = vi.fn();
      render(
        <EegGlobalFiltersEditor {...defaultProps} onApplyMontageChannels={onApplyMontageChannels} />
      );
      await userEvent.click(screen.getByTestId('reset-row-filters-button'));
      expect(onApplyMontageChannels).not.toHaveBeenCalled();

      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(onApplyMontageChannels).not.toHaveBeenCalled();
    });

    it('disables Reset to global while the montage editor is open, since its draft would overwrite the reset', () => {
      render(<EegGlobalFiltersEditor {...defaultProps} montageEditorOpen />);
      expect(screen.getByTestId('reset-row-filters-button')).toBeDisabled();
    });

    it('replaces the Reset to global button with a pending note once clicked', async () => {
      render(<EegGlobalFiltersEditor {...defaultProps} />);
      await userEvent.click(screen.getByTestId('reset-row-filters-button'));

      expect(screen.queryByTestId('reset-row-filters-button')).toBeNull();
      expect(screen.getByTestId('reset-row-filters-pending')).toHaveTextContent('Resets on Apply');
    });

    it('marks the title as modified once Reset to global is clicked', async () => {
      render(<EegGlobalFiltersEditor {...defaultProps} />);
      await userEvent.click(screen.getByTestId('reset-row-filters-button'));
      expect(screen.getByText('Global EEG Filters *')).toBeTruthy();
    });

    it('Apply without Reset to global leaves the montage rows untouched', async () => {
      const onApplyMontageChannels = vi.fn();
      render(
        <EegGlobalFiltersEditor {...defaultProps} onApplyMontageChannels={onApplyMontageChannels} />
      );
      await userEvent.type(screen.getByTestId('global-notch-seeg'), '50');
      await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

      expect(onApplyMontageChannels).not.toHaveBeenCalled();
    });
  });
});
