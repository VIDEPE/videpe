import { createContext, useContext } from 'react';

// Shared "channel" for the Shanoir session — a signed-in connection to Shanoir, for one
// examination. main.jsx puts { client, examinationId } into it (via
// <ShanoirSessionContext.Provider>) after a successful Shanoir sign-in, and components inside
// the app read it with useShanoirSession() below.
//
// Why a separate file: the provider (main.jsx) and every reader must use the very same
// context object — two createContext() calls would create two unconnected channels. It can't
// live in main.jsx (components importing the app's entry file would be a circular import), so
// it's created once here, where both sides can import it.
//
// Default value null = not launched from Shanoir (e.g. the GitHub Pages build, or a normal
// visit): no provider is rendered then, so readers get this default.
export const ShanoirSessionContext = createContext(null);

/**
 * Reads the Shanoir session from ShanoirSessionContext, so components don't need to import the
 * context object or useContext themselves.
 *
 * @returns {{ client: ReturnType<import('@/shanoir/shanoirClient').createShanoirClient>,
 *   examinationId: number }|null} the signed-in Shanoir client and the examination to load,
 *   or null when VIDEPE wasn't launched from Shanoir.
 */
export const useShanoirSession = () => useContext(ShanoirSessionContext);
