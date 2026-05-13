import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeToggle } from '@/components/ThemeToggle';

const matchMediaMock = (matches) =>
  vi.fn().mockImplementation((query) => ({
    matches,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('dark', 'light');
});

describe('ThemeToggle — initial state', () => {
  it('defaults to dark when OS prefers dark and no localStorage', () => {
    window.matchMedia = matchMediaMock(true);
    render(<ThemeToggle />);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('defaults to light when OS prefers light and no localStorage', () => {
    window.matchMedia = matchMediaMock(false);
    render(<ThemeToggle />);
    expect(document.documentElement.classList.contains('light')).toBe(true);
  });

  it('respects saved dark preference in localStorage', () => {
    localStorage.setItem('theme', 'dark');
    window.matchMedia = matchMediaMock(false);
    render(<ThemeToggle />);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('respects saved light preference in localStorage', () => {
    localStorage.setItem('theme', 'light');
    window.matchMedia = matchMediaMock(true);
    render(<ThemeToggle />);
    expect(document.documentElement.classList.contains('light')).toBe(true);
  });
});

describe('ThemeToggle — toggle behaviour', () => {
  it('toggles from dark to light on click', () => {
    localStorage.setItem('theme', 'dark');
    window.matchMedia = matchMediaMock(false);
    render(<ThemeToggle />);

    fireEvent.click(screen.getByRole('button'));

    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(localStorage.getItem('theme')).toBe('light');
  });

  it('toggles from light to dark on click', () => {
    localStorage.setItem('theme', 'light');
    window.matchMedia = matchMediaMock(false);
    render(<ThemeToggle />);

    fireEvent.click(screen.getByRole('button'));

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.classList.contains('light')).toBe(false);
    expect(localStorage.getItem('theme')).toBe('dark');
  });
});