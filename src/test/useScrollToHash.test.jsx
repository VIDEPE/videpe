import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useScrollToHash } from '@/utils/useScrollToHash';

describe('useScrollToHash', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not query the DOM when there is no hash', () => {
    const querySpy = vi.spyOn(document, 'querySelector');
    const wrapper = ({ children }) => (
      <MemoryRouter initialEntries={['/about']}>{children}</MemoryRouter>
    );
    renderHook(() => useScrollToHash(), { wrapper });
    expect(querySpy).not.toHaveBeenCalled();
  });

  it('scrolls to the matching element when a hash is present', () => {
    const mockEl = { scrollIntoView: vi.fn() };
    vi.spyOn(document, 'querySelector').mockReturnValue(mockEl);
    const wrapper = ({ children }) => (
      <MemoryRouter initialEntries={['/about#team']}>{children}</MemoryRouter>
    );
    renderHook(() => useScrollToHash(), { wrapper });
    expect(document.querySelector).toHaveBeenCalledWith('#team');
    expect(mockEl.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth' });
  });

  it('does nothing when the hash does not match any element', () => {
    vi.spyOn(document, 'querySelector').mockReturnValue(null);
    const wrapper = ({ children }) => (
      <MemoryRouter initialEntries={['/about#nonexistent']}>{children}</MemoryRouter>
    );
    expect(() => renderHook(() => useScrollToHash(), { wrapper })).not.toThrow();
  });
});
