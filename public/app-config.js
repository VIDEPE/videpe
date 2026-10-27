// VIDEPE runtime configuration: deployment settings that are read when the app starts, not
// baked into the build. Loaded by index.html before the app bundle, so `window.videpeConfig`
// already exists when the app starts (read by src/shanoir/shanoirConfig.js and
// src/hostApp/hostAppConfig.js).
//
// It lives in public/, so Vite copies it unchanged and unhashed: one build serves every
// deployment, and each deployment just replaces this single file.
//
// - GitHub Pages (this default): `shanoir: null` and `hostApp: null`, so both launch modes are
//   disabled and VIDEPE is the plain local-files app (no login, no network requests for data).
// - Shanoir's viewer server: replaced at startup with the Shanoir settings, enabling the
//   "View in VIDEPE" launch (Keycloak sign-in, then loading the examination):
//
//   window.videpeConfig = {
//     shanoir: {
//       authority: 'https://<shanoir-host>/auth/realms/shanoir-ng', // Keycloak realm URL
//       clientId: 'videpe', // public OIDC client registered for VIDEPE in that realm
//       apiBase: '/shanoir-ng/datasets', // datasets service, proxied on the same origin
//     },
//   };
//
// - A host app's local server (e.g. a Python app that serves VIDEPE itself): replaced with the
//   host-app settings, enabling its "View in VIDEPE" launch (a ?token= in the launch URL, then
//   loading the files the user picked). See docs/host-app-integration.md:
//
//   window.videpeConfig = {
//     hostApp: {
//       name: 'My Host App', // shown to the user, e.g. "Opened from My Host App"
//       apiBase: '/api', // the host app's API — a path on the same server that serves VIDEPE
//     },
//   };
//
// A deployment normally enables one of the two. If both are set, a Shanoir launch is tried
// first, and the host-app launch only when VIDEPE isn't being launched from Shanoir.
//
// An invalid section (e.g. a placeholder that wasn't filled in, or a host-app apiBase on
// another server) is ignored with a console warning, so VIDEPE then also starts as the
// local-files app.
window.videpeConfig = { shanoir: null, hostApp: null };
