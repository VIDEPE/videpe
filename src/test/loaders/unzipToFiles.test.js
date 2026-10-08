import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { unzipToFiles } from '@/loaders/unzipToFiles';

// Builds an in-memory zip Blob from { 'path/in/zip': 'text content' }.
const makeZip = (entries) =>
  new Blob([zipSync(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, strToU8(v)])))]);

describe('unzipToFiles', () => {
  it('returns one File per entry, named by its base file name', async () => {
    const zip = makeZip({
      'Dataset_rec/sub-01/eeg/rec.vhdr': 'header',
      'Dataset_rec/sub-01/eeg/rec.eeg': 'data',
    });
    const files = await unzipToFiles(zip);
    expect(files.map((f) => f.name).sort()).toEqual(['rec.eeg', 'rec.vhdr']);
    const vhdr = files.find((f) => f.name === 'rec.vhdr');
    expect(vhdr).toBeInstanceOf(File);
    expect(await vhdr.text()).toBe('header');
  });

  it('skips directory entries and macOS metadata', async () => {
    const zip = makeZip({
      'folder/': '',
      '__MACOSX/folder/._rec.vhdr': 'junk',
      'folder/.DS_Store': 'junk',
      'folder/rec.vhdr': 'header',
    });
    const files = await unzipToFiles(zip);
    expect(files.map((f) => f.name)).toEqual(['rec.vhdr']);
  });

  it('returns an empty list for an empty zip', async () => {
    expect(await unzipToFiles(makeZip({}))).toEqual([]);
  });

  it('rejects when the data is not a zip', async () => {
    await expect(unzipToFiles(new Blob(['not a zip']))).rejects.toThrow();
  });
});
