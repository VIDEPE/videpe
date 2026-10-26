// Minimal client for the Host App datasets service, used when VIDEPE is launched from a Host App.
// Only reads data — VIDEPE never writes back to the Host App.
//
// Endpoints (relative to `apiBase`, e.g. '/api', same-origin via the viewer
// host's nginx proxy — the same paths Host App's own Angular front-end uses):
// - GET examinations/{id}                              → examination (incl. extraDataFilePathList)
// - GET datasets/examination/{id}                      → the examination's datasets
// - GET datasets/download/{id}?format=nii              → one dataset as a ZIP
// - GET examinations/extra-data-download/{id}/{name}/  → one file attached to the examination

// Turns a failed response into an error message a user can act on.
function describeHttpError(response, what, appName) {
  switch (response.status) {
    case 401:
      return `${appName} no longer accepts this launch (for example because it was closed or restarted). ${what}. Click 'View in VIDEPE' in ${appName} again.`;
    case 403:
      return `${appName} no longer accepts this launch (for example because it was closed or restarted). ${what}. Click 'View in VIDEPE' in ${appName} again.`;
    case 404:
      return `${what} was not found in ${appName}.`;
    default:
      return `${appName} request for ${what} failed (HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}).`;
  }
}

/**
 * Creates a client bound to one Host App deployment and signed-in user.
 *
 * @param {Object} params
 * @param {string} params.apiBase - datasets service base URL, without trailing slash.
 * @param {() => Promise<string>} params.getAccessToken - resolves to a valid access token;
 *   called before every request so a token renewed mid-session is picked up.
 * @param {typeof fetch} [params.fetchImpl=fetch] - fetch implementation function to make HTTP requests,
 *  default the browser's default 'fetch' is used. This way tests can swap in fake vi.fn() instead of real fetch.
 * @returns {{
 *   getExamination: (examinationId: number, signal?: AbortSignal) => Promise<object>,
 *   listExaminationDatasets: (examinationId: number, signal?: AbortSignal) => Promise<object[]>,
 *   downloadDatasetZip: (datasetId: number, signal?: AbortSignal) => Promise<Blob>,
 *   downloadExtraData: (examinationId: number, fileName: string, signal?: AbortSignal) => Promise<File>,
 * }} the client. Every method rejects with a readable Error on a non-2xx response, and
 *   with an AbortError once `signal` is aborted.
 */
export function createHostAppClient({ apiBase, token, appName, fetchImpl = fetch }) {
  // Authenticated GET; resolves to the Response, rejects on non-2xx.
  // Shared by every method below: `path` is appended to apiBase, `what` names the
  // requested item in error messages (e.g. "dataset 42 was not found in Shanoir.").
  // Signal carries the AbortSignal (optional), which when given can cancel in-flight requests
  // HTTP Status codes:
  // Range	| Meaning	            | Examples
  // ---------------------------------------------------------
  // 2xx	  | Success	            | 200 OK, 204 No Content
  // 3xx	  | Redirect	          | 301, 302
  // 4xx	  | Request was refused	| 401 not signed in, 403 no permission, 404 not found
  // 5xx	  | Server failed	      | 500, 502
  const get = async (path, what, signal) => {
    // Ask for the token on every request, so a token renewed mid-session is used
    const response = await fetchImpl(`${apiBase}/${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    });
    if (!response.ok) throw new Error(describeHttpError(response, what, appName));
    return response;
  };

  // The client: one method per Host App endpoint VIDEPE uses (all read-only).
  return {
    // Examination details as JSON — VIDEPE uses its extraDataFilePathList (files
    // attached to the examination, e.g. electrode positions).
    async getSession(signal) {
      const response = await get(`${apiBase}/session`, signal);
      return response.json();
    },

    // Downloads one file attached to the session (not zipped), returned as a File
    // named after it, so it can go straight into the intake.
    async downLoadFile(file, signal) {
      const response = await get(`${file.url}`, signal);
      return new File([await response.blob()], file.name);
    },
  };
}
