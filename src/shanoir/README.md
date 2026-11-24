# Shanoir integration: code map

How VIDEPE gets from Shanoir's **View EEG** button to data in the viewers, and which file does what. For what VIDEPE loads from an examination (which recording, which electrode file wins, BIDS) and how Shanoir hosts VIDEPE, see [docs/shanoir-integration.md](../../docs/shanoir-integration.md); this page doesn't repeat those rules.

## Data flow

```
Shanoir "View EEG" → https://<videpe-host>/videpe/?examinationId=7

src/main.jsx, before the app renders
  shanoirConfig.js         Keycloak URL, client and API path from app-config.js (null: not a Shanoir deployment)
  shanoirAuth.js           the OIDC sign-in handler (oidc-client-ts UserManager), and the access token
  shanoirLaunch.js         1st visit: redirect to Keycloak, examinationId kept in the OIDC state
                           back from Keycloak: exchange the code for tokens, open PatientView
  ShanoirLaunchPages.jsx   the sign-in screen meanwhile, or the error page
  shanoirClient.js         the API requests, each with the user's access token
  ShanoirSessionContext    hands { client, examinationId } to the app
        │
        ▼
src/pages/PatientView.jsx
  useShanoirData.js        reads the session and starts the load
        │
        ▼
  fetchShanoirExamination.js   all requests go through shanoirClient.js
    1. list the examination's datasets, its acquisitions and the examination itself,
       then the processed datasets made from them (listProcessedOutputs)
    2. sort the BIDS datasets by the file each holds                      → bidsDatasets.js
       and the other datasets by Shanoir type                             → shanoirFiles.js
    3. pick the latest recording (highest dataset id); the others are skipped
    4. for that recording (fetchEegRecording):
         find its acquisition (findRecordingAcquisition)
         list its electrode, inverse and montage files from the dataset zip,
         the acquisition, the examination and its BIDS folder
         keep one of each kind                                            → shanoirFiles.js
         download only the kept files
    5. download and unzip the imaging; collect everything skipped, and why
        │
        ▼  { eegFiles, imagingFiles, eegDataset, skippedDatasets, skippedFiles }
  useShanoirData.js        builds the skipped toast (ShanoirSkippedWarning.jsx) and the EEG name
        │
        ▼
src/hooks/useLaunchData.js (shared with the host-app launch)
  eegFiles     → handleEegFiles (useEegFileIntake), as if dropped on the EEG dropzone
  imagingFiles → filesToLayers → setLayers (imaging viewer)
  one loading → success/error toast, plus the skipped toast
```

## Files

| File                         | What it does                                                                                                                                          |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shanoirConfig.js`           | Reads and checks the Shanoir settings in `window.videpeConfig` (`public/app-config.js`, filled in by Shanoir's nginx at startup).                     |
| `shanoirAuth.js`             | Creates the oidc-client-ts `UserManager` for Shanoir's Keycloak, and gives the access token for each request (an error once the sign-in has expired). |
| `shanoirLaunch.js`           | The launch and callback steps of the sign-in, run in `main.jsx` before the app renders.                                                               |
| `ShanoirLaunchPages.jsx`     | The sign-in screen and the error page shown during a launch.                                                                                          |
| `ShanoirSessionContext.jsx`  | React context holding `{ client, examinationId }` after sign-in; `null` when VIDEPE wasn't opened from Shanoir.                                       |
| `shanoirClient.js`           | One method per Shanoir API request (all `GET`), with the token; list requests turn a 204 into `[]`.                                                   |
| `useShanoirData.js`          | The hook in PatientView: runs `fetchShanoirExamination` through `useLaunchData`, and turns its result into the skipped toast and the EEG name.        |
| `fetchShanoirExamination.js` | The pipeline in steps 1–5 above: decides what to load and what to skip, and downloads it.                                                             |
| `bidsDatasets.js`            | BIDS datasets (one per file): reads the file name from the dataset name, groups a recording's parts, sorts images, recordings and extras.             |
| `shanoirFiles.js`            | Routes a dataset by its Shanoir type, recognises electrode, inverse and montage files, and keeps one file of each kind.                               |
| `ShanoirSkippedWarning.jsx`  | The skipped toast's message: skipped datasets grouped by reason, and skipped files.                                                                   |
| `fakeShanoirClient.js`       | A stand-in client serving the demo data, for `?preview=shanoir` under `npm run dev` (see `main.jsx`); never in a production build.                    |

Shared with the host-app launch: `src/hooks/useLaunchData.js` (loading into the viewers, toasts, cancelling) and `src/utils/launchFiles.js` (which files of a download the viewers open).

## Tests

The tests are in `src/test/shanoir/`, named after the file they test; the skipped toast is tested in `useShanoirData.test.js`. `fetchShanoirExamination.test.js` mostly uses small hand-written responses; five of its tests use real Shanoir responses from `src/test/shanoir/fixtures/` (see the [README there](../test/shanoir/fixtures/README.md)).

To try the flow without Shanoir, run `npm run dev` and open `/videpe/?preview=shanoir` (fake client), or `?preview=shanoir-signin` / `?preview=shanoir-error` for the launch pages. To check it against a real Shanoir, see "Checking the integration" in [docs/shanoir-integration.md](../../docs/shanoir-integration.md).
