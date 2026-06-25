import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EegMatrixViewer } from '@/components/EegMatrixViewer';
import { interpolateDivergingColor } from '@/utils/eegColormaps';

describe('EegMatrixViewer', () => {
  it('renders one row per electrode group', () => {
    render(
      <EegMatrixViewer
        channelNames={['B1', 'B2', 'T1']}
        voltages={[1, 2, 3]}
        colourBlindMode={false}
      />
    );
    expect(screen.getByTestId('matrix-row-b')).toBeInTheDocument();
    expect(screen.getByTestId('matrix-row-t')).toBeInTheDocument();
  });

  it('renders columns up to the maximum contact number across all groups', () => {
    render(
      <EegMatrixViewer
        channelNames={['B1', 'B2', 'B3', 'T1']}
        voltages={[0, 0, 0, 0]}
        colourBlindMode={false}
      />
    );
    // B has 3 contacts, so column 3 exists for every row, even T's (as an empty gap cell).
    expect(screen.getByTestId('matrix-cell-b-3')).toBeInTheDocument();
    expect(screen.getByTestId('matrix-cell-t-3')).toBeInTheDocument();
    expect(screen.queryByTestId('matrix-cell-b-4')).not.toBeInTheDocument();
  });

  it('renders gap cells as transparent and untitled', () => {
    render(
      <EegMatrixViewer
        channelNames={['B1', 'B2', 'T1']}
        voltages={[1, 2, 3]}
        colourBlindMode={false}
      />
    );
    const gapCell = screen.getByTestId('matrix-cell-t-2'); // T only has contact 1
    // jest-dom's toHaveStyle doesn't normalize the 'transparent' keyword, so compare the style property directly.
    expect(gapCell.style.backgroundColor).toBe('transparent');
    expect(gapCell).not.toHaveAttribute('title');
  });

  it('colors populated cells using interpolateDivergingColor with the recording-wide calMax', () => {
    render(
      <EegMatrixViewer channelNames={['B1', 'B2']} voltages={[10, -4]} colourBlindMode={false} />
    );
    const calMax = 10; // max(|10|, |-4|)
    expect(screen.getByTestId('matrix-cell-b-1')).toHaveStyle({
      backgroundColor: interpolateDivergingColor(10, calMax, false),
    });
    expect(screen.getByTestId('matrix-cell-b-2')).toHaveStyle({
      backgroundColor: interpolateDivergingColor(-4, calMax, false),
    });
  });

  it('uses the colourblind colormap variant when colourBlindMode is true', () => {
    render(<EegMatrixViewer channelNames={['B1']} voltages={[10]} colourBlindMode={true} />);
    expect(screen.getByTestId('matrix-cell-b-1')).toHaveStyle({
      backgroundColor: interpolateDivergingColor(10, 10, true),
    });
  });

  it('renders every cell white/neutral before any timepoint is clicked (empty voltages)', () => {
    render(<EegMatrixViewer channelNames={['B1', 'B2']} voltages={[]} colourBlindMode={false} />);
    expect(screen.getByTestId('matrix-cell-b-1')).toHaveStyle({
      backgroundColor: 'rgb(255, 255, 255)',
    });
    expect(screen.getByTestId('matrix-cell-b-2')).toHaveStyle({
      backgroundColor: 'rgb(255, 255, 255)',
    });
  });

  it('lists unparsed channels in a footnote instead of rendering them as rows', () => {
    render(
      <EegMatrixViewer
        channelNames={['B1', 'ECG', 'Status']}
        voltages={[1, 0, 0]}
        colourBlindMode={false}
      />
    );
    expect(screen.queryByTestId('matrix-row-ecg')).not.toBeInTheDocument();
    const footnote = screen.getByTestId('matrix-unparsed');
    expect(footnote).toHaveTextContent('ECG');
    expect(footnote).toHaveTextContent('Status');
  });

  it('renders no footnote when every channel parses', () => {
    render(
      <EegMatrixViewer channelNames={['B1', 'B2']} voltages={[1, 2]} colourBlindMode={false} />
    );
    expect(screen.queryByTestId('matrix-unparsed')).not.toBeInTheDocument();
  });
});
