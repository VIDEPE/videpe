import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';

// Helpers to use the real Shanoir 2.18.1 responses in src/test/shanoir/fixtures/shanoir-2.18.1/
// (see the README there for what each examination contains).

const FIXTURES_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'shanoir-2.18.1'
);

/**
 * @param {string} fileName - a fixture file, e.g. 'datasets-examination-7.json'.
 * @returns {{ request: string, status: number, body?: any, zipEntries?: object[] }} the
 *   recorded response.
 */
export function loadFixture(fileName) {
  return JSON.parse(readFileSync(path.join(FIXTURES_DIR, fileName), 'utf8'));
}

/**
 * The body of a recorded JSON response, or [] when Shanoir answered 204 No Content (as
 * createShanoirClient's list methods return).
 *
 * @param {string} fileName
 */
export function fixtureBody(fileName) {
  return loadFixture(fileName).body ?? [];
}

/**
 * A zip Blob holding the same file names as Shanoir's real download of a dataset
 * (download-dataset-{id}.json). The fixtures don't store file contents, so each file holds a
 * placeholder.
 *
 * @param {number} datasetId
 * @returns {Blob}
 */
export function fixtureDatasetZip(datasetId) {
  const { zipEntries } = loadFixture(`download-dataset-${datasetId}.json`);
  return new Blob([zipSync(Object.fromEntries(zipEntries.map((e) => [e.name, strToU8('x')])))]);
}
