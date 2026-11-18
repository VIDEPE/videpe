import { createContext } from 'react';

// This file provides a ColorBlindContext to switch every diverging voltage colormap in the app
// (EEG topography mesh + markers, electrode matrix, 3D connectome voltages) between
// blue-white-red and the colorblind-safe cividis variant. Same three-piece setup as the
// light/dark theme — see ThemeContext.js for how the pieces connect:
// createContext()     1. creates the container                     (this file)
// <Context.Provider>  2. fills the container with values           (ColorBlindProvider.jsx)
// useContext()        3. any component reads from the container    (hooks/useColorBlindMode.js)

// 1. Create the Context
// Holds the current colorblind mode and a function to toggle it, which can be accessed by any
// component that calls useColorBlindMode().
export const ColorBlindContext = createContext(null);
