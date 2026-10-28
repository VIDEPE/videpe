import { createContext, useContext } from 'react';

// Shared "channel" for the host-app session — one launch from a host app (e.g. a local Python
// app). main.jsx puts { client, appName } into it (via <HostAppSessionContext.Provider>) after
// a successful launch, and components inside the app read it with useHostAppSession() below.
// The host-app counterpart of ShanoirSessionContext.
//
// Why a separate file: the provider (main.jsx) and every reader must use the very same
// context object — two createContext() calls would create two unconnected channels. It can't
// live in main.jsx (components importing the app's entry file would be a circular import), so
// it's created once here, where both sides can import it.
//
// Default value null = not launched from a host app (e.g. the GitHub Pages build, or a normal
// visit): no provider is rendered then, so readers get this default.
export const HostAppSessionContext = createContext(null);

/**
 * Reads the host-app session from HostAppSessionContext, so components don't need to import
 * the context object or useContext themselves.
 *
 * @returns {{ client: ReturnType<import('@/hostApp/hostAppClient').createHostAppClient>,
 *   appName: string }|null} the client for this launch and the host app's name, or null when
 *   VIDEPE wasn't launched from a host app.
 */
export const useHostAppSession = () => useContext(HostAppSessionContext);
