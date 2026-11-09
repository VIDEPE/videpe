import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VidepeTitle } from '@/components/VidepeTitle';

describe('VidepeTitle', () => {
  it('renders a heading named VIDEPE', () => {
    render(<VidepeTitle />);
    // The revealed words are hidden from screen readers, so the heading's name stays the acronym
    expect(screen.getByRole('heading', { name: 'VIDEPE' })).toBeInTheDocument();
  });

  it('holds the full name, word by word, for the hover reveal', () => {
    const { container } = render(<VidepeTitle />);
    // textContent includes the (visually collapsed) expansions, so the letters + words read as the full name
    expect(container.querySelector('h1').textContent.replace(/\s+/g, ' ').trim()).toBe(
      'Visualization & Integration of Data for Epilepsy Presurgical Evaluation'
    );
  });

  it('renders as a span, not a heading, when asked (the decorative logo on the start-up pages)', () => {
    const { container } = render(<VidepeTitle as="span" />);
    expect(screen.queryByRole('heading')).toBeNull();
    expect(container.firstChild.tagName).toBe('SPAN');
  });

  // jsdom has no layout or media queries, so the breakpoint is checked on the reveal classes
  it('reveals the words from the md breakpoint by default', () => {
    const { container } = render(<VidepeTitle />);
    const word = container.querySelector('[aria-hidden="true"]');
    expect(word.className).toContain('md:group-hover/title:grid-cols-[1fr]');
  });

  it('reveals the words from a later breakpoint when asked (the header, with its side content)', () => {
    const { container } = render(<VidepeTitle revealFrom="xl" />);
    const word = container.querySelector('[aria-hidden="true"]');
    expect(word.className).toContain('xl:group-hover/title:grid-cols-[1fr]');
    expect(word.className).not.toContain('md:group-hover/title:grid-cols-[1fr]');
  });

  it('passes className through to the heading', () => {
    render(<VidepeTitle className="!mb-2" />);
    expect(screen.getByRole('heading', { name: 'VIDEPE' })).toHaveClass('!mb-2');
  });
});
