// Minimal client for the Shanoir datasets service, used when VIDEPE is launched from Shanoir.
// Only reads data — VIDEPE never writes back to Shanoir.
//
// Endpoints (relative to `apiBase`, e.g. '/shanoir-ng/datasets', same-origin via the viewer
// host's nginx proxy — the same paths Shanoir's own Angular front-end uses):
// - GET examinations/{id}                              → examination (incl. extraDataFilePathList)
// - GET datasets/examination/{id}                      → the examination's datasets
// - GET datasetProcessing/inputDataset/{id}            → processings using a dataset as input
// - GET datasetProcessing/{id}/outputDatasets/         → a processing's output datasets
// - GET datasetacquisition/examination/{id}            → the examination's acquisitions (incl. extraDataFilePathList)
// - GET datasets/acquisition/{id}                      → an acquisition's datasets
// - GET datasets/download/{id}?format=nii              → one dataset as a ZIP
// - GET examinations/extra-data-download/{id}/{name}/  → one file attached to the examination
// - GET datasetacquisition/extra-data-download/{id}/{name}/ → one file attached to an acquisition

// Always request format=nii: NiiVue reads NIfTI directly.
// `format` only changes imaging datasets that Shanoir stores as DICOM — those are converted
// to NIfTI server-side on each download. Everything else is returned in its stored format:
// EEG datasets as their original recording files (e.g. BrainVision .vhdr/.vmrk/.eeg), and
// imaging datasets already stored as NIfTI (e.g. processed outputs) as .nii.
const IMAGING_DOWNLOAD_FORMAT = 'nii';

// Turns a failed response into an error message a user can act on.
function describeHttpError(response, what) {
  switch (response.status) {
    case 401:
      return `Shanoir sign-in expired or was rejected while loading ${what}. Reopen VIDEPE from Shanoir.`;
    case 403:
      return `You don't have permission to access ${what} in Shanoir.`;
    case 404:
      return `${what} was not found in Shanoir.`;
    default:
      return `Shanoir request for ${what} failed (HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}).`;
  }
}

/**
 * Creates a client bound to one Shanoir deployment and signed-in user.
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
 *   listProcessingsByInputDataset: (datasetId: number, signal?: AbortSignal) => Promise<object[]>,
 *   listProcessingOutputDatasets: (processingId: number, signal?: AbortSignal) => Promise<object[]>,
 *   listExaminationAcquisitions: (examinationId: number, signal?: AbortSignal) => Promise<object[]>,
 *   listAcquisitionDatasets: (acquisitionId: number, signal?: AbortSignal) => Promise<object[]>,
 *   downloadDatasetZip: (datasetId: number, signal?: AbortSignal) => Promise<Blob>,
 *   downloadExtraData: (examinationId: number, fileName: string, signal?: AbortSignal) => Promise<File>,
 *   downloadAcquisitionExtraData: (acquisitionId: number, fileName: string, signal?: AbortSignal) => Promise<File>,
 * }} the client. Every method rejects with a readable Error on a non-2xx response, and
 *   with an AbortError once `signal` is aborted.
 */
export function createShanoirClient({ apiBase, getAccessToken, fetchImpl = fetch }) {
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
    const token = await getAccessToken();
    const response = await fetchImpl(`${apiBase}/${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    });
    if (!response.ok) throw new Error(describeHttpError(response, what));
    return response;
  };

  // Authenticated GET of a JSON list. Shanoir answers 204 No Content (no body) instead of an
  // empty list, e.g. for an examination without datasets or a dataset no processing uses.
  const getList = async (path, what, signal) => {
    const response = await get(path, what, signal);
    if (response.status === 204) return [];
    return response.json();
  };

  // The client: one method per Shanoir endpoint VIDEPE uses (all read-only).
  return {
    // Examination details as JSON — VIDEPE uses its extraDataFilePathList (files
    // attached to the examination, e.g. electrode positions).
    async getExamination(examinationId, signal) {
      const response = await get(
        `examinations/${examinationId}`,
        `examination ${examinationId}`,
        signal
      );
      return response.json();
    },

    // Metadata of every dataset in the examination (id, name, type: 'EEG', 'MR', …),
    // used to decide what to download — no data files yet.
    // Only datasets of the examination's acquisitions: processed datasets have no acquisition,
    // see the two processing methods below.
    async listExaminationDatasets(examinationId, signal) {
      return getList(
        `datasets/examination/${examinationId}`,
        `the datasets of examination ${examinationId}`,
        signal
      );
    },

    // The processings that use a dataset as input (id, comment, …), as Shanoir's study tree
    // lists them under a dataset. Their output datasets come from listProcessingOutputDatasets:
    // the list leaves each processing's outputDatasets empty.
    async listProcessingsByInputDataset(datasetId, signal) {
      return getList(
        `datasetProcessing/inputDataset/${datasetId}`,
        `the processings of dataset ${datasetId}`,
        signal
      );
    },

    // Metadata of a processing's output datasets (id, name, type), like listExaminationDatasets.
    async listProcessingOutputDatasets(processingId, signal) {
      return getList(
        `datasetProcessing/${processingId}/outputDatasets/`,
        `the output datasets of processing ${processingId}`,
        signal
      );
    },

    // The examination's acquisitions (id, name, type, extraDataFilePathList: the files
    // attached to each acquisition, e.g. electrode positions uploaded on its edit page).
    async listExaminationAcquisitions(examinationId, signal) {
      return getList(
        `datasetacquisition/examination/${examinationId}`,
        `the acquisitions of examination ${examinationId}`,
        signal
      );
    },

    // Metadata of an acquisition's datasets, like listExaminationDatasets. This is how VIDEPE
    // links a dataset to its acquisition: listExaminationDatasets leaves datasetAcquisition
    // empty (Shanoir 2.18.1).
    async listAcquisitionDatasets(acquisitionId, signal) {
      return getList(
        `datasets/acquisition/${acquisitionId}`,
        `the datasets of acquisition ${acquisitionId}`,
        signal
      );
    },

    // Downloads one dataset's files as a ZIP Blob (Shanoir offers no per-file download);
    // unzip with unzipToFiles.
    async downloadDatasetZip(datasetId, signal) {
      const response = await get(
        `datasets/download/${datasetId}?format=${IMAGING_DOWNLOAD_FORMAT}`,
        `dataset ${datasetId}`,
        signal
      );
      return response.blob();
    },

    // Downloads one file attached to the examination (not zipped), returned as a File
    // named after it, so it can go straight into the EEG intake.
    async downloadExtraData(examinationId, fileName, signal) {
      // Trailing slash matches Shanoir's route `extra-data-download/{examinationId}/{fileName:.+}/`
      const response = await get(
        `examinations/extra-data-download/${examinationId}/${encodeURIComponent(fileName)}/`,
        `file ${fileName}`,
        signal
      );
      return new File([await response.blob()], fileName);
    },

    // Downloads one file attached to an acquisition (not zipped), like downloadExtraData.
    async downloadAcquisitionExtraData(acquisitionId, fileName, signal) {
      // Trailing slash matches Shanoir's route, as for the examination's extra data
      const response = await get(
        `datasetacquisition/extra-data-download/${acquisitionId}/${encodeURIComponent(fileName)}/`,
        `file ${fileName}`,
        signal
      );
      return new File([await response.blob()], fileName);
    },
  };
}
