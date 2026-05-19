import { createContext, useContext, useState, useEffect } from 'react';

// This file provides a ThemeContext to manage light/dark mode across the app.
// How the three pieces connect:
// createContext()     1. creates the container
// <Context.Provider>  2. fills the container with values
// useContext()        3. any component reads from the container

// 1. Create the Context
// createContext creates a sort of global variable that Reacts manages for you.
// It holds the current theme state and a function to toggle it, which can be accessed by any
// component that calls useTheme().
const ThemeContext = createContext(null);

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

// 3. Create a Custom Hook for easy access to the ThemeContext values (isDarkMode and toggleTheme).
export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside ThemeProvider');
  return context;
};
