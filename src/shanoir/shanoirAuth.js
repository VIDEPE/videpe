import { UserManager, WebStorageStateStore, InMemoryWebStorage } from 'oidc-client-ts';

/**
 * Creates the oidc-client-ts UserManager that signs the user in to Shanoir's Keycloak.
 * It handles the login redirect, the token exchange on return, and keeps the tokens
 * (renewing the access token automatically before it expires).
 *
 * Uses the library defaults for everything else: Authorization Code flow with PKCE
 * (VIDEPE is a public client — no client secret in the browser) and `openid` scope.
 * Tokens are kept in memory only, never in browser storage: they disappear when the tab
 * closes or reloads, and a reload simply re-launches via SSO. The temporary PKCE state
 * stays in sessionStorage (the default), as it must survive the redirect to Keycloak.
 *
 * @param {{ authority: string, clientId: string }} config - the validated Shanoir config
 *   (getShanoirConfig): Keycloak realm URL and the public client registered for VIDEPE.
 * @param {Object} [urls] - only needed in tests; defaults to the current page.
 * @param {string} [urls.origin=window.location.origin] - e.g. 'https://viewer.example'.
 * @param {string} [urls.baseUrl=import.meta.env.BASE_URL] - the app's base path, e.g. '/videpe/'.
 * @returns {UserManager} the user manager. Its redirect URI is origin + baseUrl
 *   (e.g. 'https://viewer.example/videpe/'), which must match the redirect URI registered
 *   for the client in Keycloak exactly.
 */
export function createShanoirUserManager(
  config,
  { origin = window.location.origin, baseUrl = import.meta.env.BASE_URL } = {}
) {
  return new UserManager({
    authority: config.authority,
    client_id: config.clientId,
    redirect_uri: new URL(baseUrl, origin).href, // 'https://viewer.example/videpe/'
    userStore: new WebStorageStateStore({ store: new InMemoryWebStorage() }),
  });
}

/**
 * Returns the signed-in user's current Shanoir access token. Called before every Shanoir
 * request (via the client's `getAccessToken`, wrapped as `() => getAccessToken(userManager)`),
 * so a token renewed in the background since the last request is picked up.
 *
 * @param {UserManager} userManager - the user manager from createShanoirUserManager.
 * @returns {Promise<string>} the current access token.
 * @throws {Error} when there's no signed-in user, or the access token has expired (e.g.
 *   automatic renewal failed) — the message reaches the user through the Shanoir loading
 *   toast, telling them to reopen VIDEPE from Shanoir.
 */
export async function getAccessToken(userManager) {
  const user = await userManager.getUser();
  if (!user || user.expired) {
    throw new Error('Shanoir sign-in has expired, reopen VIDEPE from Shanoir');
  }
  return user.access_token;
}
