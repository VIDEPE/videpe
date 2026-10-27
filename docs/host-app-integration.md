# Opening VIDEPE from your own app

This guide is for developers of apps that want to open their data in [VIDEPE](https://github.com/VIDEPE/videpe): for example a Python tool where the user picks a few EEG and imaging files and clicks **View in VIDEPE**. VIDEPE calls such an app a **host app**.

A host app runs a small local web server that serves VIDEPE itself and the files to open, then opens VIDEPE in the browser. VIDEPE downloads the files from that server and shows them, exactly as if the user had dropped them on its viewers. Everything stays on the user's computer.

This document is the contract between VIDEPE and host apps (version 1). A host app that follows it works with every VIDEPE release that supports version 1.

## How it works

```
Host app ── "View in VIDEPE" ──▶ creates a new random token, then opens
                                 http://127.0.0.1:<port>/videpe/?token=<token>
                                         │
                VIDEPE (static files served by the host app, runs in the browser)
                                         │ 1. reads the token from the URL
                                         │ 2. GET /api/session      ─┐ every request carries
                                         │ 3. GET <each file's url>  ─┘ Authorization: Bearer <token>
                                         ▼
                        the host app's local server, on 127.0.0.1:<port>
```

1. When the user clicks **View in VIDEPE**, the host app creates a new random token and opens VIDEPE's URL with it.
2. VIDEPE reads the token, removes it from the address bar and keeps it for this tab only, so a reload of the page still works.
3. VIDEPE asks the host app for the session: the list of files to open. Files that neither of its viewers can open are skipped without being downloaded, and the user is told which ones.
4. VIDEPE downloads the remaining files and opens them in its EEG and neuroimaging viewers.

VIDEPE and the API are served by the same server (same origin), so no CORS configuration is needed.

## What the host app does

### 1. Serve VIDEPE under `/videpe/`

Serve the files of a VIDEPE build under the path `/videpe/`, which is where the build expects to be. Your app ships these files and serves them itself, from the same local server as its API.

**Recommended: take the files from the published Docker image**, for a specific VIDEPE version, once, when you package your app. The image `ghcr.io/videpe/videpe:<version>` holds the built files in `/usr/share/nginx/html/videpe/`. Use version 0.21.0 or later: earlier versions don't support host apps.

```sh
docker create --platform linux/amd64 --name videpe ghcr.io/videpe/videpe:0.21.0
docker cp videpe:/usr/share/nginx/html/videpe ./videpe-dist
docker rm videpe
```

Docker downloads the image the first time you run this. `--platform linux/amd64` is needed on computers with an ARM chip (e.g. a Mac with an Apple chip), as the image is only published for amd64; the files themselves work on any computer. `docker create` only prepares a container to copy from, without starting it, and `docker rm` removes it again.

This gives you a published, tested version, and you don't need to build VIDEPE yourself. Only you need Docker, to extract the files: your app ships the `videpe-dist` folder, so its users don't need Docker. Don't run the image as a separate server next to your app: VIDEPE and your API must be served by the same server (see step 4).

**Alternatively:** for VIDEPE's own development, or to try changes that aren't released yet, you can also build VIDEPE from its repo (`npm run build`, then the contents of `dist/`). Check out a release tag first if you want a published version.

### 2. Replace `/videpe/app-config.js`

VIDEPE reads its settings from `/videpe/app-config.js`. Serve your own version of that file instead of the one in the build, to enable the host-app mode:

```js
window.videpeConfig = {
  hostApp: {
    name: 'My Host App', // your app's name, shown to the user
    apiBase: '/api', // where your API is
  },
};
```

| Field     | Required | Rules                                                                                                                                                                                |
| --------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `name`    | Required | A non-empty string. Shown to the user, e.g. "Opened from My Host App", and in messages such as "Click 'View in VIDEPE' in My Host App again".                                        |
| `apiBase` | Required | A path on the same server that serves VIDEPE, starting with `/` (e.g. `/api`). Full URLs (`https://…`), `//host` and relative paths (`api`) are rejected. A trailing `/` is removed. |

Only the `hostApp` section is needed: VIDEPE treats every section that's left out (e.g. `shanoir`, for its Shanoir integration) as switched off.

If the section is invalid, VIDEPE ignores it with a warning in the browser console and starts as the plain local-files app.

### 3. Open VIDEPE with a new token

For every click on **View in VIDEPE**, create a new token and open:

```
http://127.0.0.1:<port>/videpe/?token=<token>
```

The token must be 32 to 128 characters long, using only `A–Z a–z 0–9 _ -`. Python's `secrets.token_urlsafe(32)` gives exactly that (43 characters). VIDEPE rejects other tokens with an error page.

The token is the only thing that proves a request comes from the tab your app opened, so treat it as a secret: create a new one for every launch, never write it to logs, and stop accepting it when your app closes or a new launch replaces it.

### 4. Answer VIDEPE's requests

VIDEPE only sends `GET` requests, each with the header `Authorization: Bearer <token>`. Answer requests without the current token with `401`. VIDEPE never writes anything back to your app.

| Request                 | Answer                                                   |
| ----------------------- | -------------------------------------------------------- |
| `GET {apiBase}/session` | The session as JSON (see below)                          |
| `GET {file url}`        | The bytes of one file, at the `url` given in the session |

## The session answer

```json
{
  "version": 1,
  "title": "Patient 012 – resting state",
  "files": [
    { "name": "rec.vhdr", "url": "/api/files/0" },
    { "name": "rec.eeg", "url": "/api/files/1" },
    { "name": "sub-012_T1w.nii.gz", "url": "/api/files/2" }
  ]
}
```

| Field     | Required | Rules                                                                                                                                                                                            |
| --------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `version` | Required | The number `1`: the version of this contract your app follows. VIDEPE rejects other versions, telling the user to update VIDEPE or your app.                                                     |
| `title`   | Optional | What your app calls this launch (e.g. a patient code or recording date), shown next to your app's name. Leave it out if there's nothing useful to show; an empty or non-string title is ignored. |
| `files`   | Required | A list of the files to open, each with a `name` and a `url`. An empty list is allowed: VIDEPE then tells the user there was nothing to open.                                                     |
| `name`    | Required | A non-empty string: the file name, including its extension. VIDEPE decides from the extension which viewer opens the file (see below).                                                           |
| `url`     | Required | Where to download the file, as a path on the same server that serves VIDEPE (starting with `/`). Like `apiBase`, it may not lead to another server, as VIDEPE sends the token there too.         |

If the answer isn't valid JSON, or a single file entry breaks these rules, VIDEPE rejects the whole session before downloading anything, and tells the user to report the problem to your app's developers.

## Which files VIDEPE opens

| Modality     | Type                | Formats                                                    | Details                                                                                                                                                            |
| ------------ | ------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| EEG          | Recording           | BrainVision (`.vhdr` + `.eeg`), EDF (`.edf`)               | One recording per launch. A BrainVision recording needs both files, with the same base name.                                                                       |
| EEG          | Electrode positions | `.elc`, BIDS `*_electrodes.tsv`                            | Other `.tsv` files (e.g. BIDS `_channels.tsv`, `_events.tsv`) aren't electrode positions, and are skipped.                                                         |
| EEG          | Inverse solution    | FieldTrip `.mat`                                           | The inverse filters, for source imaging (ESI).                                                                                                                     |
| Neuroimaging | Volume              | NIfTI (`.nii`, `.nii.gz`), FreeSurfer MGH (`.mgh`, `.mgz`) | E.g. MRI, CT or PET. Segmentations and atlases are recognised by their name (e.g. BIDS `_dseg`, or `atlas`, `seg`, `parc`, `label`) and shown as labelled regions. |
| Neuroimaging | Surface mesh        | GIFTI (`.gii`)                                             | E.g. a cortical surface.                                                                                                                                           |

**Not supported yet:** Micromed recordings (`.trc`). Support is coming in an upcoming VIDEPE release; until then, `.trc` files are skipped like other files VIDEPE can't open.

Any other file (e.g. a BrainVision `.vmrk` marker file, a BIDS sidecar or a PDF) is skipped without being downloaded, and listed in a warning to the user.

## What the user sees

- The top of VIDEPE says **Opened from** your app's name, with the session's `title` under it.
- The EEG panel shows the name of the recording's file.
- While loading, and if something fails, VIDEPE shows a message naming your app. For a `401` or `403` answer it tells the user to click **View in VIDEPE** in your app again; for a `404` it names the missing file.

Host apps are shown as plain text only. VIDEPE doesn't show logos or other branding of host apps.

## Security checklist

- **Listen on `127.0.0.1` only**, so other computers can't reach your server.
- **Let the operating system pick the port** (port `0`), and only open the browser once the server is listening, so no other program can take the port first.
- **Create a new token for every launch**, and check it on every API request, including the file downloads. Compare it in constant time (e.g. Python's `secrets.compare_digest`).
- **Don't send CORS headers** (`Access-Control-Allow-Origin`). VIDEPE doesn't need them, and they would let other websites read your API.
- **Only serve the files the user picked**, and make sure a request can't reach other files (e.g. through `../` in the path).
- **Keep the token out of logs.** VIDEPE already keeps it out of its own error messages and removes it from the address bar.

## A minimal example in Python

A complete host app, using only Python's standard library. It serves a VIDEPE build from the folder `videpe-dist` and opens the files given on the command line:

```python
"""Minimal VIDEPE host app: serves VIDEPE and the given files, then opens them in the browser.

Usage: python host_app_example.py rec.vhdr rec.eeg sub-01_T1w.nii.gz
"""

import http.server
import json
import mimetypes
import secrets
import sys
import urllib.parse
import webbrowser
from pathlib import Path

VIDEPE_DIR = Path("videpe-dist").resolve()  # a VIDEPE build (the contents of its dist/ folder)
APP_NAME = "My Host App"
FILES = [Path(name) for name in sys.argv[1:]]  # the files to open in VIDEPE
TOKEN = secrets.token_urlsafe(32)  # a new random token for this launch

# Replaces VIDEPE's own app-config.js, enabling the host-app mode
APP_CONFIG = "window.videpeConfig = " + json.dumps(
    {"hostApp": {"name": APP_NAME, "apiBase": "/api"}}
) + ";"


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        path = urllib.parse.unquote(urllib.parse.urlsplit(self.path).path)

        # The API: every request must carry this launch's token
        if path.startswith("/api/"):
            expected = f"Bearer {TOKEN}"
            if not secrets.compare_digest(self.headers.get("Authorization", ""), expected):
                return self.send_error(401)
            if path == "/api/session":
                session = {
                    "version": 1,
                    "title": "Example launch",
                    "files": [
                        {"name": file.name, "url": f"/api/files/{index}"}
                        for index, file in enumerate(FILES)
                    ],
                }
                return self.reply(json.dumps(session).encode(), "application/json")
            index = path.removeprefix("/api/files/")
            if index.isdigit() and int(index) < len(FILES):
                return self.reply(FILES[int(index)].read_bytes(), "application/octet-stream")
            return self.send_error(404)

        # VIDEPE itself, under /videpe/ (the path its build expects)
        if path == "/videpe/app-config.js":
            return self.reply(APP_CONFIG.encode(), "text/javascript")
        if path.startswith("/videpe/"):
            file = (VIDEPE_DIR / (path.removeprefix("/videpe/") or "index.html")).resolve()
            if file.is_file() and VIDEPE_DIR in file.parents:  # no paths outside VIDEPE_DIR
                content_type = mimetypes.guess_type(file.name)[0] or "application/octet-stream"
                return self.reply(file.read_bytes(), content_type)
        self.send_error(404)

    def reply(self, body, content_type):
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


# Only reachable from this computer; port 0 lets the operating system pick a free port
server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
webbrowser.open(f"http://127.0.0.1:{server.server_port}/videpe/?token={TOKEN}")
server.serve_forever()
```

This example uses one token for as long as it runs. An app with a **View in VIDEPE** button creates a new token on every click and stops accepting the previous one.

## Checking the integration

1. Start your app, pick a BrainVision or EDF recording and an MR volume, and click **View in VIDEPE**.
2. VIDEPE opens on `http://127.0.0.1:<port>/videpe/#/patient-view`, with the token gone from the address bar, and shows "Opened from" your app's name.
3. The recording and the volume load, and the EEG panel shows the recording's file name.
4. Reload the page: the same files load again.
5. Click **View in VIDEPE** again, so your app replaces the token, then reload the first tab: VIDEPE tells you your app no longer accepts that launch. (If you close your app instead, its server is gone, and the browser can't reach VIDEPE at all.)
6. In the browser's developer tools (Network tab), every request to your API has the `Authorization` header, and none goes to another server.

For VIDEPE's own development, `npm run dev` with `/videpe/?preview=hostapp` shows the host-app mode with a stand-in for a host app, serving VIDEPE's demo data.

## Not part of version 1

- **Updating the data while VIDEPE is open**, e.g. when the user picks other files. For now, the host app opens a new launch instead.
- **Sending data back** from VIDEPE to the host app.
- **Logos or other branding** of host apps.
