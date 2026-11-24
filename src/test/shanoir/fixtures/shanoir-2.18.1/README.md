# Shanoir 2.18.1 API fixtures

Real responses from a local Shanoir NG_v2.18.1 instance (Docker), captured on 2026-11-23 (the processing lookups of the processed datasets 40–42 on 2026-11-24) with:

```
node scripts/capture-shanoir-fixtures.js 4 5 7
```

Each file is `{ request, status, body }` for one GET request. Downloads (`download-*`, `extradata-*`) hold only metadata: status, headers, size, and the names of the files in a zip, never the file contents. Usernames are replaced by `shanoir-user`.

All data is synthetic: study `DemoStudy` (1), subject `synth` (4).

## What's in each examination

| Examination      | Datasets                                                                                                                                                                                                                              | Extra data                                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **4**, iEEG      | recording 38 (`EEG`, acquisition 11), imported via the EEG tab                                                                                                                                                                        | examination: `sub-synth_electrodes.tsv`                                                                                                                      |
| **5**, scalp EEG | recording 39 (`EEG`, acquisition 12), imported via the EEG tab                                                                                                                                                                        | examination: `sub-synth_electrodes.tsv`, `sub-synth_desc-eloreta_inversefilters.mat`                                                                         |
| **7**, mixed     | BIDS import: acquisition 13 `ieeg (BIDS)` → 43, 46, 48, 49; 14 `anat (BIDS)` → 44, 45, 47; 15 `eeg (BIDS)` → 50–54. Then two EEG-tab imports: recording 57 (iEEG, acquisition 18) and 58 (scalp EEG, acquisition 19, the most recent) | acquisition 18: `sub-synth_electrodes.tsv`; acquisition 19: `sub-synth_electrodes.tsv`, `sub-synth_desc-eloreta_inversefilters.mat`; none on the examination |

Processed datasets, each from its own processing (1, 2, 3) with **both** recordings 38 and 39 as input, so they belong to examinations 4 and 5: 40 (`MR`, T1), 41 (`SEGMENTATION`, WM mask), 42 (`SEGMENTATION`, atlas). No processing uses 40–42 as input (204), so there are no chains (outputs of outputs).

## Shanoir behaviour these fixtures record

- `datasets/examination/{id}?output=true` answers **204** for every examination (bug: inner joins in `DatasetRepository.findByIdsWithProcessingAncestorsAndExamination`). Processed outputs are found with `datasetProcessing/inputDataset/{datasetId}` and then `datasetProcessing/{processingId}/outputDatasets/`.
- In `datasets/examination/{id}`, `datasetAcquisition` is **null** on every dataset. The dataset → acquisition link comes from `datasets/acquisition/{acquisitionId}`.
- Dataset `type` is uppercase here (`EEG`, `BIDS`, `MR`, `SEGMENTATION`).
- The EEG-tab import keeps only the recording files (`.vhdr`, `.vmrk`, `.eeg`); sidecar files in the uploaded zip are discarded. Acquisition extra data exists only when uploaded by hand on the acquisition.
- BIDS datasets are named `sub-<subjectId>_ses-<examinationId>_<file name with . → _>`, e.g. `sub-4_ses-7_T1w_nii_gz`. Each downloads as a zip holding that one file, e.g. `sub-4_ses-7_T1w.nii.gz`.
