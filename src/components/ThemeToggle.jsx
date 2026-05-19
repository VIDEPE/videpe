import { Sun, Moon } from 'lucide-react';
import { useTheme } from '@/components/ThemeContext';

export const ThemeToggle = () => {
  const { isDarkMode, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      className="fixed top-5 right-5 z-50 p-2 rounded-full"
      aria-label={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {isDarkMode ? (
        <Moon className="h-7 w-7" style={{ stroke: 'rgba(253, 224, 71, 1)' }} />
      ) : (
        <Sun className="h-7 w-7" style={{ stroke: 'rgba(29, 78, 216, 1)' }} />
      )}
    </button>
  );
};
