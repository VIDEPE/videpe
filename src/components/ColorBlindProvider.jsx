import { useState } from 'react';
import { ColorBlindContext } from '@/components/ColorBlindContext';

// Step 2 of the colorblind mode — see ColorBlindContext.js for how the three pieces connect.

// localStorage key — the preference survives reloads, like the light/dark theme
const STORAGE_KEY = 'colorBlindMode';

// Off unless the user turned it on before — there's no OS-level preference to fall back to
const getInitialColorBlindMode = () => localStorage.getItem(STORAGE_KEY) === 'on';

// 2. Create the Provider Component
export const ColorBlindProvider = ({ children }) => {
  const [isColorBlindMode, setIsColorBlindMode] = useState(getInitialColorBlindMode);

  const toggleColorBlindMode = () => {
    const next = !isColorBlindMode;
    localStorage.setItem(STORAGE_KEY, next ? 'on' : 'off');
    setIsColorBlindMode(next);
  };

  return (
    // Fill the context with the current mode and the toggle function, so any component can
    // access it via useColorBlindMode() — {children} is everything wrapped inside
    // <ColorBlindProvider> in App.jsx, i.e. the entire app
    <ColorBlindContext.Provider value={{ isColorBlindMode, toggleColorBlindMode }}>
      {children}
    </ColorBlindContext.Provider>
  );
};
