import { describe, it, expect, vi } from 'vitest';
import { createShanoirClient } from '@/shanoir/shanoirClient';

const API_BASE = '/shanoir-ng/datasets';

// Builds a fetch stand-in resolving to a single Response-like object.
const okJson = (body) => ({ ok: true, status: 200, json: async () => body });
const okBlob = (blob) => ({ ok: true, status: 200, blob: async () => blob });
const failed = (status, statusText = '') => ({ ok: false, status, statusText });

const makeClient = (response) => {
  const fetchImpl = vi.fn().mockResolvedValue(response);
  const getAccessToken = vi.fn().mockResolvedValue('token-123');
  const client = createShanoirClient({ apiBase: API_BASE, getAccessToken, fetchImpl });
  return { client, fetchImpl, getAccessToken };
};

describe('createShanoirClient', () => {
  it('fetches an examination with a Bearer token', async () => {
    const { client, fetchImpl } = makeClient(okJson({ id: 7, extraDataFilePathList: [] }));
    const exam = await client.getExamination(7);
    expect(exam.id).toBe(7);
    expect(fetchImpl).toHaveBeenCalledWith(
      '/shanoir-ng/datasets/examinations/7',
      expect.objectContaining({ headers: { Authorization: 'Bearer token-123' } })
    );
  });

  it("lists an examination's datasets", async () => {
    const { client, fetchImpl } = makeClient(okJson([{ id: 1, type: 'Eeg' }]));
    const datasets = await client.listExaminationDatasets(7);
    expect(datasets).toEqual([{ id: 1, type: 'Eeg' }]);
    expect(fetchImpl.mock.calls[0][0]).toBe('/shanoir-ng/datasets/datasets/examination/7');
  });

  it('treats an empty (204) dataset list as no datasets', async () => {
    const { client } = makeClient({ ok: true, status: 204 });
    expect(await client.listExaminationDatasets(7)).toEqual([]);
  });

  it('always downloads datasets as NIfTI (format=nii)', async () => {
    const zip = new Blob(['zip-bytes']);
    const { client, fetchImpl } = makeClient(okBlob(zip));
    expect(await client.downloadDatasetZip(42)).toBe(zip);
    expect(fetchImpl.mock.calls[0][0]).toBe('/shanoir-ng/datasets/datasets/download/42?format=nii');
  });

  it('downloads an examination extra-data file as a named File', async () => {
    const { client, fetchImpl } = makeClient(okBlob(new Blob(['name\tx\ty\tz\n'])));
    const file = await client.downloadExtraData(7, 'sub-01 electrodes.tsv');
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe('sub-01 electrodes.tsv');
    // File names are URL-encoded; the trailing slash matches Shanoir's `{fileName:.+}/` route.
    expect(fetchImpl.mock.calls[0][0]).toBe(
      '/shanoir-ng/datasets/examinations/extra-data-download/7/sub-01%20electrodes.tsv/'
    );
  });

  it('passes the abort signal through to fetch', async () => {
    const { client, fetchImpl } = makeClient(okJson({}));
    const controller = new AbortController();
    await client.getExamination(7, controller.signal);
    expect(fetchImpl.mock.calls[0][1].signal).toBe(controller.signal);
  });

  it('fetches a fresh token for every request', async () => {
    const { client, getAccessToken } = makeClient(okJson([]));
    await client.listExaminationDatasets(1);
    await client.listExaminationDatasets(2);
    expect(getAccessToken).toHaveBeenCalledTimes(2);
  });

  it.each([
    [401, /sign-in/i],
    [403, /permission/i],
    [404, /not found/i],
    [500, /500/],
  ])('rejects with a readable error on HTTP %i', async (status, message) => {
    const { client } = makeClient(failed(status, 'Error'));
    await expect(client.getExamination(7)).rejects.toThrow(message);
  });
});
