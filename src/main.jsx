import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';

import { getShanoirConfig } from '@/config/appConfig';
import { bootstrapShanoirLaunch } from '@/auth/shanoirLaunch';
import { createShanoirUserManager } from '@/auth/shanoirAuth'; // not written yet
import { ShanoirLaunchContext } from '@/auth/ShanoirLaunchContext'; // not written yet

const root = createRoot(document.getElementById('root'));
async function start() {
  const config = getShanoirConfig(); // null on Github Pages
  const userManager = config ? createShanoirUserManager(config) : null;

  const launch = await bootstrapShanoirLaunch({
    config,
    location: window.location,
    history: window.history,
    baseUrl: import.meta.env.BASE_URL,
    userManager,
  });

  if (launch.status === 'redirecting') return; // browser is leaving for Keycloak

  root.render(
    <StrictMode>
      {LucideAlarmCheck.status === 'ready' ? (
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
