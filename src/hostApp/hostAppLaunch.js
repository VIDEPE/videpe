// Handles VIDEPE being opened from a host app's "View in VIDEPE" button, e.g.
//   http://127.0.0.1:8765/videpe/?token=<token>
//
// The host app (e.g. a local Python app that serves VIDEPE) creates a new random token for
// each launch and opens this URL. VIDEPE then:
// 1. Reads the token from the URL, and keeps it in sessionStorage, so a reload still works.
// 2. Removes it from the URL (so it doesn't end up in screenshots, copied links or the
//    browser history) and opens PatientView directly.
// Later, VIDEPE sends the token with every request to the host app's API, which uses it to
// check the request comes from the tab it opened.
//
// Unlike the Shanoir launch there is no sign-in step, so this all happens in one page load.
// Launch params are read from `location.search`, not the hash — HashRouter owns the hash.

export const PATIENT_VIEW_HASH = '#/patient-view';

// Where the token is kept in sessionStorage (exported so the tests use the same key)
export const TOKEN_STORAGE_KEY = 'videpe.hostAppToken';

/**
 * Parses a host-app session token, as created by the host app for one launch (e.g. Python's
 * `secrets.token_urlsafe(32)`, which gives 43 characters).
 *
 * Only checks the token's format, to catch broken or tampered links and keep the value safe
 * to send in an HTTP header — whether the token is valid is up to the host app's server.
 *
 * @param {string|null|undefined} value - raw value from the launch URL or the stored token.
 * @returns {string|null} the token, or `null` if it isn't 32–128 characters from
 *   A–Z a–z 0–9 _ - (the base64url alphabet).
 */
export function parseToken(value) {
  const text = String(value ?? '');
  // only letters, numbers and 2 symbols (_ and -): no escaping needed in a URL or header.
  // At least 32 characters (256 bits), so it can't be guessed (Python's secrets.token_urlsafe(32) gives
  // 43), and at most 128, so a broken link can't put a huge value in every request's header.
  if (/^[A-Za-z0-9_-]{32,128}$/.test(text)) {
    return text;
  } else {
    return null;
  }
}

/**
 * Runs the host-app launch step, before the app renders.
 *
 * All browser objects are passed in, so this is testable without a real browser.
 *
 * @param {Object} params
 * @param {object|null} params.config - validated host-app config (getHostAppConfig), or null.
 * @param {{ search: string }} params.location - usually window.location.
 * @param {{ replaceState: Function }} params.history - usually window.history.
 * @param {string} params.baseUrl - the app's base path (import.meta.env.BASE_URL, e.g. '/videpe/').
 * @param {{ getItem: Function, setItem: Function, removeItem: Function }} params.storage -
 *   usually window.sessionStorage; keeps the token for a reload of the same tab.
 * @returns {{ status: 'none' } | { status: 'ready', token: string }}
 *   - `none`: not a host-app launch (no config, no token in the URL and none stored) —
 *     render the normal app.
 *   - `ready`: launched from the host app; the token is stored, and the URL now points at
 *     PatientView without it. A `?token=` in the URL wins over a stored one, so a new launch
 *     in the same tab loads the new files.
 * @throws {Error} when the URL has a `?token=` that isn't a valid token (see parseToken).
 */
export function resolveHostAppLaunch({ config, location, history, baseUrl, storage }) {
  if (!config) return { status: 'none' };
  let token; // set by one of the two branches below
  const params = new URLSearchParams(location.search);

  // A token in the URL always wins: it comes from a new "View in VIDEPE" click, possibly with
  // other files than the token stored by an earlier launch in this tab. The stored token is
  // only the fallback for a reload, where the URL no longer has one.
  // `has`, not `get`: an empty `?token=` is a broken launch link (error), not a normal visit.
  if (params.has('token')) {
    token = parseToken(params.get('token'));
    if (token === null) {
      // The token itself is left out of the message: it's a secret, and error messages end
      // up in screenshots and bug reports
      throw new Error(
        'Invalid token in the launch URL. Reopen VIDEPE from the app that launched it.'
      );
    }
  } else {
    // Read once, and checked like a URL token: the stored value could have been changed
    token = parseToken(storage.getItem(TOKEN_STORAGE_KEY));
    if (token === null) {
      // Nothing (valid) stored: a normal visit. A stale invalid value is removed, so it
      // isn't checked again on every load.
      storage.removeItem(TOKEN_STORAGE_KEY);
      return { status: 'none' };
    }
  }

  // remove token from URL (looks cleaner without long token, and keeps it out of screenshots,
  // copied links and the browser history), and open PatientView before the first render
  history.replaceState(null, '', `${baseUrl}${PATIENT_VIEW_HASH}`);
  // store token in sessionStorage (=survives a reload, but clears when tab is closed)
  storage.setItem(TOKEN_STORAGE_KEY, token);

  return { status: 'ready', token };
}
