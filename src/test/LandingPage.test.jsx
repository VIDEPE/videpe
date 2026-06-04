import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LandingPage } from '@/pages/LandingPage';

vi.mock('@/components/ThemeToggle', () => ({
  ThemeToggle: () => null,
}));

vi.mock('@/components/Footer', () => ({
  Footer: () => <footer data-testid="footer" />,
}));

const renderPage = () =>
  render(
    <MemoryRouter>
      <LandingPage />
    </MemoryRouter>
  );

describe('LandingPage', () => {
  it('renders the VIDEPE heading', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /videpe/i })).toBeInTheDocument();
  });

  it('renders the Get Started button', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /get started/i })).toBeInTheDocument();
  });

  it('renders the Learn more section', () => {
    renderPage();
    expect(screen.getByText('Learn more')).toBeInTheDocument();
  });

  it('renders the Connect with us section', () => {
    renderPage();
    expect(screen.getByText('Connect with us')).toBeInTheDocument();
  });

  it('renders GitHub and UNIGE links', () => {
    renderPage();
    expect(screen.getByRole('link', { name: /github/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /unige/i })).toBeInTheDocument();
  });

  it('renders the footer', () => {
    renderPage();
    expect(screen.getByTestId('footer')).toBeInTheDocument();
  });
});

describe('LandingPage — feature cards', () => {
  // setup.js mocks matchMedia to return matches: false for all queries,
  // so (hover: hover) → false, which simulates a touch/mobile device and
  // enables the tap-to-expand behaviour in these tests

  it('renders 8 feature cards', () => {
    renderPage();
    // Each label appears twice in the DOM: once in the static card, once in the overlay
    expect(document.querySelectorAll('.group')).toHaveLength(8);
  });

  it('each card has a "Learn more →" link pointing to a feature anchor on the about page', () => {
    renderPage();
    const links = screen.getAllByText('Learn more →');
    expect(links).toHaveLength(8);
    links.forEach((link) => {
      expect(link.closest('a').getAttribute('href')).toMatch(/\/about#feature-/);
    });
  });

  it('overlay is collapsed by default', () => {
    renderPage();
    const firstCard = document.querySelectorAll('.group')[0];
    const overlay = firstCard.children[1];
    expect(overlay.className).toContain('opacity-0');
  });

  it('tapping a card expands its overlay', () => {
    renderPage();
    const firstCard = document.querySelectorAll('.group')[0];
    const overlay = firstCard.children[1];

    fireEvent.click(firstCard);

    expect(overlay.className).toContain('opacity-100');
    expect(overlay.className).not.toContain('opacity-0');
  });

  it('tapping an expanded card collapses it again', () => {
    renderPage();
    const firstCard = document.querySelectorAll('.group')[0];
    const overlay = firstCard.children[1];

    fireEvent.click(firstCard); // expand
    fireEvent.click(firstCard); // collapse

    expect(overlay.className).toContain('opacity-0');
  });

  it('tapping a second card collapses the first', () => {
    renderPage();
    const cards = document.querySelectorAll('.group');
    const firstOverlay = cards[0].children[1];
    const secondOverlay = cards[1].children[1];

    fireEvent.click(cards[0]); // expand first
    expect(firstOverlay.className).toContain('opacity-100');

    fireEvent.click(cards[1]); // expand second — first should collapse
    expect(secondOverlay.className).toContain('opacity-100');
    expect(firstOverlay.className).toContain('opacity-0');
  });
});
