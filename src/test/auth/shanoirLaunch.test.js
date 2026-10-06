import { describe, it, expect, vi } from 'vitest';
import { parseExaminationId, resolveShanoirLaunch } from '@/auth/shanoirLaunch';

const CONFIG = {
  authority: 'https://shanoir.example/auth/realms/shanoir-ng',
  clientId: 'videpe',
  apiBase: '/shanoir-ng/datasets',
};
const BASE_URL = '/videpe/';

// Minimal stand-ins for window.location/window.history and oidc-client-ts's UserManager —
// resolveShanoirLaunch takes them as parameters so no real redirect ever happens here.
const makeLocation = (search, hash = '') => ({
  search,
  hash,
  href: `https://viewer.example${BASE_URL}${search}${hash}`,
});
const makeHistory = () => ({ replaceState: vi.fn() });
const makeUserManager = (callbackState) => ({
  signinRedirect: vi.fn().mockResolvedValue(undefined),
  signinRedirectCallback: vi.fn().mockResolvedValue({ state: callbackState }),
});

describe('parseExaminationId', () => {
  it.each([
    ['123', 123],
    [42, 42],
  ])('accepts the positive integer %p', (input, expected) => {
    expect(parseExaminationId(input)).toBe(expected);
  });

  it.each([null, undefined, '', '0', '-3', '1.5', 'abc', '12abc'])('rejects %p', (input) => {
    expect(parseExaminationId(input)).toBeNull();
  });
});

describe('resolveShanoirLaunch', () => {
  it('does nothing when Shanoir is not configured (GitHub Pages build)', async () => {
    const userManager = makeUserManager();
    const history = makeHistory();
    const result = await resolveShanoirLaunch({
      config: null,
      location: makeLocation('?examinationId=5'),
      history,
      baseUrl: BASE_URL,
      userManager,
    });
    expect(result).toEqual({ status: 'none' });
    expect(userManager.signinRedirect).not.toHaveBeenCalled();
    expect(history.replaceState).not.toHaveBeenCalled();
  });

  it('does nothing when opened without launch parameters (plain local-files use)', async () => {
    const userManager = makeUserManager();
    const result = await resolveShanoirLaunch({
      config: CONFIG,
      location: makeLocation('', '#/about'),
      history: makeHistory(),
      baseUrl: BASE_URL,
      userManager,
    });
    expect(result).toEqual({ status: 'none' });
    expect(userManager.signinRedirect).not.toHaveBeenCalled();
  });

  it('starts the OIDC redirect, carrying the examinationId in the OIDC state', async () => {
    const userManager = makeUserManager();
    const result = await resolveShanoirLaunch({
      config: CONFIG,
      location: makeLocation('?examinationId=123'),
      history: makeHistory(),
      baseUrl: BASE_URL,
      userManager,
    });
    expect(result).toEqual({ status: 'redirecting' });
    expect(userManager.signinRedirect).toHaveBeenCalledWith({ state: { examinationId: 123 } });
  });

  it('rejects an invalid examinationId instead of redirecting', async () => {
    const userManager = makeUserManager();
    await expect(
      resolveShanoirLaunch({
        config: CONFIG,
        location: makeLocation('?examinationId=abc'),
        history: makeHistory(),
        baseUrl: BASE_URL,
        userManager,
      })
    ).rejects.toThrow(/examinationId/);
    expect(userManager.signinRedirect).not.toHaveBeenCalled();
  });

  it('completes the callback and routes straight to PatientView, keeping examinationId in the URL', async () => {
    const userManager = makeUserManager({ examinationId: 123 });
    const history = makeHistory();
    const location = makeLocation('?code=abc&state=xyz');
    const result = await resolveShanoirLaunch({
      config: CONFIG,
      location,
      history,
      baseUrl: BASE_URL,
      userManager,
    });
    expect(userManager.signinRedirectCallback).toHaveBeenCalledWith(location.href);
    expect(result).toEqual({ status: 'ready', examinationId: 123 });
    // code/state are removed, and the hash route is set before the first render so
    // HashRouter starts on PatientView — the landing page never mounts. Keeping
    // examinationId means a page reload re-launches the same examination.
    expect(history.replaceState).toHaveBeenCalledWith(
      null,
      '',
      '/videpe/?examinationId=123#/patient-view'
    );
  });

  it('treats a Keycloak error response (?error=…&state=…) as a callback', async () => {
    const userManager = makeUserManager();
    userManager.signinRedirectCallback.mockRejectedValue(new Error('access_denied'));
    await expect(
      resolveShanoirLaunch({
        config: CONFIG,
        location: makeLocation('?error=access_denied&state=xyz'),
        history: makeHistory(),
        baseUrl: BASE_URL,
        userManager,
      })
    ).rejects.toThrow('access_denied');
  });

  it('rejects a callback whose OIDC state carries no valid examinationId', async () => {
    const userManager = makeUserManager({});
    await expect(
      resolveShanoirLaunch({
        config: CONFIG,
        location: makeLocation('?code=abc&state=xyz'),
        history: makeHistory(),
        baseUrl: BASE_URL,
        userManager,
      })
    ).rejects.toThrow(/examinationId/);
  });
});
