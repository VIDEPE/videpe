import { useContext } from 'react';
import { ThemeContext } from '@/components/ThemeContext';

// 3. Create a Custom Hook for easy access to the ThemeContext values (isDarkMode and toggleTheme).
// See ThemeContext.js for how the three pieces connect.
export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside ThemeProvider');
  return context;
};
