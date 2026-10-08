import { describe, it, expect, afterEach, vi } from 'vitest';
import { User } from 'oidc-client-ts';
import { createShanoirUserManager, getAccessToken } from '@/shanoir/shanoirAuth';

const CONFIG = {
  authority: 'https://shanoir.example/auth/realms/shanoir-ng',
  clientId: 'videpe',
  apiBase: '/shanoir-ng/datasets',
};
const URLS = { origin: 'https://viewer.example', baseUrl: '/videpe/' };

// A signed-in user, as the token exchange would produce it.
const makeUser = () =>
  new User({ access_token: 'access-123', token_type: 'Bearer', profile: { sub: 'u1' } });

describe('createShanoirUserManager', () => {
  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('points at the configured Keycloak realm and client', () => {
    const { settings } = createShanoirUserManager(CONFIG, URLS);
    expect(settings.authority).toBe(CONFIG.authority);
    expect(settings.client_id).toBe(CONFIG.clientId);
  });

  it("redirects back to VIDEPE's base URL after login", () => {
    // Must match the redirect URI registered for the client in Keycloak exactly.
    const { settings } = createShanoirUserManager(CONFIG, URLS);
    expect(settings.redirect_uri).toBe('https://viewer.example/videpe/');
  });

  it('uses the Authorization Code flow with PKCE (public client)', () => {
    const { settings } = createShanoirUserManager(CONFIG, URLS);
    expect(settings.response_type).toBe('code');
    expect(settings.disablePKCE).toBe(false);
  });

  it('renews the access token automatically, so long reviews keep working', () => {
    const { settings } = createShanoirUserManager(CONFIG, URLS);
    expect(settings.automaticSilentRenew).toBe(true);
  });

  it('keeps tokens in memory only, never in browser storage', async () => {
    const userManager = createShanoirUserManager(CONFIG, URLS);
    await userManager.storeUser(makeUser());

    expect((await userManager.getUser()).access_token).toBe('access-123');
    // The default store would have written an 'oidc.user:…' entry to sessionStorage.
    expect(Object.keys(sessionStorage).filter((k) => k.startsWith('oidc.user'))).toEqual([]);
    expect(Object.keys(localStorage).filter((k) => k.startsWith('oidc.user'))).toEqual([]);
  });

  it('defaults the redirect URI to the current page origin and the app base URL', () => {
    const { settings } = createShanoirUserManager(CONFIG);
    expect(settings.redirect_uri).toBe(`${window.location.origin}${import.meta.env.BASE_URL}`);
  });
});

describe('getAccessToken', () => {
  // A stand-in for the UserManager: getAccessToken only calls getUser()
  const userManagerWith = (user) => ({ getUser: vi.fn().mockResolvedValue(user) });

  it("returns the signed-in user's access token", async () => {
    const userManager = userManagerWith({ access_token: 'access-123', expired: false });
    await expect(getAccessToken(userManager)).resolves.toBe('access-123');
  });

  it('asks for the current user on every call, so a renewed token is picked up', async () => {
    const userManager = userManagerWith({ access_token: 'access-123', expired: false });
    await getAccessToken(userManager);
    userManager.getUser.mockResolvedValue({ access_token: 'renewed-456', expired: false });
    await expect(getAccessToken(userManager)).resolves.toBe('renewed-456');
  });

  it('throws when nobody is signed in', async () => {
    await expect(getAccessToken(userManagerWith(null))).rejects.toThrow(
      /reopen VIDEPE from Shanoir/
    );
  });

  it('throws when the access token has expired (e.g. renewal failed)', async () => {
    const userManager = userManagerWith({ access_token: 'access-123', expired: true });
    await expect(getAccessToken(userManager)).rejects.toThrow(/reopen VIDEPE from Shanoir/);
  });

  it('works with a real UserManager holding a signed-in user', async () => {
    const userManager = createShanoirUserManager(CONFIG, URLS);
    await userManager.storeUser(makeUser());
    await expect(getAccessToken(userManager)).resolves.toBe('access-123');
  });
});
