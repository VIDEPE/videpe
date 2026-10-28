// Host-app settings from the runtime (deploy-time) configuration, read from `window.videpeConfig`.
// A host app is a local program (e.g. a Python app) that serves VIDEPE itself and opens it
// in the browser with files to show.
//
// `public/app-config.js` sets `window.videpeConfig` and is loaded by index.html before the
// app bundle. It is copied into the build unhashed, so one build serves every deployment:
// - GitHub Pages ships it as-is, with the host-app mode disabled (`hostApp: null`) — local
//   files only.
// - A host app that serves VIDEPE replaces it with its own settings, to enable launching
//   VIDEPE from that app.

import { isNonEmptyString, resolveSameOriginPath } from '@/utils/configValidation';

/**
 * Reads and validates the host-app section of the runtime config.
 *
 * @param {object|undefined} [config=window.videpeConfig] - the runtime config object.
 * @returns {{name: string, apiBase: string }|null}
 *   the normalized host-app config:
 *   - 'name': name of the host app launching VIDEPE
 *   - `apiBase`: base path of the host app's API, without trailing slash (e.g. '/api'),
 *     served by the same local server that serves VIDEPE.
 *   Returns `null` when the host-app mode is disabled, or when the config is malformed (with
 *   a console warning) — VIDEPE then behaves as the plain local-files app.
 */
export function getHostAppConfig(config = window.videpeConfig) {
  const hostApp = config?.hostApp;
  if (!hostApp) return null;

  const problems = [];
  // check if properties are non-empty strings
  if (!isNonEmptyString(hostApp.apiBase)) problems.push('apiBase');
  if (!isNonEmptyString(hostApp.name)) problems.push('name');

  // The path checks only make sense on a string, so they're skipped when apiBase is missing
  // (already reported above)
  let apiBase = null;
  if (isNonEmptyString(hostApp.apiBase)) {
    // check if apiBase is a same-origin path (see resolveSameOriginPath): the session token is
    // sent to apiBase, so it must stay on the server that served VIDEPE
    const { path, problem } = resolveSameOriginPath(hostApp.apiBase);
    if (problem) problems.push(`apiBase (${problem})`);
    apiBase = path;
  }

  if (problems.length > 0) {
    console.warn(`Invalid HostApp config in app-config.js — check: ${problems.join('; ')}`);
    return null;
  }

  return {
    name: hostApp.name.trim(), // trimmed host app name
    apiBase: apiBase, // resolved path, without trailing slash(es) so paths can be appended
  };
}
