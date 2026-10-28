// Shanoir settings from the runtime (deploy-time) configuration, read from `window.videpeConfig`.
//
// `public/app-config.js` sets `window.videpeConfig` and is loaded by index.html before the
// app bundle. It is copied into the build unhashed, so one build serves every deployment:
// - GitHub Pages ships it as-is, with Shanoir disabled (`shanoir: null`) — local files only.
// - A Shanoir deployment overwrites it (its nginx entrypoint fills in the Keycloak URL at
//   startup, as it already does for OHIF's app-config.js) to enable launching from Shanoir.

import { isNonEmptyString, resolveSameOriginPath } from '@/utils/configValidation';

// A real URL — also rejects placeholders the deployment forgot to fill in
// (e.g. 'SHANOIR_KEYCLOAK_URL/realms/shanoir-ng').
const isHttpUrl = (value) => typeof value === 'string' && /^https?:\/\//.test(value);

/**
 * Reads and validates the Shanoir section of the runtime config.
 *
 * @param {object|undefined} [config=window.videpeConfig] - the runtime config object.
 * @returns {{ authority: string, clientId: string, apiBase: string }|null}
 *   the normalized Shanoir config:
 *   - `authority`: Keycloak realm URL, e.g. 'https://shanoir.example/auth/realms/shanoir-ng'.
 *   - `clientId`: the public OIDC client registered for VIDEPE in that realm.
 *   - `apiBase`: base path of Shanoir's datasets service, without trailing slash. Must be a
 *     same-origin path such as '/shanoir-ng/datasets', proxied by the viewer host.
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

  // The path checks only make sense on a string, so they're skipped when apiBase is missing
  // (already reported above)
  let apiBase = null;
  if (isNonEmptyString(shanoir.apiBase)) {
    // check if apiBase is a same-origin path (see resolveSameOriginPath): the Shanoir access
    // token is sent to apiBase, so it must stay on the viewer host (proxied there, see
    // docs/shanoir-integration.md)
    const { path, problem } = resolveSameOriginPath(shanoir.apiBase);
    if (problem) problems.push(`apiBase (${problem})`);
    apiBase = path;
  }

  if (problems.length > 0) {
    console.warn(`Invalid Shanoir config in app-config.js — check: ${problems.join('; ')}`);
    return null;
  }

  return {
    authority: shanoir.authority,
    clientId: shanoir.clientId,
    apiBase: apiBase, // resolved path, without trailing slash(es) so paths can be appended
  };
}
