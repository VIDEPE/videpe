import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
  it('renders the logo', () => {
    renderPage();
    expect(screen.getByAltText(/vidépé logo/i)).toBeInTheDocument();
  });

  it('renders the Get Started button', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /get started/i })).toBeInTheDocument();
  });

  it('renders the Documentation section', () => {
    renderPage();
    expect(screen.getByText('Documentation')).toBeInTheDocument();
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
