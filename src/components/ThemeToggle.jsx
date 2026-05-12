import { useState, useEffect } from 'react';
import { Sun, Moon } from 'lucide-react';

const getInitialDark = () => {
  const stored = localStorage.getItem('theme');
  if (stored === 'dark') return true;
  if (stored === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
};

export const ThemeToggle = () => {
  const [isDark, setIsDark] = useState(getInitialDark);

  useEffect(() => {
    const html = document.documentElement;
    if (isDark) {
      html.classList.add('dark');
      html.classList.remove('light');
    } else {
      html.classList.add('light');
      html.classList.remove('dark');
    }
  }, [isDark]);

  const toggle = () => {
    const next = !isDark;
    localStorage.setItem('theme', next ? 'dark' : 'light');
    setIsDark(next);
  };

  return (
    <button
      onClick={toggle}
      className="fixed top-5 right-5 z-50 p-2 rounded-full"
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      <span className={isDark ? 'text-yellow-300' : 'text-blue-900'}>
        {isDark ? <Moon className="h-7 w-7" /> : <Sun className="h-7 w-7" />}
      </span>
    </button>
  );
};
