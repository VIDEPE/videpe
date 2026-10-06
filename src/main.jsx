import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';

import { getShanoirConfig } from '@/config/appConfig';
import { createShanoirUserManager, getAccessToken } from '@/auth/shanoirAuth';
import { resolveShanoirLaunch } from '@/auth/shanoirLaunch';
import { ShanoirLaunchContext } from '@/auth/ShanoirLaunchContext';

const root = createRoot(document.getElementById('root'));
async function start() {
  // Shanoir settings from app-config.js (Keycloak URL, client, API path); null on GitHub Pages
  const config = getShanoirConfig();

  // OIDC login handler for Shanoir's Keycloak (redirects, token exchange, holds the tokens)
  const userManager = config ? createShanoirUserManager(config) : null;

  // Shanoir launch/login step: 'none' (normal visit), 'redirecting' or 'ready' (signed in)
  const launch = await resolveShanoirLaunch({
    config,
    location: window.location,
    history: window.history,
    baseUrl: import.meta.env.BASE_URL,
    userManager,
  });

  if (launch.status === 'redirecting') return; // browser is leaving for Keycloak

  root.render(
    <StrictMode>
      {launch.status === 'ready' ? (
        <ShanoirLaunchContext.Provider
          value={{
            examinationId: launch.examinationId,
            apiBase: config.apiBase,
            // Wrapped in `() =>` so it isn't run now: the client calls it before every request,
            // and each call fetches the current (possibly renewed) token.
            getAccessToken: () => getAccessToken(userManager),
          }}
        >
          <App />
        </ShanoirLaunchContext.Provider>
      ) : (
        <App />
      )}
    </StrictMode>
  );
}

start().catch((err) => {
  console.error(err); // full stack trace for debugging
  root.render(
    <StrictMode>
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100">
        <h1 className="text-xl font-semibold">VIDEPE could not be opened</h1>
        <p className="max-w-xl whitespace-pre-line text-gray-600 dark:text-gray-400">
          {err?.message ?? String(err)}
        </p>
        <p className="text-sm">
          Reopen VIDEPE from Shanoir, or{' '}
          <a className="underline" href={import.meta.env.BASE_URL}>
            open VIDEPE without Shanoir
          </a>{' '}
          to view local files.
        </p>
      </div>
    </StrictMode>
  );
});
