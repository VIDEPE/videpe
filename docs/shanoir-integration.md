# Opening VIDEPE from Shanoir

This guide is for the Shanoir-ng team. Shanoir opens an examination's EEG and imaging in [VIDEPE](https://github.com/VIDEPE/videpe) through its **View EEG** button, the same way the **View** button opens OHIF. This guide describes how that works, what VIDEPE loads from an examination, how [shanoir-ng](https://github.com/fli-iam/shanoir-ng) integrates it (as of 2.18.1), what has been agreed with the Shanoir team, and the open questions.

The integration mirrors what Shanoir does for OHIF: copy a published Docker image into the viewer nginx, add an nginx server block, fill in a config file at startup, register a Keycloak client and add a button. No Shanoir backend code is involved.

## How it works

```
Shanoir front ──"View EEG"──▶ https://<videpe-host>/videpe/?examinationId=42
                                         │
                VIDEPE (static files in the viewer nginx, runs in the browser)
                                         │ 1. OIDC sign-in with Shanoir's Keycloak
                                         │    (Authorization Code + PKCE, public client
                                         │    "videpe-viewer"; SSO, so no password prompt)
                                         │ 2. Read-only API calls with the user's token
                                         ▼
           https://<videpe-host>/shanoir-ng/datasets/…  ──proxy──▶  datasets service (:9904)
```

1. The button opens VIDEPE on its own viewer host (`SHANOIR_VIEWER_VIDEPE_URL_HOST`, e.g. `videpe`) with the examination ID in the URL.
2. VIDEPE signs the user in through the `shanoir-ng` realm. Users already logged in to Shanoir come straight back through SSO.
3. VIDEPE lists the examination's datasets, downloads them (and the extra-data files attached to the examination or to the recording's acquisition, e.g. *_electrodes.tsv if they are present) with the user's access token, and opens them in its viewers. Everything is processed in the browser; VIDEPE has no server-side code.

The VIDEPE host proxies the datasets API (as the OHIF host does for /dicomweb/), so VIDEPE's API requests stay on its own origin and the datasets service needs no CORS configuration.

### API calls made by VIDEPE

All requests are `GET` with `Authorization: Bearer <access token>`, under `/shanoir-ng/datasets`. VIDEPE never writes to Shanoir.

| Request                                                              | Purpose                                                                                                                                              |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `examinations/{examinationId}`                                       | the examination's `extraDataFilePathList` (attached electrode positions, inverse solution, montage)                                                  |
| `datasets/examination/{examinationId}`                               | the examination's datasets, routed by `type` (`EEG` → EEG viewer, `MR`, `PET`, … → imaging viewer, `BIDS` → by the file it holds)                    |
| `datasetProcessing/inputDataset/{datasetId}`                         | the processings that use each dataset as input (also for their outputs, to follow chains)                                                            |
| `datasetProcessing/{processingId}/outputDatasets/`                   | each processing's output datasets, routed like the examination's own datasets                                                                        |
| `datasetacquisition/examination/{examinationId}`                     | the examination's acquisitions, with each one's `extraDataFilePathList`                                                                              |
| `datasets/acquisition/{acquisitionId}`                               | the datasets of each acquisition with usable extra data (and, for a BIDS recording, of each BIDS folder), to find the loaded recording's acquisition |
| `datasets/download/{datasetId}?format=nii`                           | each dataset as a ZIP (imaging converted to NIfTI; EEG returned as imported)                                                                         |
| `examinations/extra-data-download/{examinationId}/{fileName}/`       | selected extra-data files (`*_electrodes.tsv`, `.elc`, `.mat`, `.mtg`)                                                                               |
| `datasetacquisition/extra-data-download/{acquisitionId}/{fileName}/` | the same, attached to the recording's acquisition                                                                                                    |

### What VIDEPE loads from an examination

VIDEPE only reads the examination it was opened for, not the subject's other examinations. Data that should be viewed together belongs in one examination.

An examination's datasets are those of its acquisitions, plus the processed datasets made from them: the outputs of processings with one of those datasets as input, and outputs made from those outputs in turn. A T1 or segmentation imported as a processed dataset therefore shows with the recording it was processed from. VIDEPE finds them the way Shanoir's study tree does, through the `datasetProcessing` requests above, because `datasets/examination/{examinationId}?output=true` answers 204 No Content for every examination (Shanoir 2.18.1).

- **EEG recording:** one per opening. When the examination holds several recordings, VIDEPE loads the most recently imported one (the highest dataset id) and lists the others as skipped. This matches VIDEPE's own file dropzone, where the newest drop wins. The EEG panel header shows the loaded recording's name with its Shanoir type (e.g. `EEG` or `BIDS`), since an EEG-tab import and a BIDS import of the same recording get near-identical names.
- **Imaging** (MR, PET, SPECT, CT, segmentation, mesh, and BIDS images): all of them, each as its own layer; users remove layers they don't need in VIDEPE.
- **Electrode positions, inverse solutions and montages:** one file of each kind, loaded together with the recording. When several are found, the one most specific to the recording wins: a file in the recording's own dataset, then the extra data attached to the recording's acquisition (uploaded on the acquisition's edit page), then the extra data attached to the examination, then (for a BIDS recording only) the BIDS datasets of the recording's own BIDS folder. Within one of these places, the last listed file wins, like a drop of several files at VIDEPE's dropzone. The files not used are listed to the user as skipped, and are not downloaded. Extra data attached to another recording's acquisition is never used. Shanoir's dataset list doesn't link a dataset to its acquisition, so VIDEPE asks the acquisitions that have usable extra data for their datasets (`datasets/acquisition/{acquisitionId}`); an examination without acquisition extra data costs no extra request.
- **BIDS datasets:** a BIDS import creates one `BIDS` dataset per file, so VIDEPE routes each by the file it holds: images join the imaging, the parts of a recording (`.vhdr`, `.eeg`, `.vmrk` with the same name) count as one recording for the rule above, and electrode positions, inverse solutions and montages go with a recording from the same BIDS folder only. One BIDS import can hold an `eeg` and an `ieeg` folder, each with its own `electrodes.tsv`, and Shanoir doesn't record which folder a recording from another import (e.g. the EEG tab) belongs to, so those recordings never use BIDS files. BIDS files that go with no loaded recording, and BIDS files VIDEPE doesn't open (e.g. `channels.tsv`, `.json`), are listed to the user as skipped.
  - VIDEPE reads the file name from the dataset name, without downloading: Shanoir names a BIDS dataset after its file with the dots replaced by underscores (`sub-4_ses-7_T1w.nii.gz` → `sub-4_ses-7_T1w_nii_gz`). A dataset whose name doesn't end in a known extension (e.g. renamed by a user) is downloaded to read the file name inside, so it's still routed correctly, only slower.
- Datasets of any other type are listed to the user as skipped.

## What VIDEPE provides

A Docker image, published by VIDEPE's CI on every release:

```
ghcr.io/videpe/videpe:<version>    e.g. ghcr.io/videpe/videpe:0.20.0
ghcr.io/videpe/videpe:latest
```

It is nginx:alpine with the built app at /usr/share/nginx/html/videpe/. Shanoir only copies that folder out of it, like it does with ohif/app. Pin a version that the Shanoir team has tested, and update it deliberately. If in doubt about which version to use, contact the VIDEPE team.

The folder contains `app-config.js`, which configures VIDEPE at runtime. The default disables Shanoir functionality (`shanoir: null`, the setting for the public GitHub Pages version); Shanoir replaces it at startup with its own settings (see below).

The loading rules in "What VIDEPE loads from an examination" need a newer VIDEPE than the 0.20.0 that Shanoir 2.18.1 pins. Until the pin is bumped, Shanoir users get 0.20.0's behaviour (the first EEG dataset only, examination extra data only, processed and BIDS datasets skipped).

## How shanoir-ng integrates VIDEPE (2.18.1)

### 1. VIDEPE in the nginx image

In `docker-compose/Dockerfile`, next to the OHIF image:

```dockerfile
FROM ghcr.io/videpe/videpe:0.20.0 AS videpe-viewer
...
COPY --link \
    nginx/videpe/app-config.js \
    nginx/videpe/videpe.template.conf \
    /etc/nginx/videpe/
COPY --link --from=videpe-viewer /usr/share/nginx/html/videpe/. /etc/nginx/videpe/html/videpe/
```

Updating VIDEPE means changing that tag.

### 2. VIDEPE's config

`docker-compose/nginx/videpe/app-config.js`; the placeholder is filled in by the entrypoint (step 3), like in OHIF's `app-config.js`:

```js
// VIDEPE runtime configuration for Shanoir (replaces VIDEPE's default app-config.js)
window.videpeConfig = {
  shanoir: {
    authority: 'SHANOIR_KEYCLOAK_URL/realms/shanoir-ng', // Keycloak realm
    clientId: 'videpe-viewer', // public client from step 5
    apiBase: '/shanoir-ng/datasets', // datasets API, proxied on the VIDEPE host (step 4)
  },
};
```

If a value is missing or still a placeholder, VIDEPE ignores the Shanoir settings (with a console warning) and opens as the plain local-files viewer.

### 3. Filled in at startup

`docker-compose/nginx/entrypoint` copies it over the default one shipped in the VIDEPE image, then runs the placeholder `sed` on it (and on `/etc/nginx/videpe.conf`, written from `videpe.template.conf`):

```sh
# Copy our VIDEPE config over the default one shipped in the VIDEPE image
cp "/etc/nginx/videpe/app-config.js" /etc/nginx/videpe/html/videpe/
```

### 4. Served on its own host, with the datasets API proxied

VIDEPE has its own `server` block in `docker-compose/nginx/http.conf` and `https.conf`, next to OHIF's, with the proxy settings shared by both viewers in `viewer.template.conf`:

```nginx
server {
    server_name SHANOIR_VIEWER_VIDEPE_URL_HOST;
    include viewer.conf;
    include videpe.conf;
}
```

`SHANOIR_VIEWER_VIDEPE_URL_SCHEME` and `SHANOIR_VIEWER_VIDEPE_URL_HOST` are set in `.env` (`https` and `videpe` in the default setup). `videpe.conf` comes from `docker-compose/nginx/videpe/videpe.template.conf`:

```nginx
# VIDEPE (EEG + imaging viewer), opened from Shanoir with ?examinationId=…
location /videpe/
{
    include mime.types;
    root /etc/nginx/videpe/html;
    index index.html;

    # VIDEPE's own CSP. Scripts are all separate files (no inline scripts); WebAssembly is
    # used for DICOM decoding; the Keycloak URL is needed for the OIDC token requests.
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' blob: SHANOIR_KEYCLOAK_URL/; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'" always;

    # Runtime config: never cached, so config changes apply immediately
    location = /videpe/app-config.js {
        add_header Cache-Control "no-store" always;
    }
}

# Datasets API for VIDEPE, same as on the main Shanoir host (avoids CORS)
location /shanoir-ng/datasets/ { proxy_pass http://SHANOIR_DATASETS_HOST:9904/; }
```

Notes:

- No `try_files` fallback is needed: VIDEPE uses hash-based routing, so the page is always `/videpe/`.
- The shared `proxy_read_timeout` and `proxy_buffering off` in `viewer.template.conf` also suit VIDEPE's dataset downloads.
- VIDEPE's image applies this same CSP when run on its own (`docker run -p 8080:80 ghcr.io/videpe/videpe:<version>`), and has been checked with it, including DICOM import.

### 5. The `videpe-viewer` Keycloak client

In `docker-compose/keycloak/cfg/shanoir-ng-realm.json`, modelled on `ohif-viewer`:

```json
{
  "clientId": "videpe-viewer",
  "name": "VIDEPE",
  "enabled": true,
  "publicClient": true,
  "standardFlowEnabled": true,
  "implicitFlowEnabled": false,
  "directAccessGrantsEnabled": false,
  "serviceAccountsEnabled": false,
  "protocol": "openid-connect",
  "redirectUris": ["SHANOIR_VIEWER_VIDEPE_URL_SCHEME://SHANOIR_VIEWER_VIDEPE_URL_HOST/videpe/*"],
  "webOrigins": ["SHANOIR_VIEWER_VIDEPE_URL_SCHEME://SHANOIR_VIEWER_VIDEPE_URL_HOST"],
  "attributes": {
    "pkce.code.challenge.method": "S256",
    "post.logout.redirect.uris": "+"
  },
  "protocolMappers": ["… the same three mappers as ohif-viewer: userId, email, username …"],
  "defaultClientScopes": ["web-origins", "profile", "roles", "basic", "email"]
}
```

- The `userId` claim in the access token is what the Shanoir services read to identify the user.
- `webOrigins` is required: VIDEPE exchanges the authorization code from the browser, a cross-origin request to Keycloak.
- VIDEPE's redirect URI is exactly `https://<videpe-host>/videpe/`.

Existing installations need the client created in the Keycloak admin console (or through their usual realm update procedure) with the same settings.

### 6. The buttons

Both open `environment.videpeUrl + '/videpe/?examinationId=' + <id>` in a new tab (`videpeUrl` defaults to `https://videpe`):

- **View EEG** on the examination page (`examination.component.ts`, `openVidepeViewer()`): shown in view mode, for users with `CAN_DOWNLOAD` on the study, when the examination has at least one dataset of type `EEG`.
- An eye/wave button in the study tree (`study-tree.component.ts`, `openInVidepe()`): enabled when exactly one examination is selected, under the same conditions.

The condition only looks at `EEG` datasets, so an examination with only BIDS datasets gets no button, even when it holds an EEG recording, and neither does an examination with only imaging, which VIDEPE also shows (see open question 1). Such an examination can still be opened by URL.

## Checking the integration

1. Import a BrainVision or EDF EEG and an MR into one examination. Optionally attach a BIDS `*_electrodes.tsv` (and an inverse solution `.mat`) to the examination or to the recording's acquisition as extra data.
2. Click **View EEG** while logged in to Shanoir. The new tab should open directly on VIDEPE's patient view without a password prompt, with the EEG and the MR loaded (and electrode positions, if attached).
3. The browser console should show no CSP violations.
4. Reloading the VIDEPE tab should sign in again (through SSO) and reload the same examination.

## Security notes

- VIDEPE is a static single-page app; it runs no code on the server and only reads data the signed-in user can access through the existing API.
- Access tokens are kept in memory only (never in `localStorage`/`sessionStorage`); closing or reloading the tab discards them. Only the short-lived PKCE state is kept in `sessionStorage` during the sign-in redirect.
- Shanoir controls the deployed version (pinned image tag) and the security headers (nginx location above).

## Agreed with the Shanoir team

- **Study rights:** exactly the same as OHIF, so users aren't confused about access rights: `CAN_DOWNLOAD` for the dataset downloads and `CAN_SEE_ALL` for the extra data. VIDEPE has to download the files to display them in the browser, so users without `CAN_DOWNLOAD` get an error when opening an examination, as they would in OHIF.
- **Imaging as NIfTI:** VIDEPE keeps requesting imaging with `format=nii` (converted from DICOM on Shanoir's server on every download). No benchmarks have been run, but the performance is adequate, so converting in the browser instead (`format=dcm`) isn't needed for now.
- **Streaming EEG recordings (to do):** Shanoir can offer an endpoint that serves a single file of an EEG dataset (such as the `.eeg` data file) with support for HTTP `Range` requests; Shanoir already streams mass downloads in Chrome.
  - EEG datasets are now downloaded as one ZIP and held in memory before anything is shown. That's fine for small recordings, but typical (epilepsy) research recordings can be multi-hour, making them slow to display or too large for memory. VIDEPE already reads recordings in chunks, so with range requests it can load only the part being viewed.

## Open questions

1. Could the button be renamed **View in VIDEPE** and shown for every examination (to users with `CAN_DOWNLOAD`), not only for examinations with an `EEG` dataset?
   - VIDEPE opens the examination's imaging and electrode positions too, not just the EEG, and also works for examinations with only imaging: OHIF is the more advanced DICOM viewer, but VIDEPE's imaging viewer (NiiVue) can show image layers of various sorts (e.g. a T1 with segmentations and atlases on top) more nicely. Allowing both viewing options give choice to the users.
   - It would also cover examinations whose EEG recording came in through a BIDS import: their datasets are all of type `BIDS`, so the current condition hides the button although VIDEPE loads their recording.
2. VIDEPE routes BIDS datasets by their name (the file name with dots replaced by underscores, e.g. `sub-4_ses-7_T1w_nii_gz`). Is that naming stable? Alternatively, could the dataset information the API returns include the BIDS folder (`anat`/`eeg`/`ieeg`) and the original file name? For example, a dataset in `datasets/examination/{examinationId}` (field names only as an illustration):

   ```json
   {
     "id": 47,
     "name": "sub-4_ses-7_T1w_nii_gz",
     "type": "BIDS",
     "bidsDataType": "anat",
     "fileName": "sub-4_ses-7_T1w.nii.gz"
   }
   ```

   - VIDEPE falls back to downloading a dataset whose name doesn't match, so a change wouldn't break loading, but it would download every BIDS file (incl. large recordings that aren't shown) to find out what it holds.
   - The BIDS folder would also tell VIDEPE which electrode positions belong to which recording directly, instead of looking up each BIDS acquisition's datasets.

3. A T1 or segmentation imported as a processed dataset (the output of a processing, e.g. with the examination's EEG recording as input) isn't part of an acquisition: Shanoir lists it under that processing, below its input dataset in the study tree. So `datasets/examination/{id}` doesn't return it, and VIDEPE needs `?output=true`, which should also return the processed datasets, in one request. But `GET datasets/examination/{id}?output=true` answers 204 No Content for every examination (2.18.1, and `develop`/`master` at the time of writing): `DatasetRepository.findByIdsWithProcessingAncestorsAndExamination` uses an inner `JOIN FETCH` on both `datasetProcessing` and `datasetAcquisition`, so only datasets with both survive. A `LEFT JOIN FETCH` would fix it.
   - VIDEPE works around it with the `datasetProcessing` requests (one per dataset), which would no longer be needed once this works.
