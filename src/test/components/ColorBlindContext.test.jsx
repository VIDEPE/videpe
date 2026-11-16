import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ColorBlindProvider } from '@/components/ColorBlindProvider';
import { useColorBlindMode } from '@/hooks/useColorBlindMode';

// Create a minimal component to observe context values in tests
const ColorBlindConsumer = () => {
  const { isColorBlindMode, toggleColorBlindMode } = useColorBlindMode();
  return (
    <div>
      {/* display current mode for testing */}
      <span data-testid="mode">{isColorBlindMode ? 'on' : 'off'}</span>
      {/* button to trigger the toggle in tests */}
      <button onClick={toggleColorBlindMode}>toggle</button>
    </div>
  );
};

// Helper to render the consumer within the provider for testing
const renderWithProvider = () =>
  render(
    <ColorBlindProvider>
      <ColorBlindConsumer />
    </ColorBlindProvider>
  );

beforeEach(() => {
  // Clear localStorage before each test to ensure a clean slate
  localStorage.clear();
});

describe('ColorBlindProvider — initial state', () => {
  it('defaults to off when nothing is saved in localStorage', () => {
    renderWithProvider();
    expect(screen.getByTestId('mode').textContent).toBe('off');
  });

  it('respects a saved "on" preference in localStorage', () => {
    localStorage.setItem('colorBlindMode', 'on');
    renderWithProvider();
    expect(screen.getByTestId('mode').textContent).toBe('on');
  });

  it('respects a saved "off" preference in localStorage', () => {
    localStorage.setItem('colorBlindMode', 'off');
    renderWithProvider();
    expect(screen.getByTestId('mode').textContent).toBe('off');
  });
});

describe('ColorBlindProvider — toggle behaviour', () => {
  it('toggles from off to on and saves to localStorage', () => {
    renderWithProvider();
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByTestId('mode').textContent).toBe('on');
    expect(localStorage.getItem('colorBlindMode')).toBe('on');
  });

  it('toggles from on to off and saves to localStorage', () => {
    localStorage.setItem('colorBlindMode', 'on');
    renderWithProvider();
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByTestId('mode').textContent).toBe('off');
    expect(localStorage.getItem('colorBlindMode')).toBe('off');
  });
});

describe('useColorBlindMode', () => {
  it('throws when used outside ColorBlindProvider', () => {
    // Spy on console.error to suppress expected error logs during this test
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<ColorBlindConsumer />)).toThrow(
      'useColorBlindMode must be used inside ColorBlindProvider'
    );
    spy.mockRestore();
  });
});
