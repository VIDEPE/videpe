import { describe, it, expect, vi } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { fetchShanoirExamination } from '@/shanoir/fetchShanoirExamination';
import { createFixtureClient, fixtureBody, fixtureDatasetZip } from './shanoirFixtures';

// Builds an in-memory zip Blob from a list of file paths (content is irrelevant here).
const makeZip = (paths) =>
  new Blob([zipSync(Object.fromEntries(paths.map((p) => [p, strToU8('x')])))]);

const EEG_ZIP = makeZip(['rec/rec.vhdr', 'rec/rec.vmrk', 'rec/rec.eeg']);
const T1_ZIP = makeZip(['anat/sub-01_T1w.nii.gz', 'anat/sub-01_T1w.json']);
const PET_ZIP = makeZip(['pet/sub-01_pet.nii.gz']);
const WM_ZIP = makeZip(['sub-01_label-WM_dseg.nii.gz']);

// Fake Shanoir client: datasets and zips are looked up by id, extra-data by file name,
// processings by their input dataset's id, output datasets by processing id, and an
// acquisition's datasets by acquisition id.
function makeClient({
  datasets,
  zips = {},
  extraDataPaths = [],
  processings = {},
  outputs = {},
  acquisitions = [],
  acquisitionDatasets = {},
}) {
  return {
    listExaminationDatasets: vi.fn().mockResolvedValue(datasets),
    getExamination: vi.fn().mockResolvedValue({ id: 7, extraDataFilePathList: extraDataPaths }),
    listProcessingsByInputDataset: vi.fn(async (datasetId) => processings[datasetId] ?? []),
    listProcessingOutputDatasets: vi.fn(async (processingId) => outputs[processingId] ?? []),
    listExaminationAcquisitions: vi.fn().mockResolvedValue(acquisitions),
    listAcquisitionDatasets: vi.fn(
      async (acquisitionId) => acquisitionDatasets[acquisitionId] ?? []
    ),
    downloadDatasetZip: vi.fn(async (id) => zips[id]),
    downloadExtraData: vi.fn(async (_examinationId, fileName) => new File(['x'], fileName)),
    downloadAcquisitionExtraData: vi.fn(
      async (_acquisitionId, fileName) => new File(['x'], fileName)
    ),
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
    expect(result.eegDataset).toEqual({ id: 1, name: 'rest', type: 'Eeg' });
    expect(result.skippedDatasets).toEqual([]);
  });

  it('loads only the latest imported EEG dataset (highest id) and reports the others as skipped', async () => {
    // handleEegFiles keeps one file per extension, so mixing two recordings could pair
    // one run's .vhdr with another run's .eeg. Shanoir's dataset ids follow import order, so
    // the highest id is the latest import (like the dropzone, where the newest drop wins),
    // whatever order Shanoir lists them in.
    const client = makeClient({
      datasets: [
        { id: 5, name: 'run-2', type: 'Eeg' },
        { id: 9, name: 'run-3', type: 'Eeg' },
        { id: 3, name: 'run-1', type: 'Eeg' },
      ],
      zips: { 9: EEG_ZIP },
    });
    const result = await fetchShanoirExamination({ client, examinationId: 7 });

    expect(result.eegDataset.name).toBe('run-3');
    expect(client.downloadDatasetZip).toHaveBeenCalledTimes(1);
    expect(client.downloadDatasetZip).toHaveBeenCalledWith(9, undefined);
    expect(result.skippedDatasets).toEqual([
      {
        id: 5,
        name: 'run-2',
        type: 'Eeg',
        reason: 'older EEG recording, using the latest (highest dataset id)',
      },
      {
        id: 3,
        name: 'run-1',
        type: 'Eeg',
        reason: 'older EEG recording, using the latest (highest dataset id)',
      },
    ]);
  });

  it('loads the latest of the EEG-tab recordings in a real Shanoir examination (fixture: examination 7)', async () => {
    // Examination 7: a BIDS import (12 `BIDS` datasets), then two EEG-tab imports, recording
    // 57 (iEEG) and the more recent 58 (scalp EEG)
    const client = makeClient({
      datasets: fixtureBody('datasets-examination-7.json'),
      zips: Object.fromEntries([58, 44, 45, 47].map((id) => [id, fixtureDatasetZip(id)])),
    });
    const result = await fetchShanoirExamination({ client, examinationId: 7 });

    expect(result.eegDataset).toEqual({
      id: 58,
      name: 'sub-synth_task-rest_desc-spkavgall_eeg',
      type: 'EEG',
    });
    expect(names(result.eegFiles)).toEqual([
      'sub-4_ses-7_sub-synth_task-rest_desc-spkavgall_eeg.eeg',
      'sub-4_ses-7_sub-synth_task-rest_desc-spkavgall_eeg.vhdr',
    ]);
    // the older recording isn't downloaded
    expect(client.downloadDatasetZip).not.toHaveBeenCalledWith(57, undefined);
    expect(result.skippedDatasets).toContainEqual({
      id: 57,
      name: 'sub-synth_task-rest_desc-spkavgall_ieeg',
      type: 'EEG',
      reason: 'older EEG recording, using the latest (highest dataset id)',
    });
  });

  it('reports dataset types VIDEPE cannot show as skipped, naming the type, without downloading them', async () => {
    // The type is named as Shanoir sent it, so a type VIDEPE should support but doesn't
    // recognise (e.g. a spelling mismatch) shows up in the toast.
    const client = makeClient({
      datasets: [
        { id: 1, name: 'rest', type: 'Eeg' },
        { id: 9, name: 'report', type: 'Measurement' },
        { id: 10, name: 'untyped' },
      ],
      zips: { 1: EEG_ZIP },
    });
    const result = await fetchShanoirExamination({ client, examinationId: 7 });

    expect(client.downloadDatasetZip.mock.calls.map(([id]) => id)).toEqual([1]);
    expect(result.skippedDatasets).toEqual([
      {
        id: 9,
        name: 'report',
        type: 'Measurement',
        reason: 'unsupported dataset type: Measurement',
      },
      { id: 10, name: 'untyped', type: undefined, reason: 'unsupported dataset type: none' },
    ]);
  });

  it('reports an EEG dataset without a supported recording as skipped, and loads no EEG files', async () => {
    // e.g. an EEGLAB recording: the type is supported, the file format isn't. Its extra-data
    // (electrode positions) only means something alongside a recording, so it's dropped too.
    const client = makeClient({
      datasets: [{ id: 1, name: 'rest', type: 'EEG' }],
      zips: { 1: makeZip(['rec/rec.set', 'rec/rec.json']) },
      extraDataPaths: ['/data/exam-7/sub-01_electrodes.tsv'],
    });
    const result = await fetchShanoirExamination({ client, examinationId: 7 });

    expect(result.eegDataset).toBeNull();
    expect(result.eegFiles).toEqual([]);
    expect(result.skippedDatasets).toEqual([
      { id: 1, name: 'rest', type: 'EEG', reason: 'unsupported files: .set, .json' },
    ]);
  });

  it('reports an imaging dataset without supported image files as skipped, and still loads the others', async () => {
    const client = makeClient({
      datasets: [
        { id: 2, name: 'T1', type: 'MR' },
        { id: 3, name: 'old T2', type: 'MR' },
      ],
      zips: { 2: T1_ZIP, 3: makeZip(['anat/t2.img', 'anat/t2.hdr']) },
    });
    const result = await fetchShanoirExamination({ client, examinationId: 7 });

    expect(names(result.imagingFiles)).toEqual(['sub-01_T1w.nii.gz']);
    expect(result.skippedDatasets).toEqual([
      { id: 3, name: 'old T2', type: 'MR', reason: 'unsupported files: .img, .hdr' },
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

    expect(result.eegDataset).toBeNull();
    expect(result.eegFiles).toEqual([]);
    expect(client.downloadExtraData).not.toHaveBeenCalled();
  });

  it('returns empty results for an examination without datasets', async () => {
    const client = makeClient({ datasets: [] });
    const result = await fetchShanoirExamination({ client, examinationId: 7 });
    expect(result).toEqual({
      eegDataset: null,
      eegFiles: [],
      imagingFiles: [],
      skippedDatasets: [],
      skippedFiles: [],
    });
  });

  it('loads processed datasets made from the examination datasets as imaging (fixture: examination 4)', async () => {
    // Examination 4: recording 38, used as input by processings 1–3, whose outputs are the
    // T1 (40, MR), WM mask (41) and atlas (42, both SEGMENTATION). Processed datasets have no
    // acquisition, so they aren't in the examination's own dataset list.
    const client = createFixtureClient();
    const result = await fetchShanoirExamination({ client, examinationId: 4 });

    expect(result.eegDataset.id).toBe(38);
    expect(names(result.imagingFiles)).toEqual([
      'sub-synth_T1w.nii.gz',
      'sub-synth_atlas-L2018_res-scale2_dseg.nii.gz',
      'sub-synth_label-WM_dseg.nii.gz',
    ]);
    expect(result.skippedDatasets).toEqual([]);
  });

  it("requests each processing's outputs once, even when it has several inputs in the examination", async () => {
    const client = makeClient({
      datasets: [
        { id: 1, name: 'eeg', type: 'Eeg' },
        { id: 2, name: 'ieeg', type: 'Eeg' },
      ],
      zips: { 2: EEG_ZIP, 10: T1_ZIP },
      processings: { 1: [{ id: 5 }], 2: [{ id: 5 }] },
      outputs: { 5: [{ id: 10, name: 'T1', type: 'MR' }] },
    });
    const result = await fetchShanoirExamination({ client, examinationId: 7 });

    expect(client.listProcessingOutputDatasets).toHaveBeenCalledTimes(1);
    expect(names(result.imagingFiles)).toEqual(['sub-01_T1w.nii.gz']);
  });

  it('follows chains of processings: outputs made from processed outputs belong to the examination too', async () => {
    // recording 1 → processing 5 → T1 (10) → processing 6 → WM mask (11); the WM mask is also
    // input of processing 5 again, which must not be followed a second time
    const client = makeClient({
      datasets: [{ id: 1, name: 'rest', type: 'Eeg' }],
      zips: { 1: EEG_ZIP, 10: T1_ZIP, 11: WM_ZIP },
      processings: { 1: [{ id: 5 }], 10: [{ id: 6 }], 11: [{ id: 5 }] },
      outputs: {
        5: [{ id: 10, name: 'T1', type: 'MR' }],
        6: [{ id: 11, name: 'WM', type: 'Segmentation' }],
      },
    });
    const result = await fetchShanoirExamination({ client, examinationId: 7 });

    expect(names(result.imagingFiles)).toEqual([
      'sub-01_T1w.nii.gz',
      'sub-01_label-WM_dseg.nii.gz',
    ]);
    expect(client.listProcessingOutputDatasets).toHaveBeenCalledTimes(2);
  });

  it("adds the extra-data of the loaded recording's acquisition, not of another recording's (fixture: examination 7)", async () => {
    // Examination 7: acquisition 18 (recording 57) has electrode positions, acquisition 19
    // (recording 58, the one loaded) has electrode positions and an inverse solution. Shanoir's
    // dataset list doesn't say which acquisition a dataset belongs to, so VIDEPE asks the
    // acquisitions with usable extra-data for their datasets.
    const client = createFixtureClient();
    const result = await fetchShanoirExamination({ client, examinationId: 7 });

    expect(result.eegDataset.id).toBe(58);
    expect(names(result.eegFiles)).toEqual([
      'sub-4_ses-7_sub-synth_task-rest_desc-spkavgall_eeg.eeg',
      'sub-4_ses-7_sub-synth_task-rest_desc-spkavgall_eeg.vhdr',
      'sub-synth_desc-eloreta_inversefilters.mat',
      'sub-synth_electrodes.tsv',
    ]);
    expect(client.downloadAcquisitionExtraData.mock.calls.map(([id, name]) => [id, name])).toEqual(
      expect.arrayContaining([
        [19, 'sub-synth_electrodes.tsv'],
        [19, 'sub-synth_desc-eloreta_inversefilters.mat'],
      ])
    );
    expect(client.downloadAcquisitionExtraData).toHaveBeenCalledTimes(2);
    expect(result.skippedFiles).toEqual([]);
  });

  it("prefers the acquisition's extra-data over the examination's, one file of each kind", async () => {
    // Most specific to the loaded recording wins. The examination's inverse solution is still
    // used, since the acquisition has none.
    const client = makeClient({
      datasets: [{ id: 1, name: 'rest', type: 'Eeg' }],
      zips: { 1: EEG_ZIP },
      extraDataPaths: ['/data/exam-7/exam_electrodes.tsv', '/data/exam-7/exam_inversefilters.mat'],
      acquisitions: [{ id: 3, extraDataFilePathList: ['/data/acq-3/acq_electrodes.tsv'] }],
      acquisitionDatasets: { 3: [{ id: 1 }] },
    });
    const result = await fetchShanoirExamination({ client, examinationId: 7 });

    expect(names(result.eegFiles)).toEqual([
      'acq_electrodes.tsv',
      'exam_inversefilters.mat',
      'rec.eeg',
      'rec.vhdr',
    ]);
    // the file that isn't used isn't downloaded
    expect(client.downloadExtraData).not.toHaveBeenCalledWith(7, 'exam_electrodes.tsv', undefined);
    expect(result.skippedFiles).toEqual([
      {
        name: 'exam_electrodes.tsv',
        source: 'the examination',
        reason: "using acq_electrodes.tsv from the recording's acquisition",
      },
    ]);
  });

  it("prefers a file in the recording's own dataset over its acquisition's extra-data", async () => {
    const client = makeClient({
      datasets: [{ id: 1, name: 'rest', type: 'Eeg' }],
      zips: { 1: makeZip(['rec/rec.vhdr', 'rec/rec.eeg', 'rec/zip_electrodes.tsv']) },
      acquisitions: [{ id: 3, extraDataFilePathList: ['acq_electrodes.tsv'] }],
      acquisitionDatasets: { 3: [{ id: 1 }] },
    });
    const result = await fetchShanoirExamination({ client, examinationId: 7 });

    expect(names(result.eegFiles)).toEqual(['rec.eeg', 'rec.vhdr', 'zip_electrodes.tsv']);
    expect(client.downloadAcquisitionExtraData).not.toHaveBeenCalled();
    expect(result.skippedFiles).toEqual([
      {
        name: 'acq_electrodes.tsv',
        source: "the recording's acquisition",
        reason: "using zip_electrodes.tsv from the recording's dataset",
      },
    ]);
  });

  it('uses the last listed file when one place holds several of a kind, like a drop does', async () => {
    const client = makeClient({
      datasets: [{ id: 1, name: 'rest', type: 'Eeg' }],
      zips: { 1: EEG_ZIP },
      extraDataPaths: ['old_electrodes.tsv', 'new_electrodes.tsv'],
    });
    const result = await fetchShanoirExamination({ client, examinationId: 7 });

    expect(names(result.eegFiles)).toEqual(['new_electrodes.tsv', 'rec.eeg', 'rec.vhdr']);
    expect(result.skippedFiles).toEqual([
      {
        name: 'old_electrodes.tsv',
        source: 'the examination',
        reason: 'using new_electrodes.tsv from the examination',
      },
    ]);
  });

  it('only asks the acquisitions with usable extra-data for their datasets', async () => {
    const client = makeClient({
      datasets: [{ id: 1, name: 'rest', type: 'Eeg' }],
      zips: { 1: EEG_ZIP },
      acquisitions: [
        { id: 3, extraDataFilePathList: ['/data/acq-3/notes.pdf'] },
        { id: 4, extraDataFilePathList: [] },
      ],
    });
    await fetchShanoirExamination({ client, examinationId: 7 });

    expect(client.listAcquisitionDatasets).not.toHaveBeenCalled();
  });

  it('routes BIDS datasets by the file name in their dataset name, without downloading what is not loaded (fixture: examination 7)', async () => {
    // Examination 7's BIDS import: one `BIDS` dataset per file, named after it
    // ('sub-4_ses-7_T1w_nii_gz' is sub-4_ses-7_T1w.nii.gz). The EEG-tab recording 58 is the
    // latest, so the two BIDS recordings (ieeg 46/48/49, eeg 52/53/54) are older, and the BIDS
    // electrode positions and inverse solution belong to those, not to recording 58.
    const client = createFixtureClient();
    const result = await fetchShanoirExamination({ client, examinationId: 7 });

    expect(names(result.imagingFiles)).toEqual([
      'sub-4_ses-7_T1w.nii.gz',
      'sub-4_ses-7_atlas-L2018_res-scale2_dseg.nii.gz',
      'sub-4_ses-7_label-WM_dseg.nii.gz',
    ]);
    // only the recording 58 and the three images
    expect(client.downloadDatasetZip.mock.calls.map(([id]) => id).sort()).toEqual([44, 45, 47, 58]);
    const sameFolderOnly = 'only used with a recording from the same BIDS folder';
    expect(result.skippedDatasets).toEqual([
      {
        id: 57,
        name: 'sub-synth_task-rest_desc-spkavgall_ieeg',
        type: 'EEG',
        reason: 'older EEG recording, using the latest (highest dataset id)',
      },
      // a BIDS recording is one line, named after its files
      {
        id: 54,
        name: 'sub-4_ses-7_task-rest_desc-spkavgall_eeg',
        type: 'BIDS',
        reason: 'older EEG recording, using the latest (highest dataset id)',
      },
      {
        id: 49,
        name: 'sub-4_ses-7_task-rest_desc-spkavgall_ieeg',
        type: 'BIDS',
        reason: 'older EEG recording, using the latest (highest dataset id)',
      },
      { id: 43, name: 'sub-4_ses-7_electrodes_tsv', type: 'BIDS', reason: sameFolderOnly },
      {
        id: 50,
        name: 'sub-4_ses-7_desc-eloreta_inversefilters_mat',
        type: 'BIDS',
        reason: sameFolderOnly,
      },
      { id: 51, name: 'sub-4_ses-7_electrodes_tsv', type: 'BIDS', reason: sameFolderOnly },
    ]);
  });

  it('loads the latest BIDS recording with the electrode positions and inverse solution of its own BIDS folder (fixture: examination 7)', async () => {
    // Without the EEG-tab recordings 57 and 58, the BIDS eeg recording (52–54, folder eeg =
    // acquisition 15) is the latest. Its folder's files (50, 51) go with it; the ieeg folder's
    // electrode positions (43, acquisition 13) don't.
    const client = createFixtureClient();
    client.listExaminationDatasets.mockResolvedValue(
      fixtureBody('datasets-examination-7.json').filter((dataset) => dataset.type === 'BIDS')
    );
    const result = await fetchShanoirExamination({ client, examinationId: 7 });

    expect(result.eegDataset).toEqual({
      id: 54,
      name: 'sub-4_ses-7_task-rest_desc-spkavgall_eeg',
      type: 'BIDS',
    });
    expect(names(result.eegFiles)).toEqual([
      'sub-4_ses-7_desc-eloreta_inversefilters.mat',
      'sub-4_ses-7_electrodes.tsv',
      'sub-4_ses-7_task-rest_desc-spkavgall_eeg.eeg',
      'sub-4_ses-7_task-rest_desc-spkavgall_eeg.vhdr',
    ]);
    // not the .vmrk (52), which the EEG viewer doesn't read, nor the other folder's files
    expect(client.downloadDatasetZip.mock.calls.map(([id]) => id).sort()).toEqual([
      44, 45, 47, 50, 51, 53, 54,
    ]);
    expect(result.skippedDatasets).toEqual([
      {
        id: 49,
        name: 'sub-4_ses-7_task-rest_desc-spkavgall_ieeg',
        type: 'BIDS',
        reason: 'older EEG recording, using the latest (highest dataset id)',
      },
      {
        id: 43,
        name: 'sub-4_ses-7_electrodes_tsv',
        type: 'BIDS',
        reason: 'only used with a recording from the same BIDS folder',
      },
    ]);
  });

  it("prefers the examination's extra-data over the BIDS folder's files", async () => {
    const client = makeClient({
      datasets: [
        { id: 10, name: 'sub-1_ses-1_task-rest_eeg_vhdr', type: 'BIDS' },
        { id: 11, name: 'sub-1_ses-1_task-rest_eeg_eeg', type: 'BIDS' },
        { id: 12, name: 'sub-1_ses-1_electrodes_tsv', type: 'BIDS' },
      ],
      zips: {
        10: makeZip(['sub-1_ses-1_task-rest_eeg.vhdr']),
        11: makeZip(['sub-1_ses-1_task-rest_eeg.eeg']),
      },
      extraDataPaths: ['exam_electrodes.tsv'],
      acquisitions: [{ id: 15, name: 'eeg (BIDS)', type: 'BIDS', extraDataFilePathList: [] }],
      acquisitionDatasets: { 15: [{ id: 10 }, { id: 11 }, { id: 12 }] },
    });
    const result = await fetchShanoirExamination({ client, examinationId: 7 });

    expect(names(result.eegFiles)).toEqual([
      'exam_electrodes.tsv',
      'sub-1_ses-1_task-rest_eeg.eeg',
      'sub-1_ses-1_task-rest_eeg.vhdr',
    ]);
    expect(client.downloadDatasetZip).not.toHaveBeenCalledWith(12, undefined);
    expect(result.skippedFiles).toEqual([
      {
        name: 'sub-1_ses-1_electrodes.tsv',
        source: "the recording's BIDS folder",
        reason: 'using exam_electrodes.tsv from the examination',
      },
    ]);
  });

  it('downloads a renamed BIDS dataset once to route it by the file inside, and reports BIDS files VIDEPE does not open', async () => {
    const client = makeClient({
      datasets: [
        { id: 1, name: 'My T1', type: 'BIDS' },
        { id: 2, name: 'notes', type: 'BIDS' },
        { id: 3, name: 'sub-1_ses-1_task-rest_channels_tsv', type: 'BIDS' },
      ],
      zips: { 1: makeZip(['sub-1_T1w.nii.gz']), 2: makeZip(['notes.txt']) },
    });
    const result = await fetchShanoirExamination({ client, examinationId: 7 });

    expect(names(result.imagingFiles)).toEqual(['sub-1_T1w.nii.gz']);
    // the renamed ones once each; the channels file is known from its name not to be needed
    expect(client.downloadDatasetZip.mock.calls.map(([id]) => id).sort()).toEqual([1, 2]);
    expect(result.skippedDatasets).toEqual([
      { id: 2, name: 'notes', type: 'BIDS', reason: 'unsupported files: .txt' },
      {
        id: 3,
        name: 'sub-1_ses-1_task-rest_channels_tsv',
        type: 'BIDS',
        reason: 'unsupported files: .tsv',
      },
    ]);
  });

  it('passes the abort signal to every request', async () => {
    const client = makeClient({
      datasets: [{ id: 1, name: 'rest', type: 'Eeg' }],
      zips: { 1: EEG_ZIP },
      extraDataPaths: ['sub-01_electrodes.tsv'],
      processings: { 1: [{ id: 5 }] },
      acquisitions: [{ id: 3, extraDataFilePathList: ['sub-01_inversefilters.mat'] }],
      acquisitionDatasets: { 3: [{ id: 1 }] },
    });
    const { signal } = new AbortController();
    await fetchShanoirExamination({ client, examinationId: 7, signal });

    expect(client.listExaminationDatasets).toHaveBeenCalledWith(7, signal);
    expect(client.getExamination).toHaveBeenCalledWith(7, signal);
    expect(client.listProcessingsByInputDataset).toHaveBeenCalledWith(1, signal);
    expect(client.listProcessingOutputDatasets).toHaveBeenCalledWith(5, signal);
    expect(client.listExaminationAcquisitions).toHaveBeenCalledWith(7, signal);
    expect(client.listAcquisitionDatasets).toHaveBeenCalledWith(3, signal);
    expect(client.downloadDatasetZip).toHaveBeenCalledWith(1, signal);
    expect(client.downloadExtraData).toHaveBeenCalledWith(7, 'sub-01_electrodes.tsv', signal);
    expect(client.downloadAcquisitionExtraData).toHaveBeenCalledWith(
      3,
      'sub-01_inversefilters.mat',
      signal
    );
  });

  it('rejects when a download fails, so the caller can show one error', async () => {
    const client = makeClient({ datasets: [{ id: 1, name: 'rest', type: 'Eeg' }] });
    client.downloadDatasetZip.mockRejectedValue(new Error('dataset 1 was not found in Shanoir.'));
    await expect(fetchShanoirExamination({ client, examinationId: 7 })).rejects.toThrow(
      'not found'
    );
  });
});
