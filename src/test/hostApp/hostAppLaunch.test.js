import { describe, it, expect, vi } from 'vitest';
import {
  getTabStorage,
  parseToken,
  resolveHostAppLaunch,
  TOKEN_STORAGE_KEY,
} from '@/hostApp/hostAppLaunch';

const CONFIG = {
  name: 'Host App',
  apiBase: '/api',
};
const BASE_URL = '/videpe/';

// Minimal stand-ins for window.location, window.history and window.sessionStorage —
// resolveHostAppLaunch takes them as parameters, so the tests don't touch the real browser.
const makeLocation = (search, hash = '') => ({
  search,
  hash,
  href: `http://127.0.0.1:8765${BASE_URL}${search}${hash}`,
});
const makeHistory = () => ({ replaceState: vi.fn() });
// Same getItem/setItem/removeItem API as sessionStorage, kept in a Map. A fresh one per test,
// so a token stored by one test can't leak into the next.
const makeStorage = () => {
  const items = new Map();
  return {
    getItem: (key) => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => items.set(key, String(value)),
    removeItem: (key) => items.delete(key),
  };
};

// A token as Python's secrets.token_urlsafe(32) makes them: 43 characters from A–Z a–z 0–9 _ -
const TOKEN = 'Abc_123-'.repeat(5) + 'xyz';
// The shortest and longest tokens accepted
const MIN_TOKEN = 'a'.repeat(32);
const MAX_TOKEN = 'a'.repeat(128);

describe('parseToken', () => {
  it.each([TOKEN, MIN_TOKEN, MAX_TOKEN])('accepts the URL-safe token %j', (input) => {
    expect(parseToken(input)).toBe(input);
  });

  it.each([null, undefined, '', 'a'.repeat(31)])('rejects %j (missing or too short)', (input) => {
    expect(parseToken(input)).toBeNull();
  });

  it('rejects a token longer than 128 characters', () => {
    expect(parseToken('a'.repeat(129))).toBeNull();
  });

  // Each bad character is added to an otherwise valid token, so only the character is wrong.
  // '+', '/' and '=' are in normal base64 but never in token_urlsafe (and in a URL, '+' is
  // read as a space); a line break or '<' would be unsafe in an HTTP header or the page.
  it.each([' ', '+', '/', '=', '\n', '<'])('rejects a token containing %j', (char) => {
    expect(parseToken(MIN_TOKEN + char)).toBeNull();
  });
});

describe('resolveHostAppLaunch', () => {
  it('does nothing when the Host App is not configured (GitHub Pages build)', () => {
    // Even a valid token is ignored: without a config, launch links must not do anything
    const history = makeHistory();
    const storage = makeStorage();
    const result = resolveHostAppLaunch({
      config: null,
      location: makeLocation(`?token=${TOKEN}`),
      history,
      baseUrl: BASE_URL,
      storage,
    });
    expect(result).toEqual({ status: 'none' });
    expect(history.replaceState).not.toHaveBeenCalled();
    expect(storage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
  });

  it('does nothing when opened without launch parameters (plain local-files use)', () => {
    const history = makeHistory();
    const result = resolveHostAppLaunch({
      config: CONFIG,
      location: makeLocation('', '#/about'),
      history,
      baseUrl: BASE_URL,
      storage: makeStorage(),
    });
    expect(result).toEqual({ status: 'none' });
    // a normal visit's URL is left alone
    expect(history.replaceState).not.toHaveBeenCalled();
  });

  it.each(['', 'abc', 'a'.repeat(31) + '<'])('rejects the invalid token %j', (value) => {
    // synchronous, so the call is wrapped in a function for toThrow
    expect(() =>
      resolveHostAppLaunch({
        config: CONFIG,
        location: makeLocation(`?token=${encodeURIComponent(value)}`),
        history: makeHistory(),
        baseUrl: BASE_URL,
        storage: makeStorage(),
      })
    ).toThrow(/token/);
  });

  it('does not repeat the token in the error message (it is a secret)', () => {
    const almostToken = TOKEN + '<'; // invalid only because of the last character
    expect(() =>
      resolveHostAppLaunch({
        config: CONFIG,
        location: makeLocation(`?token=${encodeURIComponent(almostToken)}`),
        history: makeHistory(),
        baseUrl: BASE_URL,
        storage: makeStorage(),
      })
    ).toThrow(expect.objectContaining({ message: expect.not.stringContaining(TOKEN) }));
  });

  it('stores the token, removes it from the URL and opens PatientView', () => {
    const history = makeHistory();
    const storage = makeStorage();
    const result = resolveHostAppLaunch({
      config: CONFIG,
      location: makeLocation(`?token=${TOKEN}`),
      history,
      baseUrl: BASE_URL,
      storage,
    });
    expect(result).toEqual({ status: 'ready', token: TOKEN });
    expect(storage.getItem(TOKEN_STORAGE_KEY)).toBe(TOKEN);
    // Set before the first render, so HashRouter starts on PatientView
    expect(history.replaceState).toHaveBeenCalledWith(null, '', '/videpe/#/patient-view');
  });

  it('uses the stored token after a reload, when the URL no longer has one', () => {
    // One storage for both calls: the same tab, before and after the reload
    const storage = makeStorage();
    resolveHostAppLaunch({
      config: CONFIG,
      location: makeLocation(`?token=${TOKEN}`),
      history: makeHistory(),
      baseUrl: BASE_URL,
      storage,
    });
    const reloadResult = resolveHostAppLaunch({
      config: CONFIG,
      location: makeLocation('', '#/patient-view'),
      history: makeHistory(),
      baseUrl: BASE_URL,
      storage,
    });
    expect(reloadResult).toEqual({ status: 'ready', token: TOKEN });
  });

  it('lets a token in the URL win over a stored one (a new launch in the same tab)', () => {
    const storage = makeStorage();
    storage.setItem(TOKEN_STORAGE_KEY, 'b'.repeat(32)); // from an earlier launch
    const result = resolveHostAppLaunch({
      config: CONFIG,
      location: makeLocation(`?token=${TOKEN}`),
      history: makeHistory(),
      baseUrl: BASE_URL,
      storage,
    });
    expect(result).toEqual({ status: 'ready', token: TOKEN });
    expect(storage.getItem(TOKEN_STORAGE_KEY)).toBe(TOKEN);
  });

  it('ignores and removes an invalid stored token', () => {
    // A reload shouldn't turn a stale or changed stored value into an error page
    const storage = makeStorage();
    storage.setItem(TOKEN_STORAGE_KEY, 'abc');
    const result = resolveHostAppLaunch({
      config: CONFIG,
      location: makeLocation(''),
      history: makeHistory(),
      baseUrl: BASE_URL,
      storage,
    });
    expect(result).toEqual({ status: 'none' });
    expect(storage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
  });
});

// Some browsers block sessionStorage (e.g. strict privacy settings): reading window.sessionStorage
// then throws, or only using it does. The launch should still work then, just without
// surviving a reload.
describe('getTabStorage', () => {
  it("returns the tab's sessionStorage when it works", () => {
    expect(getTabStorage(() => window.sessionStorage)).toBe(window.sessionStorage);
  });

  it.each([
    [
      'reading it throws',
      () => {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    ],
    [
      'using it throws',
      () => ({
        getItem: () => null,
        setItem: () => {
          throw new DOMException('Quota exceeded', 'QuotaExceededError');
        },
        removeItem: () => {},
      }),
    ],
  ])('falls back to a working in-memory store when %s', (_label, getStorage) => {
    const storage = getTabStorage(getStorage);
    expect(storage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
    storage.setItem(TOKEN_STORAGE_KEY, 'a'.repeat(32));
    expect(storage.getItem(TOKEN_STORAGE_KEY)).toBe('a'.repeat(32));
    storage.removeItem(TOKEN_STORAGE_KEY);
    expect(storage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
  });
});
