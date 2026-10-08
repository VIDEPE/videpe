# Opening VIDEPE from Shanoir

This guide is for the Shanoir-ng team. It describes the changes needed in [shanoir-ng](https://github.com/fli-iam/shanoir-ng) to add a **View in VIDEPE** button that opens an examination's EEG and imaging in [VIDEPE](https://github.com/VIDEPE/videpe), the same way the existing **View** button opens OHIF.

The changes mirror what Shanoir already does for OHIF: copy a published Docker image into the viewer nginx, add an nginx location, fill in a config file at startup, register a Keycloak client and add a button. No Shanoir backend code changes are needed.

## How it works

```
Shanoir front ──"View in VIDEPE"──▶ https://<viewer-host>/videpe/?examinationId=42
                                         │
                VIDEPE (static files in the viewer nginx, runs in the browser)
                                         │ 1. OIDC sign-in with Shanoir's Keycloak
                                         │    (Authorization Code + PKCE, public client
                                         │    "videpe"; SSO, so no password prompt)
                                         │ 2. Read-only API calls with the user's token
                                         ▼
           https://<viewer-host>/shanoir-ng/datasets/…  ──proxy──▶  datasets service (:9904)
```

1. The button opens VIDEPE on the viewer host with the examination ID in the URL.
2. VIDEPE signs the user in through the `shanoir-ng` realm. Users already logged in to Shanoir come straight back through SSO.
3. VIDEPE lists the examination's datasets, downloads them (and the examination's extra-data files, e.g. *_electrodes.tsv if they are present) with the user's access token, and opens them in its viewers. Everything is processed in the browser; VIDEPE has no server-side code.

The viewer host proxies the datasets API (as it already does for /dicomweb/), so VIDEPE's API requests stay on its own origin and the datasets service needs no CORS configuration.

### API calls made by VIDEPE

All requests are `GET` with `Authorization: Bearer <access token>`, under `/shanoir-ng/datasets`. VIDEPE never writes to Shanoir.

| Request                                                        | Purpose                                                                                            |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `examinations/{examinationId}`                                 | the examination's `extraDataFilePathList` (attached electrode positions, inverse solution)         |
| `datasets/examination/{examinationId}`                         | the examination's datasets, routed by `type` (`Eeg` → EEG viewer, `Mr`, `Pet`, … → imaging viewer) |
| `datasets/download/{datasetId}?format=nii`                     | each dataset as a ZIP (imaging converted to NIfTI; EEG returned as imported)                       |
| `examinations/extra-data-download/{examinationId}/{fileName}/` | selected extra-data files (`*_electrodes.tsv`, `.elc`, `.mat`)                                     |

Only the first EEG dataset of an examination is loaded; any others, and unsupported dataset types, are listed to the user as skipped.

## What VIDEPE provides

A Docker image, published by VIDEPE's CI on every release:

```
ghcr.io/videpe/videpe:<version>    e.g. ghcr.io/videpe/videpe:0.19.0
ghcr.io/videpe/videpe:latest
```

It is nginx:alpine with the built app at /usr/share/nginx/html/videpe/. Shanoir only copies that folder out of it, like it does with ohif/app. Pin a version that the Shanoir team has tested, and update it deliberately. If in doubt about which version to use, contact the VIDEPE team.

The folder contains `app-config.js`, which configures VIDEPE at runtime. The default disables Shanoir functionality (`shanoir: null`, the setting for the public GitHub Pages version); Shanoir should replace it at startup with its own settings (step 3).

## Changes needed in shanoir-ng

> **Note:** these instructions were drafted with the help of an AI assistant (Claude) and checked against shanoir-ng's `develop` branch, but they have not yet been tested on a Shanoir instance and may contain errors. Use them as a guide, and adapt them to your setup where needed.

### 1. Copy VIDEPE into the nginx image

In `docker-compose/Dockerfile`, next to the OHIF image:

```dockerfile
FROM ohif/app:v3.12.5 AS nginx-viewer
FROM ghcr.io/videpe/videpe:0.19.0 AS videpe

FROM nginx AS nginx
...
COPY --link \
    nginx/viewer/app-config.js \
    nginx/viewer/videpe-app-config.js \
    nginx/viewer/ohif-viewer.template.conf \
    /etc/nginx/viewer/
COPY --link --from=nginx-viewer /usr/share/nginx/html/. /etc/nginx/viewer/html/
COPY --link --from=videpe /usr/share/nginx/html/videpe/. /etc/nginx/viewer/html/videpe/
```

### 2. Add VIDEPE's config template

New file `docker-compose/nginx/viewer/videpe-app-config.js`. The placeholder is filled in by the entrypoint (step 3), like in OHIF's `app-config.js`:

```js
// VIDEPE runtime configuration for Shanoir (replaces VIDEPE's default app-config.js)
window.videpeConfig = {
  shanoir: {
    authority: 'SHANOIR_KEYCLOAK_URL/realms/shanoir-ng', // Keycloak realm
    clientId: 'videpe', // public client from step 5
    apiBase: '/shanoir-ng/datasets', // datasets API, proxied on the viewer host (step 4)
  },
};
```

If a value is missing or still a placeholder, VIDEPE ignores the Shanoir settings (with a console warning) and opens as the plain local-files viewer.

### 3. Fill it in at startup

In `docker-compose/nginx/entrypoint`, next to the existing OHIF `app-config.js` copy:

```sh
# Copy our VIDEPE config over the default one shipped in the VIDEPE image
cp "/etc/nginx/viewer/videpe-app-config.js" /etc/nginx/viewer/html/videpe/app-config.js
```

and add `/etc/nginx/viewer/html/videpe/app-config.js` to the list of files the placeholder `sed` runs on (next to `/etc/nginx/viewer/html/app-config.js`). `/etc/nginx/ohif-viewer.conf` is already in that list, which step 4 relies on for `SHANOIR_KEYCLOAK_URL` and `SHANOIR_DATASETS_HOST`.

### 4. Serve VIDEPE and proxy the datasets API

In `docker-compose/nginx/viewer/ohif-viewer.template.conf`:

```nginx
# VIDEPE (EEG + imaging viewer), opened from Shanoir with ?examinationId=…
location /videpe/
{
    include mime.types;
    root /etc/nginx/viewer/html;
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

- `location /videpe/` has its own `add_header`, so it doesn't inherit headers from `location /` (OHIF's COOP/COEP headers aren't needed for VIDEPE).
- No `try_files` fallback is needed: VIDEPE uses hash-based routing, so the page is always `/videpe/`.
- The existing `proxy_read_timeout` and `proxy_buffering off` at the top of the template also suit VIDEPE's dataset downloads.
- VIDEPE's image applies this same CSP when run on its own (`docker run -p 8080:80 ghcr.io/videpe/videpe:<version>`), and has been checked with it, including DICOM import.

### 5. Register the `videpe` Keycloak client

In `docker-compose/keycloak/cfg/shanoir-ng-realm.json`, add a client modelled on `ohif-viewer`:

```json
{
  "clientId": "videpe",
  "name": "VIDEPE",
  "enabled": true,
  "publicClient": true,
  "standardFlowEnabled": true,
  "implicitFlowEnabled": false,
  "directAccessGrantsEnabled": false,
  "serviceAccountsEnabled": false,
  "protocol": "openid-connect",
  "redirectUris": ["SHANOIR_VIEWER_OHIF_URL_SCHEME://SHANOIR_VIEWER_OHIF_URL_HOST/videpe/*"],
  "webOrigins": ["SHANOIR_VIEWER_OHIF_URL_SCHEME://SHANOIR_VIEWER_OHIF_URL_HOST"],
  "attributes": {
    "pkce.code.challenge.method": "S256",
    "post.logout.redirect.uris": "+"
  },
  "protocolMappers": ["… same three mappers as ohif-viewer: userId, email, username …"],
  "defaultClientScopes": ["web-origins", "profile", "roles", "basic", "email"]
}
```

- Copy `protocolMappers` from `ohif-viewer` as-is. The `userId` claim in the access token is what the Shanoir services read to identify the user.
- `webOrigins` is required: VIDEPE exchanges the authorization code from the browser, a cross-origin request to Keycloak.
- VIDEPE's redirect URI is exactly `https://<viewer-host>/videpe/`.

Existing installations need the client created in the Keycloak admin console (or through their usual realm update procedure) with the same settings.

### 6. Add the button

In `shanoir-ng-front/src/app/examinations/examination/examination.component.ts`, next to `openViewer()`:

```ts
openVidepe() {
    window.open(environment.viewerUrl + '/videpe/?examinationId=' + this.entity.id, '_blank');
}
```

and a **View in VIDEPE** button next to the existing **View** button in the examination template (and the examination node of the tree, if wanted). The button could be shown only for examinations that contain an EEG dataset.

## Checking the integration

1. Import a BrainVision EEG and an MR into one examination. Optionally attach a BIDS `*_electrodes.tsv` (and an inverse solution `.mat`) to the examination as extra data.
2. Click **View in VIDEPE** while logged in to Shanoir. The new tab should open directly on VIDEPE's patient view without a password prompt, with the EEG and the MR loaded (and electrode positions, if attached).
3. The browser console should show no CSP violations.
4. Reloading the VIDEPE tab should sign in again (through SSO) and reload the same examination.

## Security notes

- VIDEPE is a static single-page app; it runs no code on the server and only reads data the signed-in user can access through the existing API.
- Access tokens are kept in memory only (never in `localStorage`/`sessionStorage`); closing or reloading the tab discards them. Only the short-lived PKCE state is kept in `sessionStorage` during the sign-in redirect.
- Shanoir controls the deployed version (pinned image tag) and the security headers (nginx location above).

## Open questions

1. Does the datasets service accept access tokens issued to a new `videpe` client (audience), as it does for `ohif-viewer`?
   - If it only accepts tokens from known clients, sign-in works but every API call is refused (401/403).
2. Is `/shanoir-ng/datasets/` → `SHANOIR_DATASETS_HOST:9904` the right proxy target on the viewer host?
   - It's copied from the main host's config; the viewer host may reach the datasets service under another name or port in some deployments.
3. VIDEPE requests imaging with `format=nii`, which converts DICOM to NIfTI on every download; NIfTI is the format VIDEPE's imaging viewer (NiiVue) reads most directly. How long does that conversion take for a typical T1 or PET series? If it's too slow, VIDEPE could request `format=dcm` and convert in the browser instead.
   - The conversion runs on Shanoir's server for every opening, so a slow conversion means a long wait for the user and extra server load.
4. Is a separate 'View in VIDEPE' button on the examination page (and tree node) fine?
   - You may prefer another placement/integration, e.g. a combined "View in…" menu or showing it only for examinations with EEG.
5. VIDEPE needs the same study rights as OHIF: `CAN_DOWNLOAD` for the dataset downloads (OHIF needs it for the image data) and `CAN_SEE_ALL` for the extra data. Is that the intended rights model for viewing in VIDEPE?
   - VIDEPE has to download the files to display them in the browser, so users without `CAN_DOWNLOAD` get an error when opening an examination, as they would in OHIF.
6. Could Shanoir offer a way to stream EEG recordings, e.g. an endpoint that serves a single file of an EEG dataset (such as the `.eeg` data file) with support for HTTP `Range` requests?
   - EEG datasets are now downloaded as one ZIP and held in memory before anything is shown. => Fine for small recordings, but typical (epilepsy) research recordings can be multi-hour, making it slow to display and not even fit in memory. VIDEPE already reads recordings in chunks, so combined with range requests it could load only the part being viewed.
