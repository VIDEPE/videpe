import { describe, it, expect, vi } from 'vitest';
import { fetchHostAppFiles } from '@/hostApp/fetchHostAppFiles';

// Covers what a host-app launch downloads and where each file goes. The client is a stand-in
// — see hostAppClient.test.js for the requests themselves.

const entry = (name) => ({ name, url: `/api/files/${name}` });

// A stand-in client: getSession answers with `entries` (and `title`), and downloadFile turns
// an entry into a File with the same name
function makeClient(entries, title = 'Patient 012') {
  return {
    getSession: vi.fn().mockResolvedValue({ title, files: entries }),
    downloadFile: vi.fn(async (file) => new File(['x'], file.name)),
  };
}

const names = (files) => files.map((f) => f.name);

describe('fetchHostAppFiles', () => {
  it('downloads the files for both viewers and sorts them, with the session title', async () => {
    const client = makeClient([
      entry('rec.vhdr'),
      entry('rec.eeg'),
      entry('sub-01_electrodes.tsv'),
      entry('T1w.nii.gz'),
    ]);
    const result = await fetchHostAppFiles({ client });

    expect(result.title).toBe('Patient 012');
    expect(names(result.eegFiles)).toEqual(['rec.vhdr', 'rec.eeg', 'sub-01_electrodes.tsv']);
    expect(names(result.imagingFiles)).toEqual(['T1w.nii.gz']);
    expect(result.eegFiles[0]).toBeInstanceOf(File);
    expect(result.skippedFiles).toEqual([]);
  });

  it("doesn't download files neither viewer opens, and reports them as skipped", async () => {
    const client = makeClient([entry('rec.edf'), entry('report.pdf'), entry('rec.vmrk')]);
    const result = await fetchHostAppFiles({ client });

    expect(result.skippedFiles).toEqual(['report.pdf', 'rec.vmrk']);
    expect(client.downloadFile).toHaveBeenCalledTimes(1);
    expect(client.downloadFile).toHaveBeenCalledWith(entry('rec.edf'), undefined);
  });

  it("names the EEG recording that's loaded, for the EEG panel header", async () => {
    const client = makeClient([entry('sub-01_electrodes.tsv'), entry('rest.edf')]);
    expect((await fetchHostAppFiles({ client })).eegName).toBe('rest.edf');
  });

  it('has no EEG name without a recording (e.g. only imaging)', async () => {
    const client = makeClient([entry('T1w.nii.gz')]);
    expect((await fetchHostAppFiles({ client })).eegName).toBeNull();
  });

  it('passes the abort signal to every request', async () => {
    const client = makeClient([entry('rec.edf'), entry('T1w.nii')]);
    const { signal } = new AbortController();
    await fetchHostAppFiles({ client, signal });

    expect(client.getSession).toHaveBeenCalledWith(signal);
    expect(client.downloadFile).toHaveBeenCalledWith(entry('rec.edf'), signal);
    expect(client.downloadFile).toHaveBeenCalledWith(entry('T1w.nii'), signal);
  });

  it('fails when a download fails', async () => {
    const client = makeClient([entry('rec.edf')]);
    client.downloadFile.mockRejectedValue(new Error('file rec.edf was not found'));
    await expect(fetchHostAppFiles({ client })).rejects.toThrow('file rec.edf was not found');
  });

  it('fails when the session is rejected', async () => {
    const client = makeClient([]);
    client.getSession.mockRejectedValue(new Error('no longer accepts this launch'));
    await expect(fetchHostAppFiles({ client })).rejects.toThrow('no longer accepts this launch');
    expect(client.downloadFile).not.toHaveBeenCalled();
  });
});
