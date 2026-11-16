import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ColorBlindToggle } from '@/components/ColorBlindToggle';

// Mock the useColorBlindMode hook to control the colorblind state in tests
vi.mock('@/hooks/useColorBlindMode', () => ({
  useColorBlindMode: vi.fn(),
}));

import { useColorBlindMode } from '@/hooks/useColorBlindMode';

describe('ColorBlindToggle', () => {
  it('is not pressed and offers to turn the colorblind colormap on while off', () => {
    useColorBlindMode.mockReturnValue({ isColorBlindMode: false });
    render(<ColorBlindToggle />);
    const button = screen.getByRole('button', { name: /turn colorblind colormap on/i });
    expect(button).toHaveAttribute('aria-pressed', 'false');
  });

  it('is pressed and offers to turn the colorblind colormap off while on', () => {
    useColorBlindMode.mockReturnValue({ isColorBlindMode: true });
    render(<ColorBlindToggle />);
    const button = screen.getByRole('button', { name: /turn colorblind colormap off/i });
    expect(button).toHaveAttribute('aria-pressed', 'true');
  });

  it('calls toggleColorBlindMode when clicked', () => {
    const toggleColorBlindMode = vi.fn();
    useColorBlindMode.mockReturnValue({ isColorBlindMode: false, toggleColorBlindMode });
    render(<ColorBlindToggle />);
    fireEvent.click(screen.getByRole('button'));
    expect(toggleColorBlindMode).toHaveBeenCalledOnce();
  });
});
