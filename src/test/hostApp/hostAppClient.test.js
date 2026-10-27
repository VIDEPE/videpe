import { describe, it, expect, vi } from 'vitest';
import { createHostAppClient } from '@/hostApp/hostAppClient';

const API_BASE = '/api';
const APP_NAME = 'Test Host App';
// A token as Python's secrets.token_urlsafe(32) makes them (see hostAppLaunch.test.js)
const TOKEN = 'Abc_123-'.repeat(5) + 'xyz';

// Builds a fetch stand-in resolving to a single Response-like object.
const okJson = (body) => ({ ok: true, status: 200, json: async () => body });
const okBlob = (blob) => ({ ok: true, status: 200, blob: async () => blob });
const failed = (status, statusText = '') => ({ ok: false, status, statusText });

// A valid session answer, as the host app sends it
const FILES = [
  { name: 'rec.vhdr', url: '/api/files/0' },
  { name: 'rec.eeg', url: '/api/files/1' },
];
const SESSION = { version: 1, files: FILES };

// The client with a fake fetch (fetchImpl) that answers every request with `response`, so no
// real network is used and the tests can check how fetch was called
const makeClient = (response) => {
  const fetchImpl = vi.fn().mockResolvedValue(response);
  const client = createHostAppClient({
    apiBase: API_BASE,
    token: TOKEN,
    appName: APP_NAME,
    fetchImpl,
  });
  return { client, fetchImpl };
};

describe('createHostAppClient', () => {
  describe('getSession', () => {
    it('asks the host app for the session with the launch token, and returns its files', async () => {
      const { client, fetchImpl } = makeClient(okJson(SESSION));
      expect(await client.getSession()).toEqual(FILES);
      expect(fetchImpl).toHaveBeenCalledWith(
        '/api/session',
        expect.objectContaining({ headers: { Authorization: `Bearer ${TOKEN}` } })
      );
    });

    it('passes the abort signal through to fetch', async () => {
      const { client, fetchImpl } = makeClient(okJson(SESSION));
      const controller = new AbortController();
      await client.getSession(controller.signal);
      expect(fetchImpl.mock.calls[0][1].signal).toBe(controller.signal);
    });

    it('rejects an answer that is not JSON at all (e.g. an HTML error page)', async () => {
      // response.json() fails on such a body, like the browser's does
      const notJson = {
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token <');
        },
      };
      const { client } = makeClient(notJson);
      await expect(client.getSession()).rejects.toThrow(/not JSON/);
    });

    it.each([null, [SESSION], 'text'])(
      'rejects the answer %j, which is not a JSON object',
      async (body) => {
        const { client } = makeClient(okJson(body));
        await expect(client.getSession()).rejects.toThrow(/not a JSON object/);
      }
    );

    // Only version 1 of the host-app contract exists: anything else is a host app made for
    // another VIDEPE version, so it's rejected with a clear message instead of misread
    it.each([
      ['missing', { files: FILES }],
      ['2', { version: 2, files: FILES }],
      ['"1" (a string)', { version: '1', files: FILES }],
    ])('rejects a session whose version is %s', async (_label, session) => {
      const { client } = makeClient(okJson(session));
      await expect(client.getSession()).rejects.toThrow(/version/i);
    });

    // The answer comes from outside VIDEPE, so its shape is checked before anything is used
    it.each([
      ['no files list', { version: 1 }],
      ['files is not a list', { version: 1, files: 'rec.vhdr' }],
      ['a file without a name', { version: 1, files: [{ url: '/api/files/0' }] }],
      ['a file with an empty name', { version: 1, files: [{ name: ' ', url: '/api/files/0' }] }],
      ['a file without a url', { version: 1, files: [{ name: 'rec.vhdr' }] }],
      ['a file that is not an object', { version: 1, files: ['rec.vhdr'] }],
    ])('rejects a session with %s', async (_label, session) => {
      const { client } = makeClient(okJson(session));
      await expect(client.getSession()).rejects.toThrow();
    });

    // The token is sent to every file url too, so a url on another server would leak it.
    // The tricky urls are tested in configValidation.test.js (resolveSameOriginPath).
    it.each(['https://evil.example/f', '/\\evil.example/f'])(
      'rejects the whole session when a file url %j leads to another server',
      async (url) => {
        const session = { version: 1, files: [FILES[0], { name: 'rec.eeg', url }] };
        const { client, fetchImpl } = makeClient(okJson(session));
        await expect(client.getSession()).rejects.toThrow();
        // only the session itself was requested — no file, and nothing to the other server
        expect(fetchImpl).toHaveBeenCalledTimes(1);
      }
    );
  });

  describe('downloadFile', () => {
    it('downloads a file from its url with the launch token, as a File named after it', async () => {
      const { client, fetchImpl } = makeClient(okBlob(new Blob(['Brain Vision Data Exchange'])));
      const file = await client.downloadFile(FILES[0]);
      expect(file).toBeInstanceOf(File);
      expect(file.name).toBe('rec.vhdr');
      expect(await file.text()).toBe('Brain Vision Data Exchange');
      expect(fetchImpl).toHaveBeenCalledWith(
        '/api/files/0',
        expect.objectContaining({ headers: { Authorization: `Bearer ${TOKEN}` } })
      );
    });

    it('passes the abort signal through to fetch', async () => {
      const { client, fetchImpl } = makeClient(okBlob(new Blob([])));
      const controller = new AbortController();
      await client.downloadFile(FILES[0], controller.signal);
      expect(fetchImpl.mock.calls[0][1].signal).toBe(controller.signal);
    });
  });

  describe('errors', () => {
    // 401 and 403 mean the host app no longer accepts the launch (e.g. it was closed or
    // restarted), whatever was being loaded, so the user is told to launch again from it
    it.each([401, 403])(
      'tells the user to launch again from the host app on HTTP %i',
      async (status) => {
        const { client } = makeClient(failed(status));
        await expect(client.getSession()).rejects.toThrow(/no longer accepts this launch/);
        await expect(client.getSession()).rejects.toThrow(APP_NAME);
      }
    );

    it('names the missing file on HTTP 404', async () => {
      const { client } = makeClient(failed(404, 'Not Found'));
      await expect(client.downloadFile(FILES[1])).rejects.toThrow(/rec\.eeg/);
    });

    it('reports other failures with their HTTP status', async () => {
      const { client } = makeClient(failed(500, 'Internal Server Error'));
      await expect(client.getSession()).rejects.toThrow(/500/);
    });

    // The token is a secret: it must never end up in a message shown to the user
    it.each([401, 404, 500])(
      'leaves the token out of the error message on HTTP %i',
      async (status) => {
        const { client } = makeClient(failed(status));
        const error = await client.downloadFile(FILES[0]).catch((err) => err);
        expect(error.message).not.toContain(TOKEN);
      }
    );
  });
});
