// Captures real responses from a Shanoir instance, to build the test fixtures for VIDEPE's
// Shanoir integration (src/test/shanoir/fixtures/). Read-only: besides the sign-in request it
// only sends GET requests, the same ones VIDEPE makes (or will make) when opened from Shanoir.
//
// Usage (PowerShell or Windows Terminal; in Git Bash use `winpty node …` so the password
// prompt works):
//   node scripts/capture-shanoir-fixtures.js <examinationId> [<examinationId> …]
//
// Environment variables (optional):
//   SHANOIR_URL  base URL of the Shanoir instance (default: https://shanoir-ng-nginx, the
//                local Docker setup)
//   CAPTURE_OUT  output folder (default: shanoir-capture-<timestamp> in the OS temp folder)
//
// Sign-in uses Keycloak's 'shanoir-uploader' client: the only Shanoir client that allows a
// username/password sign-in from a script, and it puts the userId claim in the token, which
// the Shanoir services need. The password is typed at a hidden prompt and only sent to Keycloak.
//
// For each examination it saves the JSON responses of:
//   examinations/{id}                        examination, incl. its extraDataFilePathList
//   datasets/examination/{id}                datasets of the examination's acquisitions
//   datasets/examination/{id}?output=true    meant to add processed datasets made from them, but
//                                            answers 204 in Shanoir 2.18.1 (inner joins in
//                                            DatasetRepository.findByIdsWithProcessingAncestorsAndExamination);
//                                            captured to record that behaviour
//   datasetProcessing/inputDataset/{datasetId}         processings using each dataset as input,
//                                            and (following chains, like VIDEPE) each output
//   datasetProcessing/{processingId}/outputDatasets/   each processing's output datasets (the
//                                            route Shanoir's own study tree uses)
//   datasetacquisition/examination/{id}      the examination's acquisitions, incl. their extra data
//   datasetacquisition/{acquisitionId}       each of those acquisitions in full
//   datasets/acquisition/{acquisitionId}     each acquisition's datasets: the only way to link a
//                                            dataset to its acquisition, since the examination's
//                                            dataset list leaves datasetAcquisition null
// and, for downloads, only the metadata (status, headers, size, names inside a zip), never
// the file contents:
//   datasets/download/{datasetId}?format=nii                    every dataset and output found above
//   examinations/extra-data-download/{id}/{name}/               every examination extra-data file
//   datasetacquisition/extra-data-download/{acquisitionId}/{name}/  every acquisition extra-data file
//
// Usernames are anonymised before saving (see anonymise). The output is still written outside
// the repo by default: review it for other personal details before copying it into the
// fixtures folder.

import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { unzipSync } from 'fflate';

const BASE_URL = (process.env.SHANOIR_URL ?? 'https://shanoir-ng-nginx').replace(/\/$/, '');
const REALM = 'shanoir-ng';
const CLIENT_ID = 'shanoir-uploader';
const API_BASE = `${BASE_URL}/shanoir-ng/datasets`;

// The local Docker setup uses a self-signed certificate. Skip certificate checks only for that
// default local host, never for a real server.
if (new URL(BASE_URL).hostname === 'shanoir-ng-nginx') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

// File name of a path as Shanoir stores it (either separator), e.g. extraDataFilePathList entries.
const baseName = (filePath) => filePath.split(/[\\/]/).pop();

// Makes a file name safe to use inside an output file name.
const safeName = (name) => name.replace(/[^\w.-]/g, '_');

// A zip file starts with the bytes 'PK'.
const isZip = (bytes) => bytes.length > 1 && bytes[0] === 0x50 && bytes[1] === 0x4b;

// Placeholder for usernames in the saved responses.
const ANONYMISED_USERNAME = 'shanoir-user';

/**
 * Returns a copy of a response body with usernames replaced by ANONYMISED_USERNAME: every
 * `username` field (e.g. the importing user on dataset acquisitions), and any other string
 * that is exactly the signed-in username.
 */
function anonymise(value, username) {
  if (Array.isArray(value)) return value.map((item) => anonymise(item, username));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        key === 'username' && typeof item === 'string'
          ? ANONYMISED_USERNAME
          : anonymise(item, username),
      ])
    );
  }
  return value === username ? ANONYMISED_USERNAME : value;
}

/** Asks a question with a visible answer (the username). */
async function askVisible(question) {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await readline.question(question);
  readline.close();
  return answer.trim();
}

/**
 * Asks a question without echoing the answer (the password). Reads key by key in raw mode,
 * handling Enter, Backspace and Ctrl+C.
 */
function askHidden(question) {
  const { stdin, stdout } = process;
  stdout.write(question);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  return new Promise((resolve) => {
    let value = '';
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          // Enter: restore the terminal and return what was typed
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          stdout.write('\n');
          resolve(value);
          return;
        }
        if (char === '\u0003') {
          // Ctrl+C: restore the terminal and stop
          stdin.setRawMode(false);
          stdout.write('\n');
          process.exit(130);
        }
        if (char === '\u007f' || char === '\b') {
          value = value.slice(0, -1); // Backspace
          continue;
        }
        value += char;
      }
    };
    stdin.on('data', onData);
  });
}

/** Signs in through Keycloak's password grant and returns the access token. */
async function getAccessToken(username, password) {
  const response = await fetch(`${BASE_URL}/auth/realms/${REALM}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'password', client_id: CLIENT_ID, username, password }),
  });
  if (!response.ok) {
    throw new Error(`Sign-in failed (HTTP ${response.status}): ${await response.text()}`);
  }
  return (await response.json()).access_token;
}

/**
 * Creates the capture functions, bound to one access token and output folder.
 */
function createCapturer({ token, outDir, username }) {
  const save = (fileName, data) =>
    writeFile(
      path.join(outDir, fileName),
      `${JSON.stringify(anonymise(data, username), null, 2)}\n`
    );

  const get = (apiPath) =>
    fetch(`${API_BASE}/${apiPath}`, { headers: { Authorization: `Bearer ${token}` } });

  return {
    /**
     * Saves a JSON response as { request, status, body } and returns the body (null when the
     * request failed or had no body, e.g. Shanoir's 204 No Content for an empty list).
     */
    async json(apiPath, fileName) {
      const response = await get(apiPath);
      const text = await response.text();
      let body = null;
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = text; // keep non-JSON error pages as text
        }
      }
      await save(fileName, { request: `GET ${apiPath}`, status: response.status, body });
      console.log(`  ${response.status}  GET ${apiPath}`);
      return response.ok ? body : null;
    },

    /**
     * Saves a download's metadata (status, headers, size and, for a zip, the names and sizes
     * of its entries) without its contents.
     */
    async download(apiPath, fileName) {
      const response = await get(apiPath);
      const bytes = new Uint8Array(await response.arrayBuffer());
      let zipEntries = null;
      if (response.ok && isZip(bytes)) {
        zipEntries = [];
        // The filter sees every entry; returning false skips decompressing it
        unzipSync(bytes, {
          filter: (file) => {
            zipEntries.push({ name: file.name, size: file.originalSize });
            return false;
          },
        });
      }
      await save(fileName, {
        request: `GET ${apiPath}`,
        status: response.status,
        headers: {
          'content-type': response.headers.get('content-type'),
          'content-disposition': response.headers.get('content-disposition'),
        },
        size: bytes.length,
        zipEntries,
      });
      console.log(`  ${response.status}  GET ${apiPath}  (${bytes.length} bytes)`);
    },
  };
}

/** Captures everything listed at the top of this file for one examination. */
async function captureExamination(capture, examinationId) {
  console.log(`\nExamination ${examinationId}`);
  const examination = await capture.json(
    `examinations/${examinationId}`,
    `examination-${examinationId}.json`
  );
  const datasets = await capture.json(
    `datasets/examination/${examinationId}`,
    `datasets-examination-${examinationId}.json`
  );
  // Answers 204 in Shanoir 2.18.1 (see the top of this file); captured to record that
  await capture.json(
    `datasets/examination/${examinationId}?output=true`,
    `datasets-examination-${examinationId}-output.json`
  );

  // Processed outputs, found the way Shanoir's study tree finds them: the processings that use
  // each dataset as input, then each processing's output datasets. Like VIDEPE, it follows
  // chains: the outputs' own processings are looked up in the next round. A processing with
  // several inputs is found once per input, and a chain can lead back to a dataset already
  // seen; each is captured once.
  const outputDatasets = [];
  const capturedProcessingIds = new Set();
  const seenDatasetIds = new Set((datasets ?? []).map((dataset) => dataset.id));
  let inputs = datasets ?? [];
  while (inputs.length > 0) {
    const newOutputs = [];
    for (const { id: datasetId } of inputs) {
      const processings = await capture.json(
        `datasetProcessing/inputDataset/${datasetId}`,
        `processings-inputdataset-${datasetId}.json`
      );
      for (const { id: processingId } of processings ?? []) {
        if (capturedProcessingIds.has(processingId)) continue;
        capturedProcessingIds.add(processingId);
        const outputs = await capture.json(
          `datasetProcessing/${processingId}/outputDatasets/`,
          `processing-${processingId}-outputdatasets.json`
        );
        for (const output of outputs ?? []) {
          if (seenDatasetIds.has(output.id)) continue;
          seenDatasetIds.add(output.id);
          newOutputs.push(output);
        }
      }
    }
    outputDatasets.push(...newOutputs);
    inputs = newOutputs; // next round: processings made from these outputs
  }
  const acquisitions = await capture.json(
    `datasetacquisition/examination/${examinationId}`,
    `datasetacquisitions-examination-${examinationId}.json`
  );

  // Each acquisition on its own, then its extra-data files (e.g. the electrode file that the
  // EEG import stores on the acquisition)
  for (const { id: acquisitionId } of acquisitions ?? []) {
    const acquisition = await capture.json(
      `datasetacquisition/${acquisitionId}`,
      `datasetacquisition-${acquisitionId}.json`
    );
    await capture.json(
      `datasets/acquisition/${acquisitionId}`,
      `datasets-acquisition-${acquisitionId}.json`
    );
    for (const filePath of acquisition?.extraDataFilePathList ?? []) {
      const name = baseName(filePath);
      await capture.download(
        `datasetacquisition/extra-data-download/${acquisitionId}/${encodeURIComponent(name)}/`,
        `extradata-acquisition-${acquisitionId}-${safeName(name)}.json`
      );
    }
  }

  // The examination's own extra-data files
  for (const filePath of examination?.extraDataFilePathList ?? []) {
    const name = baseName(filePath);
    await capture.download(
      `examinations/extra-data-download/${examinationId}/${encodeURIComponent(name)}/`,
      `extradata-examination-${examinationId}-${safeName(name)}.json`
    );
  }

  // Every dataset, including processed outputs, as VIDEPE downloads it
  for (const { id: datasetId } of [...(datasets ?? []), ...outputDatasets]) {
    await capture.download(
      `datasets/download/${datasetId}?format=nii`,
      `download-dataset-${datasetId}.json`
    );
  }
}

async function main() {
  const examinationIds = process.argv.slice(2).map(Number);
  if (
    examinationIds.length === 0 ||
    examinationIds.some((id) => !Number.isInteger(id) || id <= 0)
  ) {
    console.error(
      'Usage: node scripts/capture-shanoir-fixtures.js <examinationId> [<examinationId> …]'
    );
    process.exit(1);
  }
  if (!process.stdin.isTTY) {
    console.error(
      'The password prompt needs an interactive terminal. Use PowerShell, or in Git Bash: winpty node scripts/capture-shanoir-fixtures.js …'
    );
    process.exit(1);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = process.env.CAPTURE_OUT ?? path.join(tmpdir(), `shanoir-capture-${timestamp}`);
  await mkdir(outDir, { recursive: true });

  console.log(`Shanoir: ${BASE_URL}`);
  const username = await askVisible('Shanoir username: ');
  const password = await askHidden('Password: ');
  const token = await getAccessToken(username, password);

  const capture = createCapturer({ token, outDir, username });
  for (const examinationId of examinationIds) {
    await captureExamination(capture, examinationId);
  }
  console.log(`\nSaved to ${outDir}`);
}

main().catch((error) => {
  console.error(`\n${error.message}`);
  process.exit(1);
});
