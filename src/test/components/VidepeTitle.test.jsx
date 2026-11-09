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

  it('passes className through to the heading', () => {
    render(<VidepeTitle className="!mb-2" />);
    expect(screen.getByRole('heading', { name: 'VIDEPE' })).toHaveClass('!mb-2');
  });
});
