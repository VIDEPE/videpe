import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider, useTheme } from '@/components/ThemeContext';

// Create a minimal component to observe context values in tests
const ThemeConsumer = () => {
  const { isDarkMode, toggleTheme } = useTheme();
  return (
    <div>
      <span data-testid="mode">{isDarkMode ? 'dark' : 'light'}</span> // display current mode for
      testing
      <button onClick={toggleTheme}>toggle</button> // button to trigger theme toggle in tests
    </div>
  );
};

// Helper to render the consumer within the provider for testing
const renderWithProvider = () =>
  render(
    <ThemeProvider>
      <ThemeConsumer />
    </ThemeProvider>
  );

// Mock for window.matchMedia to control system preference in tests
// window.matchMedia is used in ThemeProvider to determine the initial theme based on system preference.
const matchMediaMock = (matches) =>
  vi.fn().mockImplementation((query) => ({
    matches,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));

beforeEach(() => {
  // Clear localStorage and reset document classes before each test to ensure a clean slate
  localStorage.clear();
  document.documentElement.classList.remove('dark', 'light');
});

describe('ThemeProvider — initial state', () => {
  it('defaults to dark when OS prefers dark and no localStorage', () => {
    window.matchMedia = matchMediaMock(true); // Mock system preference to dark
    renderWithProvider();
    expect(screen.getByTestId('mode').textContent).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('defaults to light when OS prefers light and no localStorage', () => {
    window.matchMedia = matchMediaMock(false); // Mock system preference to light
    renderWithProvider();
    expect(screen.getByTestId('mode').textContent).toBe('light');
    expect(document.documentElement.classList.contains('light')).toBe(true);
  });

  it('respects saved dark preference in localStorage', () => {
    localStorage.setItem('theme', 'dark'); // Set localStorage to dark
    window.matchMedia = matchMediaMock(false); // Mock system preference to light, but localStorage should take precedence
    renderWithProvider();
    expect(screen.getByTestId('mode').textContent).toBe('dark');
  });

  it('respects saved light preference in localStorage', () => {
    localStorage.setItem('theme', 'light'); // Set localStorage to light
    window.matchMedia = matchMediaMock(true);
    renderWithProvider();
    expect(screen.getByTestId('mode').textContent).toBe('light');
  });
});

describe('ThemeProvider — toggle behaviour', () => {
  it('toggles from dark to light and saves to localStorage', () => {
    localStorage.setItem('theme', 'dark');
    window.matchMedia = matchMediaMock(false);
    renderWithProvider();

    // Simulate user clicking the toggle button to switch themes
    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByTestId('mode').textContent).toBe('light'); // Verify the displayed mode has changed to light
    expect(document.documentElement.classList.contains('light')).toBe(true); // Verify the light class is applied to the document
    expect(localStorage.getItem('theme')).toBe('light'); // Verify that the new theme preference is saved in localStorage
  });

  it('toggles from light to dark and saves to localStorage', () => {
    localStorage.setItem('theme', 'light');
    window.matchMedia = matchMediaMock(false);
    renderWithProvider();

    // Simulate user clicking the toggle button to switch themes
    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByTestId('mode').textContent).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('theme')).toBe('dark');
  });
});

describe('useTheme', () => {
  it('throws when used outside ThemeProvider', () => {
    // Spy on console.error to suppress expected error logs during this test
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Attempting to render the ThemeConsumer without wrapping it in ThemeProvider should throw an error
    expect(() => render(<ThemeConsumer />)).toThrow('useTheme must be used inside ThemeProvider');
    // Restore the original console.error implementation after the test
    spy.mockRestore();
  });
});
