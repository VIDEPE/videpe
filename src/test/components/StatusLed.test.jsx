import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusLed } from '@/components/StatusLed';

vi.mock('@/components/ThemeContext', () => ({
  useTheme: vi.fn(),
}));

import { useTheme } from '@/components/ThemeContext';

// Returns the dot span (aria-hidden, carries the color class) inside the LED with this title.
const getDot = (title) => screen.getByTitle(title).querySelector('span');

describe('StatusLed — disabled', () => {
  it('shows a grey dot and the "not applicable" title, regardless of fileName', () => {
    useTheme.mockReturnValue({ isDarkMode: false });
    render(<StatusLed label="Inverse Solution" fileName="my_file" disabled />);

    const dot = getDot('Inverse Solution is not applicable for iEEG recordings');
    expect(dot).toHaveClass('bg-foreground/20');
  });
});

describe('StatusLed — no match-count concept (e.g. Inverse Solution)', () => {
  it('shows red and "No {label} loaded" when nothing is loaded', () => {
    useTheme.mockReturnValue({ isDarkMode: false });
    render(<StatusLed label="Inverse Solution" fileName={null} />);

    const dot = getDot('No inverse solution loaded');
    expect(dot).toHaveClass('bg-red-600/50');
  });

  it('shows green and the plain filename when loaded — no amber fallback without a matchCount', () => {
    useTheme.mockReturnValue({ isDarkMode: false });
    render(<StatusLed label="Inverse Solution" fileName="my_solution" />);

    const dot = getDot('my_solution');
    expect(dot).toHaveClass('bg-green-500');
  });
});

describe('StatusLed — with a match-count concept (e.g. Electrode Position)', () => {
  it('shows blue and the standard-template title when no file is loaded but the match is good', () => {
    useTheme.mockReturnValue({ isDarkMode: false });
    render(
      <StatusLed
        label="Electrode Position"
        fileName={null}
        matchCount={19}
        totalCount={32}
        isGoodMatch
      />
    );

    const dot = getDot('Using fsaverage_1005 (FreeSurfer) template (19/32 channels matched)');
    expect(dot).toHaveClass('bg-blue-500');
  });

  it('shows red and still reports the count when no file is loaded and the match is poor', () => {
    useTheme.mockReturnValue({ isDarkMode: false });
    render(
      <StatusLed
        label="Electrode Position"
        fileName={null}
        matchCount={1}
        totalCount={208}
        isGoodMatch={false}
      />
    );

    const dot = getDot('Using fsaverage_1005 template (1/208 channels matched)');
    expect(dot).toHaveClass('bg-red-600/50');
  });

  it('shows green and "Custom:" plus the count when a file is loaded and the match is good', () => {
    useTheme.mockReturnValue({ isDarkMode: false });
    render(
      <StatusLed
        label="Electrode Position"
        fileName="my_positions"
        matchCount={3}
        totalCount={3}
        isGoodMatch
      />
    );

    const dot = getDot('Custom: my_positions (3/3 channels matched)');
    expect(dot).toHaveClass('bg-green-500');
  });

  it('shows amber and "Custom:" plus the count when a file is loaded but the match is poor', () => {
    useTheme.mockReturnValue({ isDarkMode: false });
    render(
      <StatusLed
        label="Electrode Position"
        fileName="my_positions"
        matchCount={1}
        totalCount={3}
        isGoodMatch={false}
      />
    );

    const dot = getDot('Custom: my_positions (1/3 channels matched)');
    expect(dot).toHaveClass('bg-amber-500');
  });
});

describe('StatusLed — dark mode', () => {
  it('uses the dark-mode color variants', () => {
    useTheme.mockReturnValue({ isDarkMode: true });
    render(
      <StatusLed
        label="Electrode Position"
        fileName="my_positions"
        matchCount={3}
        totalCount={3}
        isGoodMatch
      />
    );

    const dot = getDot('Custom: my_positions (3/3 channels matched)');
    expect(dot).toHaveClass('bg-green-400');
  });
});
