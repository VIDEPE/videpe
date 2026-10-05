import { describe, it, expect, vi } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { fetchShanoirExamination } from '@/loaders/fetchShanoirExamination';

// Builds an in-memory zip Blob from a list of file paths (content is irrelevant here).
const makeZip = (paths) =>
  new Blob([zipSync(Object.fromEntries(paths.map((p) => [p, strToU8('x')])))]);

const EEG_ZIP = makeZip(['rec/rec.vhdr', 'rec/rec.vmrk', 'rec/rec.eeg']);
const T1_ZIP = makeZip(['anat/sub-01_T1w.nii.gz', 'anat/sub-01_T1w.json']);
const PET_ZIP = makeZip(['pet/sub-01_pet.nii.gz']);

// Fake Shanoir client: datasets and zips are looked up by id, extra-data by file name.
function makeClient({ datasets, zips = {}, extraDataPaths = [] }) {
  return {
    listExaminationDatasets: vi.fn().mockResolvedValue(datasets),
    getExamination: vi.fn().mockResolvedValue({ id: 7, extraDataFilePathList: extraDataPaths }),
    downloadDatasetZip: vi.fn(async (id) => zips[id]),
    downloadExtraData: vi.fn(async (_examinationId, fileName) => new File(['x'], fileName)),
  };
}

const names = (files) => files.map((f) => f.name).sort();

describe('fetchShanoirExamination', () => {
  it('routes each dataset by its Shanoir type, not by the files inside its zip', async () => {
    const client = makeClient({
      datasets: [
        { id: 1, name: 'rest', type: 'Eeg' },
        { id: 2, name: 'T1', type: 'Mr' },
        { id: 3, name: 'FDG', type: 'Pet' },
      ],
      zips: { 1: EEG_ZIP, 2: T1_ZIP, 3: PET_ZIP },
    });
    const result = await fetchShanoirExamination({ client, examinationId: 7 });

    // .vmrk and the .json sidecar are dropped by the per-viewer file selection
    expect(names(result.eegFiles)).toEqual(['rec.eeg', 'rec.vhdr']);
    expect(names(result.imagingFiles)).toEqual(['sub-01_T1w.nii.gz', 'sub-01_pet.nii.gz']);
    expect(result.loadedEegName).toEqual({ id: 1, name: 'rest', type: 'Eeg' });
    expect(result.skippedDatasets).toEqual([]);
  });

  it('loads only the first EEG dataset and reports the others as skipped', async () => {
    // handleEegFiles keeps one file per extension, so mixing two recordings could pair
    // one run's .vhdr with another run's .eeg.
    const client = makeClient({
      datasets: [
        { id: 1, name: 'run-1', type: 'Eeg' },
        { id: 2, name: 'run-2', type: 'Eeg' },
      ],
      zips: { 1: EEG_ZIP },
    });
    const result = await fetchShanoirExamination({ client, examinationId: 7 });

    expect(result.loadedEegName.name).toBe('run-1');
    expect(client.downloadDatasetZip).toHaveBeenCalledTimes(1);
    expect(result.skippedDatasets).toEqual([
      { id: 2, name: 'run-2', type: 'Eeg', reason: 'additional EEG recording' },
    ]);
  });

  it('reports dataset types VIDEPE cannot show as skipped, without downloading them', async () => {
    const client = makeClient({
      datasets: [
        { id: 1, name: 'rest', type: 'Eeg' },
        { id: 9, name: 'report', type: 'Measurement' },
      ],
      zips: { 1: EEG_ZIP },
    });
    const result = await fetchShanoirExamination({ client, examinationId: 7 });

    expect(client.downloadDatasetZip.mock.calls.map(([id]) => id)).toEqual([1]);
    expect(result.skippedDatasets).toEqual([
      { id: 9, name: 'report', type: 'Measurement', reason: 'unsupported type' },
    ]);
  });

  it('adds electrode positions and inverse solutions from examination extra-data to the EEG files', async () => {
    const client = makeClient({
      datasets: [{ id: 1, name: 'rest', type: 'Eeg' }],
      zips: { 1: EEG_ZIP },
      extraDataPaths: [
        '/data/exam-7/sub-01_electrodes.tsv',
        '/data/exam-7/sub-01_inversefilters.mat',
        '/data/exam-7/report.pdf',
      ],
    });
    const result = await fetchShanoirExamination({ client, examinationId: 7 });

    expect(names(result.eegFiles)).toEqual([
      'rec.eeg',
      'rec.vhdr',
      'sub-01_electrodes.tsv',
      'sub-01_inversefilters.mat',
    ]);
    expect(client.downloadExtraData).toHaveBeenCalledTimes(2);
    expect(client.downloadExtraData).not.toHaveBeenCalledWith(7, 'report.pdf', undefined);
  });

  it('skips extra-data when the examination has no EEG recording', async () => {
    // Electrode positions and inverse solutions only mean something alongside a recording.
    const client = makeClient({
      datasets: [{ id: 2, name: 'T1', type: 'Mr' }],
      zips: { 2: T1_ZIP },
      extraDataPaths: ['/data/exam-7/sub-01_electrodes.tsv'],
    });
    const result = await fetchShanoirExamination({ client, examinationId: 7 });

    expect(result.loadedEegName).toBeNull();
    expect(result.eegFiles).toEqual([]);
    expect(client.downloadExtraData).not.toHaveBeenCalled();
  });

  it('returns empty results for an examination without datasets', async () => {
    const client = makeClient({ datasets: [] });
    const result = await fetchShanoirExamination({ client, examinationId: 7 });
    expect(result).toEqual({
      loadedEegName: null,
      eegFiles: [],
      imagingFiles: [],
      skippedDatasets: [],
    });
  });

  it('passes the abort signal to every request', async () => {
    const client = makeClient({
      datasets: [{ id: 1, name: 'rest', type: 'Eeg' }],
      zips: { 1: EEG_ZIP },
      extraDataPaths: ['sub-01_electrodes.tsv'],
    });
    const { signal } = new AbortController();
    await fetchShanoirExamination({ client, examinationId: 7, signal });

    expect(client.listExaminationDatasets).toHaveBeenCalledWith(7, signal);
    expect(client.getExamination).toHaveBeenCalledWith(7, signal);
    expect(client.downloadDatasetZip).toHaveBeenCalledWith(1, signal);
    expect(client.downloadExtraData).toHaveBeenCalledWith(7, 'sub-01_electrodes.tsv', signal);
  });

  it('rejects when a download fails, so the caller can show one error', async () => {
    const client = makeClient({ datasets: [{ id: 1, name: 'rest', type: 'Eeg' }] });
    client.downloadDatasetZip.mockRejectedValue(new Error('dataset 1 was not found in Shanoir.'));
    await expect(fetchShanoirExamination({ client, examinationId: 7 })).rejects.toThrow(
      'not found'
    );
  });
});
