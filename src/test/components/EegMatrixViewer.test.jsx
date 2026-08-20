import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EegMatrixViewer } from '@/components/EegMatrixViewer';
import { interpolateDivergingColor } from '@/utils/eegColormaps';

// B1/B2/T1 are SEEG-shaped names — most tests type them 'seeg' so they land in the SEEG
// section; a few explicitly type them 'eeg' to exercise the EEG section instead.
const SEEG_TYPES = (n) => Array(n).fill('seeg');
const EEG_TYPES = (n) => Array(n).fill('eeg');

describe('EegMatrixViewer', () => {
  it('renders one row per electrode group, under the matching type section', () => {
    render(
      <EegMatrixViewer
        channelNames={['B1', 'B2', 'T1']}
        voltages={[1, 2, 3]}
        channelTypes={SEEG_TYPES(3)}
        colourBlindMode={false}
      />
    );
    expect(screen.getByTestId('matrix-section-seeg')).toBeInTheDocument();
    expect(screen.queryByTestId('matrix-section-eeg')).not.toBeInTheDocument();
    expect(screen.getByTestId('matrix-row-seeg-B-0')).toBeInTheDocument();
    expect(screen.getByTestId('matrix-row-seeg-T-0')).toBeInTheDocument();
  });

  it('shows the EEG section above the SEEG section when both are present', () => {
    render(
      <EegMatrixViewer
        channelNames={['Fp1', 'B1']}
        voltages={[1, 2]}
        channelTypes={['eeg', 'seeg']}
        colourBlindMode={false}
      />
    );
    const sections = screen.getAllByTestId(/^matrix-section-/);
    expect(sections.map((s) => s.dataset.testid)).toEqual([
      'matrix-section-eeg',
      'matrix-section-seeg',
    ]);
  });

  it('displays the group label exactly as typed in the channel names, not lowercased', () => {
    render(
      <EegMatrixViewer
        channelNames={['E1', 'E2']}
        voltages={[1, 2]}
        channelTypes={EEG_TYPES(2)}
        colourBlindMode={false}
      />
    );
    expect(screen.getByTestId('matrix-row-eeg-E-0')).toBeInTheDocument();
  });

  it('wraps a group with more contacts than the line width onto multiple lines, each with its own contact-number header', () => {
    const channelNames = Array.from({ length: 20 }, (_, i) => `E${i + 1}`);
    render(
      <EegMatrixViewer
        channelNames={channelNames}
        voltages={channelNames.map(() => 0)}
        channelTypes={EEG_TYPES(20)}
        colourBlindMode={false}
      />
    );
    expect(screen.getByTestId('matrix-row-eeg-E-0')).toBeInTheDocument(); // contacts 1-16
    expect(screen.getByTestId('matrix-row-eeg-E-1')).toBeInTheDocument(); // contacts 17-20
    expect(screen.getByTestId('matrix-cell-eeg-E-16')).toBeInTheDocument();
    expect(screen.getByTestId('matrix-cell-eeg-E-17')).toBeInTheDocument();
    expect(screen.getByTestId('matrix-cell-eeg-E-20')).toBeInTheDocument();
    expect(screen.queryByTestId('matrix-cell-eeg-E-21')).not.toBeInTheDocument();
    // The second line's header shows the true contact range (17-20), not a repeat of 1-16.
    expect(screen.getByText('17')).toBeInTheDocument();
    expect(screen.getByText('20')).toBeInTheDocument();
  });

  it('renders columns up to the maximum contact number across all groups in a section', () => {
    render(
      <EegMatrixViewer
        channelNames={['B1', 'B2', 'B3', 'T1']}
        voltages={[0, 0, 0, 0]}
        channelTypes={SEEG_TYPES(4)}
        colourBlindMode={false}
      />
    );
    // B has 3 contacts, so column 3 exists for every row, even T's (as an empty gap cell).
    expect(screen.getByTestId('matrix-cell-seeg-B-3')).toBeInTheDocument();
    expect(screen.getByTestId('matrix-cell-seeg-T-3')).toBeInTheDocument();
    expect(screen.queryByTestId('matrix-cell-seeg-B-4')).not.toBeInTheDocument();
  });

  it('renders gap cells as transparent and untitled', () => {
    render(
      <EegMatrixViewer
        channelNames={['B1', 'B2', 'T1']}
        voltages={[1, 2, 3]}
        channelTypes={SEEG_TYPES(3)}
        colourBlindMode={false}
      />
    );
    const gapCell = screen.getByTestId('matrix-cell-seeg-T-2'); // T only has contact 1
    // jest-dom's toHaveStyle doesn't normalize the 'transparent' keyword, so compare the style property directly.
    expect(gapCell.style.backgroundColor).toBe('transparent');
    expect(gapCell).not.toHaveAttribute('title');
  });

  it('colors populated cells using interpolateDivergingColor with the section-wide calMax', () => {
    render(
      <EegMatrixViewer
        channelNames={['B1', 'B2']}
        voltages={[10, -4]}
        channelTypes={SEEG_TYPES(2)}
        colourBlindMode={false}
      />
    );
    const calMax = 10; // max(|10|, |-4|)
    expect(screen.getByTestId('matrix-cell-seeg-B-1')).toHaveStyle({
      backgroundColor: interpolateDivergingColor(10, calMax, false),
    });
    expect(screen.getByTestId('matrix-cell-seeg-B-2')).toHaveStyle({
      backgroundColor: interpolateDivergingColor(-4, calMax, false),
    });
  });

  it('scales EEG and SEEG sections independently, so one type cannot wash out the other', () => {
    render(
      <EegMatrixViewer
        channelNames={['Fp1', 'B1']}
        voltages={[1, 100]} // SEEG voltage is 100x the EEG one
        channelTypes={['eeg', 'seeg']}
        colourBlindMode={false}
      />
    );
    // The EEG cell's own calMax is 1 (not 100), so it renders at full saturation, not near-white.
    expect(screen.getByTestId('matrix-cell-eeg-Fp-1')).toHaveStyle({
      backgroundColor: interpolateDivergingColor(1, 1, false),
    });
  });

  it('uses the colourblind colormap variant when colourBlindMode is true', () => {
    render(
      <EegMatrixViewer
        channelNames={['B1']}
        voltages={[10]}
        channelTypes={SEEG_TYPES(1)}
        colourBlindMode={true}
      />
    );
    expect(screen.getByTestId('matrix-cell-seeg-B-1')).toHaveStyle({
      backgroundColor: interpolateDivergingColor(10, 10, true),
    });
  });

  it('renders every cell white/neutral before any timepoint is clicked (empty voltages)', () => {
    render(
      <EegMatrixViewer
        channelNames={['B1', 'B2']}
        voltages={[]}
        channelTypes={SEEG_TYPES(2)}
        colourBlindMode={false}
      />
    );
    expect(screen.getByTestId('matrix-cell-seeg-B-1')).toHaveStyle({
      backgroundColor: 'rgb(255, 255, 255)',
    });
    expect(screen.getByTestId('matrix-cell-seeg-B-2')).toHaveStyle({
      backgroundColor: 'rgb(255, 255, 255)',
    });
  });

  it('lists unparsed channels in a footnote instead of rendering them as rows', () => {
    render(
      <EegMatrixViewer
        channelNames={['B1', 'ECG', 'Status']}
        voltages={[1, 0, 0]}
        channelTypes={['seeg', 'seeg', 'seeg']}
        colourBlindMode={false}
      />
    );
    expect(screen.queryByTestId('matrix-row-seeg-ECG-0')).not.toBeInTheDocument();
    const footnote = screen.getByTestId('matrix-unparsed');
    expect(footnote).toHaveTextContent('ECG');
    expect(footnote).toHaveTextContent('Status');
  });

  it('lists channels typed neither eeg nor seeg (e.g. "other") in the same footnote', () => {
    render(
      <EegMatrixViewer
        channelNames={['B1', 'ECG']}
        voltages={[1, 0]}
        channelTypes={['seeg', 'other']}
        colourBlindMode={false}
      />
    );
    const footnote = screen.getByTestId('matrix-unparsed');
    expect(footnote).toHaveTextContent('ECG');
  });

  it('renders no footnote when every channel parses', () => {
    render(
      <EegMatrixViewer
        channelNames={['B1', 'B2']}
        voltages={[1, 2]}
        channelTypes={SEEG_TYPES(2)}
        colourBlindMode={false}
      />
    );
    expect(screen.queryByTestId('matrix-unparsed')).not.toBeInTheDocument();
  });

  it('renders no section and only the footnote when there are no eeg/seeg-typed channels at all', () => {
    render(
      <EegMatrixViewer
        channelNames={['ECG']}
        voltages={[0]}
        channelTypes={['other']}
        colourBlindMode={false}
      />
    );
    expect(screen.queryByTestId('matrix-section-eeg')).not.toBeInTheDocument();
    expect(screen.queryByTestId('matrix-section-seeg')).not.toBeInTheDocument();
    expect(screen.getByTestId('matrix-unparsed')).toHaveTextContent('ECG');
  });
});
