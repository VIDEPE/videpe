import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EEGTypeToggle } from '@/components/EEGTypeToggle';

describe('EEGTypeToggle', () => {
  it('is unchecked when recordingType is eeg', () => {
    render(<EEGTypeToggle recordingType="eeg" onChange={vi.fn()} />);
    expect(screen.getByRole('switch', { name: /recording type/i })).toHaveAttribute(
      'aria-checked',
      'false'
    );
  });

  it('is checked when recordingType is ieeg', () => {
    render(<EEGTypeToggle recordingType="ieeg" onChange={vi.fn()} />);
    expect(screen.getByRole('switch', { name: /recording type/i })).toHaveAttribute(
      'aria-checked',
      'true'
    );
  });

  it('calls onChange with ieeg when clicked while on eeg', () => {
    const onChange = vi.fn();
    render(<EEGTypeToggle recordingType="eeg" onChange={onChange} />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith('ieeg');
  });

  it('calls onChange with eeg when clicked while on ieeg', () => {
    const onChange = vi.fn();
    render(<EEGTypeToggle recordingType="ieeg" onChange={onChange} />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith('eeg');
  });
});
