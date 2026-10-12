import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AboutPage } from '@/pages/AboutPage';

vi.mock('@/components/ThemeToggle', () => ({
  ThemeToggle: () => null,
}));

vi.mock('@/components/Footer', () => ({
  Footer: () => <footer data-testid="footer" />,
}));

const renderPage = () =>
  render(
    <MemoryRouter>
      <AboutPage />
    </MemoryRouter>
  );

// Same ORCIDs as in CITATION.cff
const TEAM_ORCIDS = {
  'Jeroen Buil': '0009-0005-6448-0650',
  'Nicolas Roehri': '0000-0002-6948-1055',
  'Isotta Rigoni': '0000-0002-5804-2137',
  'Serge Vulliémoz': '0000-0002-1877-8625',
};

describe('AboutPage — team', () => {
  it.each(Object.entries(TEAM_ORCIDS))("links %s's ORCID profile", (name, orcid) => {
    renderPage();
    // The card names include titles ("Dr. Jeroen Buil"), so match the name within the label
    const link = screen.getByRole('link', { name: new RegExp(`ORCID profile of .*${name}`) });
    expect(link).toHaveAttribute('href', `https://orcid.org/${orcid}`);
    expect(link).toHaveAttribute('target', '_blank');
  });
});
