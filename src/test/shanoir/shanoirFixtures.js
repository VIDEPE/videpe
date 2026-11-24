import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { vi } from 'vitest';
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

/**
 * A stand-in for createShanoirClient that answers every request from the fixtures, as the
 * real Shanoir 2.18.1 answered it. Each method is a vi.fn, so tests can check the calls.
 * Extra-data downloads return a placeholder File with the requested name.
 */
export function createFixtureClient() {
  return {
    getExamination: vi.fn(async (examinationId) =>
      fixtureBody(`examination-${examinationId}.json`)
    ),
    listExaminationDatasets: vi.fn(async (examinationId) =>
      fixtureBody(`datasets-examination-${examinationId}.json`)
    ),
    listProcessingsByInputDataset: vi.fn(async (datasetId) =>
      fixtureBody(`processings-inputdataset-${datasetId}.json`)
    ),
    listProcessingOutputDatasets: vi.fn(async (processingId) =>
      fixtureBody(`processing-${processingId}-outputdatasets.json`)
    ),
    downloadDatasetZip: vi.fn(async (datasetId) => fixtureDatasetZip(datasetId)),
    downloadExtraData: vi.fn(async (_examinationId, fileName) => new File(['x'], fileName)),
  };
}
