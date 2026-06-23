import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FileDropZone } from '@/components/FileDropZone';

const makeFile = (name) => new File([''], name);

const onFiles = vi.fn();

const defaultProps = {
  onFiles,
  accepted_formats: '.vhdr,.eeg',
  label: 'Drop EEG files',
  description: 'BrainVision: .vhdr + .eeg',
};

// Helper to render the component with default props, allowing overrides via the `props` argument
// renderZone();                          // uses all defaults
// renderZone({ label: "Drop test files" });        // overrides just `label`, keeps rest
const renderZone = (props = {}) => render(<FileDropZone {...defaultProps} {...props} />);

beforeEach(() => onFiles.mockReset());

describe('FileDropZone — rendering', () => {
  it('renders the label and description', () => {
    renderZone();
    expect(screen.getByText('Drop EEG files')).toBeInTheDocument();
    expect(screen.getByText('BrainVision: .vhdr + .eeg')).toBeInTheDocument();
  });

  it('renders the drag-and-drop instruction', () => {
    renderZone();
    expect(screen.getByText(/drag & drop/i)).toBeInTheDocument();
  });

  it('renders pending file names when pendingFiles are provided', () => {
    renderZone({ pendingFiles: [makeFile('sub01.vhdr'), makeFile('sub01.eeg')] });
    expect(screen.getByText('sub01.vhdr')).toBeInTheDocument();
    expect(screen.getByText('sub01.eeg')).toBeInTheDocument();
  });

  it('renders the hint text when provided', () => {
    renderZone({ hint: 'BrainVision also requires: .eeg' });
    expect(screen.getByText('BrainVision also requires: .eeg')).toBeInTheDocument();
  });

  it('does not render pending files or hint when neither prop is given', () => {
    renderZone();
    expect(screen.queryByText(/also requires/i)).not.toBeInTheDocument();
    expect(screen.queryByText('sub01.vhdr')).not.toBeInTheDocument();
  });

  it('applies alert border colour when pendingFiles are provided (partial load)', () => {
    const { container } = renderZone({ pendingFiles: [makeFile('sub01.vhdr')] });
    const zone = container.querySelector('div[class]');
    expect(zone.className).toContain('border-alert');
  });
});

describe('FileDropZone — drop interactions', () => {
  // Helper to get the outermost div of the drop zone (the element with drag handlers)
  const getZone = () => screen.getByText('Drop EEG files').closest('div[class]');

  it('calls onFiles when files are dropped', () => {
    renderZone();
    const file = makeFile('sub01.vhdr');
    fireEvent.drop(getZone(), { dataTransfer: { files: [file] } });
    expect(onFiles).toHaveBeenCalledOnce();
  });

  it('does not call onFiles when a drop has no files', () => {
    renderZone();
    fireEvent.drop(getZone(), { dataTransfer: { files: [] } });
    expect(onFiles).not.toHaveBeenCalled();
  });

  it('applies solid primary border while dragging over', () => {
    renderZone();
    fireEvent.dragOver(getZone());
    expect(getZone().className).toContain('border-solid');
    expect(getZone().className).toContain('border-primary');
  });

  it('restores dashed border and default colour when drag leaves', () => {
    renderZone();
    fireEvent.dragOver(getZone());
    fireEvent.dragLeave(getZone());
    expect(getZone().className).toContain('border-dashed');
    expect(getZone().className).toContain('border-border');
  });
});

describe('FileDropZone — compact mode', () => {
  it('renders only the icon and label, omitting description and drag instructions', () => {
    renderZone({ compact: true, label: 'Drop additional files', description: 'Should not show' });
    expect(screen.getByText('Drop additional files')).toBeInTheDocument();
    expect(screen.queryByText('Should not show')).not.toBeInTheDocument();
    expect(screen.queryByText(/drag & drop/i)).not.toBeInTheDocument();
  });

  it('still calls onFiles when files are dropped', () => {
    renderZone({ compact: true, label: 'Drop additional files' });
    const file = makeFile('sub01.vhdr');
    const zone = screen.getByText('Drop additional files').closest('div[class]');
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });
    expect(onFiles).toHaveBeenCalledOnce();
  });
});

describe('FileDropZone — file input', () => {
  it('calls onFiles when files are selected via the file input', () => {
    const { container } = renderZone();
    const input = container.querySelector('input[type="file"]');
    const file = makeFile('sub01.vhdr');
    fireEvent.change(input, { target: { files: [file] } });
    expect(onFiles).toHaveBeenCalledOnce();
  });

  it('does not call onFiles when the file input change has no files', () => {
    const { container } = renderZone();
    const input = container.querySelector('input[type="file"]');
    fireEvent.change(input, { target: { files: [] } });
    expect(onFiles).not.toHaveBeenCalled();
  });

  it('clicking the zone triggers the hidden file input', () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    renderZone();
    fireEvent.click(screen.getByText('Drop EEG files').closest('div[class]'));
    expect(clickSpy).toHaveBeenCalledOnce();
    clickSpy.mockRestore();
  });
});
