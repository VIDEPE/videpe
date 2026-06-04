import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ScrollToTopButton } from '@/components/ScrollToTopButton';

describe('ScrollToTopButton', () => {
  beforeEach(() => {
    window.scrollTo = vi.fn();
    Object.defineProperty(window, 'scrollY', { value: 0, writable: true, configurable: true });
  });

  const scrollTo = (y) =>
    act(() => {
      Object.defineProperty(window, 'scrollY', { value: y, writable: true, configurable: true });
      fireEvent.scroll(window);
    });

  it('is hidden when at the top', () => {
    render(<ScrollToTopButton />);
    expect(screen.queryByRole('button', { name: /scroll to top/i })).not.toBeInTheDocument();
  });

  it('appears after scrolling past the default threshold (200px)', () => {
    render(<ScrollToTopButton />);
    scrollTo(201);
    expect(screen.getByRole('button', { name: /scroll to top/i })).toBeInTheDocument();
  });

  it('disappears when scrolling back above the threshold', () => {
    render(<ScrollToTopButton />);
    scrollTo(300);
    scrollTo(50);
    expect(screen.queryByRole('button', { name: /scroll to top/i })).not.toBeInTheDocument();
  });

  it('scrolls to top when clicked', () => {
    render(<ScrollToTopButton />);
    scrollTo(300);
    fireEvent.click(screen.getByRole('button', { name: /scroll to top/i }));
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });

  it('respects a custom threshold', () => {
    render(<ScrollToTopButton threshold={500} />);
    scrollTo(300);
    expect(screen.queryByRole('button', { name: /scroll to top/i })).not.toBeInTheDocument();
    scrollTo(600);
    expect(screen.getByRole('button', { name: /scroll to top/i })).toBeInTheDocument();
  });
});
