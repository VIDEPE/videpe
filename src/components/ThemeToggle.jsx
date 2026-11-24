import { Sun, Moon } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';

export const ThemeToggle = ({ className = 'fixed top-5 right-5 z-50' }) => {
  const { isDarkMode, toggleTheme } = useTheme();
  // Shared by aria-label and title (hover tooltip), since the icon alone doesn't say what clicking does
  const label = isDarkMode ? 'Switch to light mode' : 'Switch to dark mode';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={`${className} button-bare p-2`}
      aria-label={label}
      title={label}
      aria-pressed={isDarkMode}
    >
      {isDarkMode ? (
        <Moon className="h-7 w-7" style={{ stroke: 'rgba(253, 224, 71, 1)' }} />
      ) : (
        <Sun className="h-7 w-7" style={{ stroke: 'rgba(29, 78, 216, 1)' }} />
      )}
    </button>
  );
};
