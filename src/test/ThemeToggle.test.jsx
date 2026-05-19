import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeToggle } from '@/components/ThemeToggle';

// Mock the useTheme hook to control the theme state in tests
// This says: whenever anything in this test file imports from @/components/ThemeContext,
// give them { useTheme: vi.fn() } instead of the real module
vi.mock('@/components/ThemeContext', () => ({
  useTheme: vi.fn(),
}));

// Only now that we've mocked useTheme can we import it to set its return value in our tests
import { useTheme } from '@/components/ThemeContext';

describe('ThemeToggle', () => {
  it('shows switch-to-light label in dark mode', () => {
    // mockReturnValue says "when this fake function is called, return this object with isDarkMode: true"
    useTheme.mockReturnValue({ isDarkMode: true });
    render(<ThemeToggle />);
    // Check that the button has the correct label for dark mode
    expect(screen.getByRole('button', { name: /switch to light mode/i })).toBeInTheDocument();
  });

  it('shows switch-to-dark label in light mode', () => {
    // Set the mock to return light mode
    useTheme.mockReturnValue({ isDarkMode: false });
    render(<ThemeToggle />);
    // Check that the button has the correct label for light mode
    expect(screen.getByRole('button', { name: /switch to dark mode/i })).toBeInTheDocument();
  });

  it('calls toggleTheme when clicked', () => {
    // Create a mock function for toggleTheme so we can check if it was called
    const toggleTheme = vi.fn();
    useTheme.mockReturnValue({ toggleTheme });
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole('button'));
    expect(toggleTheme).toHaveBeenCalledOnce();
  });
});
