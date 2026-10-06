import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';

import { getShanoirConfig } from '@/config/appConfig';
import { createShanoirUserManager, getAccessToken } from '@/auth/shanoirAuth';
import { resolveShanoirLaunch } from '@/auth/shanoirLaunch';
import { ShanoirSessionContext } from '@/auth/ShanoirSessionContext';

import { ShanoirErrorPage, ShanoirSignInPage } from '@/pages/ShanoirLaunchPages';

import { createShanoirClient } from './loaders/shanoirClient.js';

const root = createRoot(document.getElementById('root'));
async function start() {
  // Shanoir settings from app-config.js (Keycloak URL, client, API path); null on GitHub Pages
  const config = getShanoirConfig();

  // OIDC login handler for Shanoir's Keycloak (redirects, token exchange, holds the tokens)
  const userManager = config ? createShanoirUserManager(config) : null;

  // Show the sign-in screen only for an actual launch (launch link or Keycloak callback),
  // so normal visits — and the GitHub Pages build — start exactly as before
  const isLaunching = config && /[?&](examinationId|code|error)=/.test(window.location.search);
  if (isLaunching) root.render(<ShanoirSignInPage />);

  // Shanoir launch/login step: 'none' (normal visit), 'redirecting' or 'ready' (signed in)
  const launch = await resolveShanoirLaunch({
    config,
    location: window.location,
    history: window.history,
    baseUrl: import.meta.env.BASE_URL,
    userManager,
  });

  if (launch.status === 'redirecting') return; // browser is leaving for Keycloak

  const client =
    launch.status === 'ready'
      ? // getAccessToken wrapped in `() =>` so it isn't run now: the client calls it before every request,
        // and each call fetches the current (possibly renewed) token.
        createShanoirClient({
          apiBase: config.apiBase,
          getAccessToken: () => getAccessToken(userManager),
        })
      : null;

  root.render(
    <StrictMode>
      {launch.status === 'ready' ? (
        <ShanoirSessionContext.Provider
          value={{
            client: client,
            examinationId: launch.examinationId,
          }}
        >
          <App />
        </ShanoirSessionContext.Provider>
      ) : (
        <App />
      )}
    </StrictMode>
  );
}

// Dev-only preview of the start-up screens, to check how they look without a Shanoir setup:
// open /videpe/?preview=signin or /videpe/?preview=error under `npm run dev`.
// import.meta.env.DEV is false in production builds, so Vite strips this out entirely.
//
// http://localhost:5173/videpe/?preview=error
// └┬─┘   └───┬───┘ └┬─┘└──┬───┘└─────┬──────┘
// protocol hostname port pathname  search
//
// There's no `#…` part in this URL, so location.hash is ''.
const preview = import.meta.env.DEV && new URLSearchParams(window.location.search).get('preview');

if (preview === 'signin') {
  // in Dev mode and there is a preview search key => only render that preview page
  root.render(<ShanoirSignInPage />);
} else if (preview === 'error') {
  root.render(
    <ShanoirErrorPage
      error={new Error('EXAMPLE ERROR: Shanoir sign-in has expired, reopen VIDEPE from Shanoir')}
    />
  );
} else {
  // else just start the app as normal
  start().catch((err) => {
    console.error(err); // full stack trace for debugging
    root.render(
      <StrictMode>
        <ShanoirErrorPage error={err} />
      </StrictMode>
    );
  });
}
