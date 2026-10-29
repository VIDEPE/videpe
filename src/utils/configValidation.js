// Checks shared by the runtime-config readers (src/shanoir/shanoirConfig.js and
// src/hostApp/hostAppConfig.js), which validate the settings in public/app-config.js.

/**
 * Checks if a value is a string with at least one non-whitespace character.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';

// Resolves `path` against the current page, exactly as fetch would. Returns the resulting URL,
// or null when it can't be parsed (new URL throws on some inputs, e.g. 'http://[').
const resolveUrl = (path) => {
  try {
    return new URL(path, window.location.href);
  } catch {
    return null;
  }
};

/**
 * Checks that an API base path from the config stays on the server that served VIDEPE, and
 * returns it in the form fetch will actually use. VIDEPE sends access tokens to these paths,
 * so they must never lead to another server.
 *
 * Two checks, in this order:
 * 1. Same origin: the browser resolves the path (the only reliable way — text checks miss
 *    tricks like '/\evil.example' or a tab between two slashes, which browsers read as
 *    '//evil.example') and its origin is compared to the page's.
 * 2. Starts with '/': a relative path ('api', '../api') stays on the same server, but would
 *    depend on the folder the page is in. A text check is enough here, as anything that starts
 *    with '/' but leads to another server was already rejected by check 1.
 *
 * @param {string} path - the configured path, e.g. '/api'.
 * @returns {{ path: string, problem: null } | { path: null, problem: string }}
 *   - `path`: the resolved path (as the browser cleaned it up), without trailing slash so
 *     paths can be appended; null when the path is rejected.
 *   - `problem`: why the path was rejected, for the config's warning; null when accepted.
 */
export function resolveSameOriginPath(path) {
  const resolved = resolveUrl(path);
  if (resolved?.origin !== window.location.origin) {
    return { path: null, problem: 'not on same-origin path' };
  }
  if (!path.startsWith('/')) {
    return { path: null, problem: 'must start with /' };
  }
  // strip trailing slash(es) so paths can be appended
  return { path: resolved.pathname.replace(/\/+$/, ''), problem: null };
}

/**
 * Checks if a value is a JSON object (`{ … }`) — e.g. what response.json() returned — and
 * not one of the other things JSON can hold: a list, text, a number, a boolean or null.
 *
 * `typeof` rather than `instanceof Object`: typeof null is also 'object', hence the null
 * check, and lists are objects too, hence the Array.isArray check.
 *
 * @param {unknown} data
 * @returns {boolean}
 */
export const isJsonObject = (data) =>
  typeof data === 'object' && data !== null && !Array.isArray(data);
