import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VidepeLogo, ResearchUseBadge } from '@/components/VidepeLogo';
import DISCLAIMER_TEXT from '@/assets/ruo_disclaimer.txt?raw';

// The badge's button, and the card it opens (found through the button's aria-controls)
const getBadge = () => screen.getByRole('button', { name: /for research use only/i });
const getCard = () => document.getElementById(getBadge().getAttribute('aria-controls'));

describe('ResearchUseBadge', () => {
  it('starts closed, with the disclaimer card hidden', () => {
    render(<ResearchUseBadge />);
    expect(getBadge()).toHaveAttribute('aria-expanded', 'false');
    expect(getCard()).toHaveAttribute('aria-hidden', 'true');
  });

  it('opens the disclaimer card on click', () => {
    render(<ResearchUseBadge />);
    fireEvent.click(getBadge());
    expect(getBadge()).toHaveAttribute('aria-expanded', 'true');
    expect(getCard()).toHaveAttribute('aria-hidden', 'false');
    // the text file's line breaks render as spaces, like toHaveTextContent's normalized text
    expect(getCard()).toHaveTextContent(DISCLAIMER_TEXT.replace(/\s+/g, ' ').trim());
  });

  it('closes again on a second click', () => {
    render(<ResearchUseBadge />);
    fireEvent.click(getBadge());
    fireEvent.click(getBadge());
    expect(getBadge()).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes on a click outside the badge', () => {
    render(<ResearchUseBadge />);
    fireEvent.click(getBadge());
    fireEvent.click(document.body);
    expect(getBadge()).toHaveAttribute('aria-expanded', 'false');
  });

  it('stays open on a click inside the card, so the text can be selected', () => {
    render(<ResearchUseBadge />);
    fireEvent.click(getBadge());
    fireEvent.click(getCard());
    expect(getBadge()).toHaveAttribute('aria-expanded', 'true');
  });

  it('closes on Escape', () => {
    render(<ResearchUseBadge />);
    fireEvent.click(getBadge());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(getBadge()).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('VidepeLogo', () => {
  // The Shanoir/host-app start-up pages render it outside the router (see main.jsx)
  it('renders without a router', () => {
    render(<VidepeLogo />);
    expect(getBadge()).toBeInTheDocument();
  });

  it('keeps the badge readable by screen readers when the rest of the logo is decorative', () => {
    render(<VidepeLogo />);
    expect(getBadge().closest('[aria-hidden="true"]')).toBeNull();
  });
});
