// VIDEPE runtime configuration: deployment settings that are read when the app starts, not
// baked into the build. Loaded by index.html before the app bundle, so `window.videpeConfig`
// already exists when the app starts (read by src/shanoir/shanoirConfig.js).
//
// It lives in public/, so Vite copies it unchanged and unhashed: one build serves every
// deployment, and each deployment just replaces this single file.
//
// - GitHub Pages (this default): `shanoir: null`, so Shanoir is disabled and VIDEPE is the
//   plain local-files app (no login, no network requests for data).
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
// An invalid Shanoir section (e.g. a placeholder that wasn't filled in) is ignored with a
// console warning, so VIDEPE then also starts as the local-files app.
window.videpeConfig = { shanoir: null };
