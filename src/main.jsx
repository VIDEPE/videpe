import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';

import { getShanoirConfig } from '@/shanoir/shanoirConfig';
import { createShanoirUserManager, getAccessToken } from '@/shanoir/shanoirAuth';
import { resolveShanoirLaunch } from '@/shanoir/shanoirLaunch';
import { ShanoirSessionContext } from '@/shanoir/ShanoirSessionContext';
import { ShanoirErrorPage, ShanoirSignInPage } from '@/shanoir/ShanoirLaunchPages';
import { createShanoirClient } from '@/shanoir/shanoirClient';

import { getHostAppConfig } from '@/hostApp/hostAppConfig';
import { getTabStorage, resolveHostAppLaunch } from '@/hostApp/hostAppLaunch';
import { HostAppSessionContext } from '@/hostApp/HostAppSessionContext';
import { HostAppErrorPage } from '@/hostApp/HostAppLaunchPages';
import { createHostAppClient } from '@/hostApp/hostAppClient';

const root = createRoot(document.getElementById('root'));

// Starts the app, launching from Shanoir first when configured. The Shanoir chain:
//   config → userManager (login) → getAccessToken (current token)
//     → client (requests with token) → useShanoirData (loads, in PatientView)
// Each step only runs when the previous one succeeded: no config (GitHub Pages) or no launch
// parameters in the URL means no Shanoir session, and VIDEPE starts as the local-files app.
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

  if (launch.status === 'ready') {
    root.render(
      <StrictMode>
        <ShanoirSessionContext.Provider
          value={{
            client: client,
            examinationId: launch.examinationId,
          }}
        >
          <App />
        </ShanoirSessionContext.Provider>
      </StrictMode>
    );
    return;
  }

  // Not launched from Shanoir: maybe from a host app instead
  if (startHostApp()) return;

  // Neither: the plain local-files app
  root.render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

// Starts a host-app launch (e.g. from a local Python app that serves VIDEPE) — only tried when
// VIDEPE isn't being launched from Shanoir. The host-app chain:
//   config → launch token (from the URL, or kept from before a reload)
//     → client (requests with the token) → useHostAppData (loads, in PatientView)
// No sign-in step, so unlike Shanoir this all happens synchronously, in one page load.
// Returns whether it rendered the page (the launched app, or its error page); false means no
// host-app launch (no config, or no token), so the caller renders the plain app.
function startHostApp() {
  // Host-app settings from app-config.js (API path, app name); null on GitHub Pages
  const config = getHostAppConfig();
  // Host-app mode off (e.g. GitHub Pages, or a Shanoir deployment): stop before anything else,
  // so the tab's sessionStorage isn't even touched
  if (!config) return false;

  let launch;
  try {
    // 'none' (normal visit) or 'ready' (launched); throws on a broken launch link
    launch = resolveHostAppLaunch({
      config,
      location: window.location,
      history: window.history,
      baseUrl: import.meta.env.BASE_URL,
      storage: getTabStorage(), // sessionStorage, or in memory when the browser blocks it
    });
  } catch (err) {
    console.error(err); // full stack trace for debugging
    // its own error page, naming the host app instead of Shanoir
    root.render(
      <StrictMode>
        <HostAppErrorPage error={err} appName={config.name} />
      </StrictMode>
    );
    return true;
  }

  if (launch.status !== 'ready') return false;

  const client = createHostAppClient({
    apiBase: config.apiBase,
    token: launch.token,
    appName: config.name,
  });

  root.render(
    <StrictMode>
      <HostAppSessionContext.Provider value={{ client, appName: config.name }}>
        <App />
      </HostAppSessionContext.Provider>
    </StrictMode>
  );
  return true;
}

// Dev-only previews, to check the Shanoir screens without a Shanoir setup (under `npm run dev`):
// - /videpe/?preview=signin or ?preview=error: the start-up pages.
// - /videpe/?preview=shanoir: PatientView as if launched from Shanoir, with a fake client
//   serving the demo data (everything after sign-in: downloading, unzipping, loading).
// - /videpe/?preview=hostapp: PatientView as if launched from a host app, with a fake client
//   serving the demo data (everything after the launch: downloading, sorting, loading).
// - /videpe/?preview=hostapp-error: the host-app error page.
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
} else if (preview === 'shanoir') {
  // fake client is provided in dev mode (never in production mode: dynamic import, so it's
  // only loaded when this branch runs, and Vite strips the branch from production builds)
  const { createFakeShanoirClient } = await import('./shanoir/fakeShanoirClient.js');
  const fakeClient = createFakeShanoirClient();
  history.replaceState(null, '', '?preview=shanoir#/patient-view');
  root.render(
    <StrictMode>
      <ShanoirSessionContext.Provider
        value={{
          client: fakeClient,
          examinationId: 42,
        }}
      >
        <App />
      </ShanoirSessionContext.Provider>
    </StrictMode>
  );
} else if (preview === 'hostapp') {
  // fake client, dev mode only — loaded and stripped like the Shanoir one above
  const { createFakeHostAppClient } = await import('./hostApp/fakeHostAppClient.js');
  const fakeClient = createFakeHostAppClient();
  history.replaceState(null, '', '?preview=hostapp#/patient-view');
  root.render(
    <StrictMode>
      <HostAppSessionContext.Provider
        value={{
          client: fakeClient,
          appName: 'Test Host App',
        }}
      >
        <App />
      </HostAppSessionContext.Provider>
    </StrictMode>
  );
} else if (preview === 'hostapp-error') {
  root.render(
    <HostAppErrorPage
      error={new Error('EXAMPLE ERROR: Invalid token in the launch URL.')}
      appName="Test Host App"
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
