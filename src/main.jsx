import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';

import { getShanoirConfig } from '@/config/appConfig';
import { createShanoirUserManager } from '@/auth/shanoirAuth';
import { resolveShanoirLaunch } from '@/auth/shanoirLaunch';
import { ShanoirLaunchContext } from '@/auth/ShanoirLaunchContext'; // not written yet

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
            getAccessToken: async () => (await userManager.geUser()).access_token,
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
  /* render a small error message instead of a blank page */
});
