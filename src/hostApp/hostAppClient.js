import { isNonEmptyString, resolveSameOriginPath, isJsonObject } from '@/utils/configValidation';

// Minimal client for a host app's API, used when VIDEPE is launched from a host app (e.g. a
// local Python app). Only reads data — VIDEPE never writes back to the host app.
//
// Endpoints, served by the same local server that serves VIDEPE (so all requests stay
// same-origin), each request carrying the launch token as `Authorization: Bearer <token>`:
// - GET {apiBase}/session  → the list of files to open: { version, files: [{ name, url }, …] }
// - GET {file url}         → one file's contents, at the url given in that list

// Turns a failed response into an error message a user can act on.
function describeHttpError(response, what, appName) {
  switch (response.status) {
    case 401: // fall through to 403, they can share the same messsage as with the HostApp there is no real sign-in/permission.
    case 403:
      return `${appName} no longer accepts this launch (for example because it was closed or restarted). Click 'View in VIDEPE' in ${appName} again.`;
    case 404:
      return `${what} was not found in ${appName}.`;
    default:
      return `${appName} request for ${what} failed (HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}).`;
  }
}

/**
 * Creates a client bound to one host-app launch.
 *
 * @param {Object} params
 * @param {string} params.apiBase - base path of the host app's API, without trailing slash
 *   (from getHostAppConfig, e.g. '/api').
 * @param {string} params.token - the launch token (from resolveHostAppLaunch). It stays the
 *   same for the whole launch, so it's passed once instead of fetched before every request.
 * @param {string} params.appName - the host app's name (from getHostAppConfig), used in error
 *   messages, e.g. "Click 'View in VIDEPE' in My Host App again."
 * @param {typeof fetch} [params.fetchImpl=fetch] - fetch implementation function to make HTTP requests,
 *  default the browser's default 'fetch' is used. This way tests can swap in fake vi.fn() instead of real fetch.
 * @returns {{
 *   getSession: (signal?: AbortSignal) => Promise<{ name: string, url: string }[]>,
 *   downLoadFile: (file: { name: string, url: string }, signal?: AbortSignal) => Promise<File>,
 * }} the client:
 *   - `getSession`: the checked list of files to open, each with its name and its cleaned-up
 *     same-origin url. Rejects when the host app uses another contract version than 1, or
 *     sends an invalid list (not a list, a file without a name or url, or a url that leads
 *     to another server) — a single bad file rejects the whole list.
 *   - `downLoadFile`: one file from that list, downloaded as a File named after it.
 *   Every method rejects with a readable Error on a non-2xx response, and with an AbortError
 *   once `signal` is aborted.
 */
export function createHostAppClient({ apiBase, token, appName, fetchImpl = fetch }) {
  // Authenticated GET; resolves to the Response, rejects on non-2xx.
  // url: the full same-origin address to request (e.g. '/api/session' or a file's url)
  // what: a readable name for the thing being loaded, only used in error messages
  //   (e.g. "file rec.vhdr was not found in My Host App.")
  // signal: the AbortSignal (optional), which when given can cancel in-flight request
  // Shared by every method below. Every request carries the launch token, which the host
  // app checks.
  // HTTP Status codes:
  // Range	| Meaning	            | Examples
  // ---------------------------------------------------------
  // 2xx	  | Success	            | 200 OK, 204 No Content
  // 3xx	  | Redirect	          | 301, 302
  // 4xx	  | Request was refused	| 401 not signed in, 403 no permission, 404 not found
  // 5xx	  | Server failed	      | 500, 502
  const get = async (url, what, signal) => {
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    });
    if (!response.ok) throw new Error(describeHttpError(response, what, appName));
    return response;
  };

  const invalidList = (reason) =>
    new Error(
      `${appName} sent an invalid list of files to open (${reason}). Please report this to the developers of ${appName}.`
    );

  // The client: one method per host-app endpoint VIDEPE uses (all read-only).
  return {
    // Asks the host app which files the user picked to open in VIDEPE. The answer is only a
    // list: each file's name and the address to download it from (with downloadFile below),
    // plus the version of the host-app contract the host app follows. Example answer:
    //   { version: 1, files: [{ name: 'rec.vhdr', url: '/api/files/0' }, …] }
    async getSession(signal) {
      const response = await get(`${apiBase}/session`, 'the list of files to open', signal);
      // read the answer: response.json() throws (a SyntaxError) when the body isn't JSON at
      // all, e.g. an HTML error page — turned into a readable message instead
      const session = await response.json().catch(() => {
        throw invalidList('the answer is not JSON');
      }); // { version: 1, files: [{ name, url }, …] }
      // check if the answer is a JSON object { … }, not a list, text, a number or null
      if (!isJsonObject(session)) throw invalidList('the answer is not a JSON object');
      // check version
      if (session?.version !== 1)
        throw new Error(
          `${appName} uses a different version of the VIDEPE connection (version ${session?.version}) than this VIDEPE supports (version 1). Update VIDEPE or ${appName}.`
        );

      // The version is right, so any problem below is a bug in the host app: the messages
      // all start the same way, and point the user to the host app's developers.

      // check if returned files is an array
      if (!Array.isArray(session.files)) throw invalidList('the files are not in a list');
      // Loop over session.
      // A single bad entry rejects the whole session, before any download starts.
      const files = session.files.map((file, index) => {
        // index + 1, so the user reads "file 1" for the first file
        const which = `file ${index + 1}`;
        if (typeof file !== 'object' || file === null) {
          throw invalidList(`${which} is not a { name, url } entry`);
        }
        if (!isNonEmptyString(file.name)) throw invalidList(`${which} has no name`);
        if (!isNonEmptyString(file.url)) throw invalidList(`${which} (${file.name}) has no url`);
        // The token is sent to this url too, so it must stay on the server that served VIDEPE
        const { path, problem } = resolveSameOriginPath(file.url);
        if (problem) throw invalidList(`the url of ${which} (${file.name}) is ${problem}`);
        return { name: file.name, url: path }; // the checked, cleaned-up url
      });
      return files;
    },

    // Downloads one file from the session's list (`{ name, url }`, as returned by getSession),
    // returned as a File named after it, so it can go straight into the EEG or imaging intake
    // like a dropped file.
    async downloadFile(file, signal) {
      const response = await get(file.url, `file ${file.name}`, signal);
      return new File([await response.blob()], file.name);
    },
  };
}
