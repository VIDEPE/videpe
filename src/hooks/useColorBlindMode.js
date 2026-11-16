import { useContext } from 'react';
import { ColorBlindContext } from '@/components/ColorBlindContext';

// 3. Custom Hook for easy access to the ColorBlindContext values (isColorBlindMode and
// toggleColorBlindMode). See ColorBlindContext.js for how the three pieces connect.
export const useColorBlindMode = () => {
  const context = useContext(ColorBlindContext);
  if (!context) throw new Error('useColorBlindMode must be used inside ColorBlindProvider');
  return context;
};
