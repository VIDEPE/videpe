// Runtime (deploy-time) configuration, read from `window.videpeConfig`.
//
// `public/app-config.js` sets `window.videpeConfig` and is loaded by index.html before the
// app bundle. It is copied into the build unhashed, so one build serves every deployment:
// - GitHub Pages ships it as-is, with Shanoir disabled (`shanoir: null`) — local files only.
// - A Shanoir deployment overwrites it (its nginx entrypoint fills in the Keycloak URL at
//   startup, as it already does for OHIF's app-config.js) to enable launching from Shanoir.

// A real URL — also rejects placeholders the deployment forgot to fill in
// (e.g. 'SHANOIR_KEYCLOAK_URL/realms/shanoir-ng').
const isHttpUrl = (value) => typeof value === 'string' && /^https?:\/\//.test(value);
const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';

/**
 * Reads and validates the Shanoir section of the runtime config.
 *
 * @param {object|undefined} [config=window.videpeConfig] - the runtime config object.
 * @returns {{ authority: string, clientId: string, apiBase: string }|null}
 *   the normalized Shanoir config:
 *   - `authority`: Keycloak realm URL, e.g. 'https://shanoir.example/auth/realms/shanoir-ng'.
 *   - `clientId`: the public OIDC client registered for VIDEPE in that realm.
 *   - `apiBase`: base URL of Shanoir's datasets service, without trailing slash
 *     (same-origin path such as '/shanoir-ng/datasets' when proxied by the viewer host).
 *   Returns `null` when Shanoir is disabled, or when the config is malformed (with a
 *   console warning) — VIDEPE then behaves as the plain local-files app.
 */
export function getShanoirConfig(config = window.videpeConfig) {
  const shanoir = config?.shanoir;
  if (!shanoir) return null;

  const problems = [];
  if (!isHttpUrl(shanoir.authority)) problems.push('authority (must be an http(s) URL)');
  if (!isNonEmptyString(shanoir.clientId)) problems.push('clientId');
  if (!isNonEmptyString(shanoir.apiBase)) problems.push('apiBase');
  if (problems.length > 0) {
    console.warn(`Invalid Shanoir config in app-config.js — check: ${problems.join('; ')}`);
    return null;
  }

  return {
    authority: shanoir.authority,
    clientId: shanoir.clientId,
    apiBase: shanoir.apiBase.replace(/\/+$/, ''), // strip trailing slash(es) so paths can be appended
  };
}
