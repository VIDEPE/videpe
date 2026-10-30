import { useState, useEffect } from 'react';
import { ThemeContext } from '@/components/ThemeContext';

// Step 2 of the light/dark mode theme — see ThemeContext.js for how the three pieces connect.

const getInitialDark = () => {
  // Check localStorage first, then system preference
  const stored = localStorage.getItem('theme');
  if (stored === 'dark') return true;
  if (stored === 'light') return false;
  // If not localStorage theme found => Default to system preference
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
};

// 2. Create the Provider Component
export const ThemeProvider = ({ children }) => {
  const [isDarkMode, setIsDarkMode] = useState(getInitialDark);

  useEffect(() => {
    // Apply the theme class to the <html> element
    const html = document.documentElement;
    if (isDarkMode) {
      html.classList.add('dark');
      html.classList.remove('light');
    } else {
      html.classList.add('light');
      html.classList.remove('dark');
    }
  }, [isDarkMode]);

  const toggleTheme = () => {
    const next = !isDarkMode;
    localStorage.setItem('theme', next ? 'dark' : 'light');
    setIsDarkMode(next);
  };

  return (
    // Fill the context with the current theme state and the toggle function,
    // so any component can access it via useTheme()
    //
    // - ThemeContext.Provider — the actual container. Any component inside it can access the value
    // - value={{ isDarkMode, toggleTheme }} — what gets shared. Any component calling useTheme() receives exactly this object
    // - {children} — everything wrapped inside <ThemeProvider> in App.jsx — the entire app
    <ThemeContext.Provider value={{ isDarkMode, toggleTheme }}>{children}</ThemeContext.Provider>
  );
};
