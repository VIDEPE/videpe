# Shanoir API fixtures

These tests check VIDEPE against what **Shanoir 2.18.1** returned, not against the Shanoir running today: the responses are frozen, so the tests keep passing when Shanoir changes. When Shanoir upgrades, recreate them (see [Recreating these fixtures](#recreating-these-fixtures)).

Real responses from a local Shanoir NG_v2.18.1 instance (Docker), captured on 2026-11-23 (the processing lookups of the processed datasets 40–42 on 2026-11-24) with:

```
node scripts/capture-shanoir-fixtures.js 4 5 7
```

The capture holds more than this folder (every acquisition in full, the `?output=true` responses, every download, examination 5). Only the files a test reads are kept here, to keep the folder small enough to see what is tested.

Each file is `{ request, status, body }` for one GET request. Downloads (`download-*`) hold only metadata: status, headers, size, and the names of the files in a zip, never the file contents. Extra-data files aren't kept: the fixture client (`createFixtureClient` in `src/test/shanoir/shanoirFixtures.js`) answers those downloads with a placeholder file of the requested name. Usernames are replaced by `shanoir-user`.

All data is synthetic: study `DemoStudy` (1), subject `synth` (4).

## What's in each examination

| Examination  | Datasets                                                                                                                                                                                                                              | Extra data                                                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **4**, iEEG  | recording 38 (`EEG`, acquisition 11), imported via the EEG tab                                                                                                                                                                        | examination: `sub-synth_electrodes.tsv`                                                                                                                      |
| **7**, mixed | BIDS import: acquisition 13 `ieeg (BIDS)` → 43, 46, 48, 49; 14 `anat (BIDS)` → 44, 45, 47; 15 `eeg (BIDS)` → 50–54. Then two EEG-tab imports: recording 57 (iEEG, acquisition 18) and 58 (scalp EEG, acquisition 19, the most recent) | acquisition 18: `sub-synth_electrodes.tsv`; acquisition 19: `sub-synth_electrodes.tsv`, `sub-synth_desc-eloreta_inversefilters.mat`; none on the examination |

Processed datasets, each from its own processing (1, 2, 3) with recording 38 as input, so they belong to examination 4: 40 (`MR`, T1), 41 (`SEGMENTATION`, WM mask), 42 (`SEGMENTATION`, atlas). No processing uses 40–42 as input (204), so there are no chains (outputs of outputs).

## Which test uses which examination

All in `src/test/shanoir/fetchShanoirExamination.test.js`; the other tests there use hand-written responses.

| Examination | Test                                                                                                     |
| ----------- | -------------------------------------------------------------------------------------------------------- |
| **4**       | loads processed datasets made from the examination datasets as imaging, and the examination's extra-data |
| **7**       | loads the latest of the EEG-tab recordings in a real Shanoir examination                                 |
| **7**       | adds the extra-data of the loaded recording's acquisition, not of another recording's                    |
| **7**       | routes BIDS datasets by the file name in their dataset name, without downloading what is not loaded      |
| **7**       | loads the latest BIDS recording with the electrode positions and inverse solution of its own BIDS folder |

## Recreating these fixtures

The ids above come from one Shanoir instance (the examinations are 4 and 7 because earlier uploads used the lower ids). A fresh instance gives other ids, so the steps below name the examinations by role: **A** (4 here) and **B** (7 here). The order of the imports matters: VIDEPE loads the recording with the highest dataset id, and the tests expect the scalp EEG recording in B to be the latest.

All files come from `public/demo_data/` (`anat/`, `eeg/`, `ieeg/`). In one study, for one subject:

1. **Examination A**
   1. Import the iEEG recording via the EEG tab: a zip of `ieeg/sub-synth_task-rest_desc-spkavgall_ieeg.{vhdr,vmrk,eeg}`.
   2. Examination → Edit → Extra data: upload `ieeg/sub-synth_electrodes.tsv`.
   3. Import each of the three `anat/` files as a processed dataset, each with its own processing, with the recording from step 1 as input: `sub-synth_T1w.nii.gz` as `MR`, `sub-synth_label-WM_dseg.nii.gz` and `sub-synth_atlas-L2018_res-scale2_dseg.nii.gz` as `SEGMENTATION`.
2. **Examination B**
   1. BIDS import of a zip holding `sub-synth/` with the `anat/`, `eeg/` and `ieeg/` folders of `public/demo_data/` (all files, including the `.vmrk` files). This creates examination B.
   2. Import the iEEG recording into B via the EEG tab (as in A.1).
   3. Then import the scalp EEG recording into B via the EEG tab: a zip of `eeg/sub-synth_task-rest_desc-spkavgall_eeg.{vhdr,vmrk,eeg}`. This one must be last.
   4. On the iEEG recording's acquisition (from step 2), Edit → Extra data: upload `ieeg/sub-synth_electrodes.tsv`.
   5. On the scalp EEG recording's acquisition (from step 3), Edit → Extra data: upload `eeg/sub-synth_electrodes.tsv` and `eeg/sub-synth_desc-eloreta_inversefilters.mat`.

Then capture both examinations, as above with their new ids: `node scripts/capture-shanoir-fixtures.js <A> <B>`. Check the output for personal details, and copy into this folder the same files as are here now, under their new names. Delete the old ones.

Finally, update the Shanoir version at the top, the tables in this README, and the ids in the five tests listed above, in their assertions and comments. [What's in each examination](#whats-in-each-examination) says what each id is: find the new id of the same dataset or acquisition in the new capture and replace it. BIDS file names contain the subject and examination ids too (`sub-4_ses-7_…`). Running the tests afterwards shows any value that was missed.

## Shanoir behaviour seen in the capture

- `datasets/examination/{id}?output=true` answers **204** for every examination (bug: inner joins in `DatasetRepository.findByIdsWithProcessingAncestorsAndExamination`). Processed outputs are found with `datasetProcessing/inputDataset/{datasetId}` and then `datasetProcessing/{processingId}/outputDatasets/`.
- In `datasets/examination/{id}`, `datasetAcquisition` is **null** on every dataset. The dataset → acquisition link comes from `datasets/acquisition/{acquisitionId}`.
- Dataset `type` is uppercase here (`EEG`, `BIDS`, `MR`, `SEGMENTATION`).
- The EEG-tab import keeps only the recording files (`.vhdr`, `.vmrk`, `.eeg`); sidecar files in the uploaded zip are discarded. Acquisition extra data exists only when uploaded by hand on the acquisition.
- BIDS datasets are named `sub-<subjectId>_ses-<examinationId>_<file name with . → _>`, e.g. `sub-4_ses-7_T1w_nii_gz`. Each downloads as a zip holding that one file, e.g. `sub-4_ses-7_T1w.nii.gz`.
