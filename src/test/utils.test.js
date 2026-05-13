import { describe, it, expect, vi } from 'vitest';
import { cn, handleScrollToSection, handleNavigation } from '@/lib/utils';

describe('cn', () => {
  it('combines class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar');
  });

  it('ignores falsy values', () => {
    expect(cn('foo', false && 'bar', null, undefined)).toBe('foo');
  });

  it('resolves conflicting Tailwind classes — last one wins', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
  });

  it('handles conditional classes', () => {
    expect(cn('base', true && 'active')).toBe('base active');
    expect(cn('base', false && 'active')).toBe('base');
  });
});

describe('handleScrollToSection', () => {
  it('scrolls to the element with the given id', () => {
    const scrollIntoView = vi.fn();
    document.body.innerHTML = '<div id="hero"></div>';
    document.getElementById('hero').scrollIntoView = scrollIntoView;

    handleScrollToSection('hero');

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
  });

  it('does nothing if element does not exist', () => {
    document.body.innerHTML = '';
    expect(() => handleScrollToSection('missing')).not.toThrow();
  });
});

describe('handleNavigation', () => {
  it('scrolls to section for hash links', () => {
    const scrollIntoView = vi.fn();
    document.body.innerHTML = '<div id="hero"></div>';
    document.getElementById('hero').scrollIntoView = scrollIntoView;

    const event = { preventDefault: vi.fn() };
    const navigate = vi.fn();

    handleNavigation(event, '#hero', navigate);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(scrollIntoView).toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('calls navigate for page links', () => {
    const event = { preventDefault: vi.fn() };
    const navigate = vi.fn();

    handleNavigation(event, '/about', navigate);

    expect(navigate).toHaveBeenCalledWith('/about');
  });
});
