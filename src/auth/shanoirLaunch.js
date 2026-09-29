// Handles VIDEPE being opened from Shanoir's "View in VIDEPE" button, e.g.
//   https://<viewer-host>/videpe/?examinationId=123
//
// Flow (OIDC Authorization Code + PKCE, via oidc-client-ts):
// 1. Launch URL has ?examinationId → redirect to Shanoir's Keycloak, carrying the
//    examinationId in the OIDC `state`. Users already logged into Shanoir are sent straight
//    back (SSO), without a password prompt.
// 2. Keycloak redirects back with ?code=…&state=… → exchange the code for tokens, recover
//    the examinationId, and rewrite the URL to open PatientView directly.
//
// Launch params are read from `location.search`, not the hash — HashRouter owns the hash,
// and the OIDC round-trip drops any `#/…` fragment anyway.

export const PATIENT_VIEW_HASH = '#/patient-view';

/**
 * Parses a Shanoir examination ID.
 *
 * @param {string|number|null|undefined} value - raw value from the URL or the OIDC state.
 * @returns {number|null} the ID as a positive integer, or `null` if it isn't one.
 */
export function parseExaminationId(value) {
  const text = String(value ?? '');
  if (!/^\d+$/.test(text)) return null; // digits only: rejects '', '-3', '1.5', '12abc'
  const id = Number(text);
  return id > 0 ? id : null;
}

/**
 * Runs the launch/callback step of the Shanoir OIDC flow, before the app renders.
 *
 * All browser objects are passed in, so this is testable without real redirects.
 *
 * @param {Object} params
 * @param {object|null} params.config - validated Shanoir config (getShanoirConfig), or null.
 * @param {{ search: string, href: string }} params.location - usually window.location.
 * @param {{ replaceState: Function }} params.history - usually window.history.
 * @param {string} params.baseUrl - the app's base path (import.meta.env.BASE_URL, e.g. '/videpe/').
 * @param {{ signinRedirect: Function, signinRedirectCallback: Function }} params.userManager
 *   oidc-client-ts UserManager (see createShanoirUserManager).
 * @returns {Promise<{ status: 'none' } | { status: 'redirecting' } | { status: 'ready', examinationId: number }>}
 *   - `none`: not a Shanoir launch — render the normal app.
 *   - `redirecting`: the browser is navigating to Keycloak — keep the sign-in screen up.
 *   - `ready`: signed in; the URL now points at PatientView for `examinationId`.
 * @throws {Error} on an invalid examinationId, or when Keycloak/the token exchange fails.
 */
export async function bootstrapShanoirLaunch({ config, location, history, baseUrl, userManager }) {
  if (!config) return { status: 'none' };

  const params = new URLSearchParams(location.search);

  // Returning from Keycloak: ?code=…&state=… on success, ?error=…&state=… on failure
  // (signinRedirectCallback throws with Keycloak's error in the latter case).
  if (params.has('state') && (params.has('code') || params.has('error'))) {
    const user = await userManager.signinRedirectCallback(location.href);
    const examinationId = parseExaminationId(user?.state?.examinationId);
    if (examinationId === null) {
      throw new Error('Shanoir sign-in succeeded, but no valid examinationId was carried over.');
    }
    // Drop code/state and set the hash route before the first render, so HashRouter
    // starts on PatientView and the landing page never mounts. examinationId stays in
    // the URL so a page reload re-launches the same examination.
    history.replaceState(null, '', `${baseUrl}?examinationId=${examinationId}${PATIENT_VIEW_HASH}`);
    return { status: 'ready', examinationId };
  }

  if (params.has('examinationId')) {
    const examinationId = parseExaminationId(params.get('examinationId'));
    if (examinationId === null) {
      throw new Error(`Invalid examinationId in the launch URL: "${params.get('examinationId')}"`);
    }
    await userManager.signinRedirect({ state: { examinationId } });
    return { status: 'redirecting' };
  }

  return { status: 'none' };
}
