import { createContext } from 'react';

// This file provides a ThemeContext to manage light/dark mode across the app.
// How the three pieces connect:
// createContext()     1. creates the container                     (this file)
// <Context.Provider>  2. fills the container with values           (ThemeProvider.jsx)
// useContext()        3. any component reads from the container    (hooks/useTheme.js)
// They live in separate files because React Fast Refresh can only hot-swap a file that exports
// nothing but components — mixing in the context or the hook forces a full page reload instead.

// 1. Create the Context
// createContext creates a sort of global variable that Reacts manages for you.
// It holds the current theme state and a function to toggle it, which can be accessed by any
// component that calls useTheme().
export const ThemeContext = createContext(null);
