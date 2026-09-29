import { describe, it, expect } from 'vitest';
import {
  classifyDataset,
  selectEegIntakeFiles,
  selectImagingFiles,
  selectExtraDataFileNames,
} from '@/loaders/shanoirFiles';

const file = (name) => new File(['x'], name);
const names = (files) => files.map((f) => f.name);

describe('classifyDataset', () => {
  it('classifies EEG datasets', () => {
    expect(classifyDataset({ type: 'Eeg' })).toBe('eeg');
  });

  it.each(['Mr', 'Pet', 'Spect', 'Ct', 'Segmentation', 'Mesh'])(
    'classifies %s datasets as imaging',
    (type) => {
      expect(classifyDataset({ type })).toBe('imaging');
    }
  );

  it.each(['Meg', 'Measurement', 'Sr', 'Generic', undefined])(
    'leaves %s datasets unsupported',
    (type) => {
      expect(classifyDataset({ type })).toBeNull();
    }
  );
});

describe('selectEegIntakeFiles', () => {
  it('keeps the recording, electrode positions and inverse solution', () => {
    const files = [
      file('sub-01_task-rest_eeg.vhdr'),
      file('sub-01_task-rest_eeg.eeg'),
      file('sub-01_task-rest_eeg_electrodes.tsv'),
      file('positions.elc'),
      file('sub-01_inversefilters.mat'),
    ];
    expect(names(selectEegIntakeFiles(files))).toEqual(names(files));
  });

  it('drops BIDS sidecar .tsv files that are not electrode positions', () => {
    // Every .tsv would otherwise be routed to the electrode-position parser.
    const files = [
      file('sub-01_task-rest_eeg.vhdr'),
      file('sub-01_task-rest_channels.tsv'),
      file('sub-01_task-rest_events.tsv'),
    ];
    expect(names(selectEegIntakeFiles(files))).toEqual(['sub-01_task-rest_eeg.vhdr']);
  });

  it('drops files VIDEPE does not use, like the BrainVision marker file', () => {
    // A .vmrk would otherwise trigger an "Unsupported file" toast in the EEG intake.
    const files = [file('rec.vhdr'), file('rec.eeg'), file('rec.vmrk'), file('rec_eeg.json')];
    expect(names(selectEegIntakeFiles(files))).toEqual(['rec.vhdr', 'rec.eeg']);
  });

  it('is case-insensitive', () => {
    const files = [file('REC.VHDR'), file('Sub-01_Electrodes.TSV')];
    expect(names(selectEegIntakeFiles(files))).toEqual(['REC.VHDR', 'Sub-01_Electrodes.TSV']);
  });
});

describe('selectImagingFiles', () => {
  it('keeps volumes and surface meshes', () => {
    const files = [
      file('sub-01_T1w.nii.gz'),
      file('sub-01_pet.nii'),
      file('aseg.mgz'),
      file('orig.mgh'),
      file('lh.pial.gii'),
    ];
    expect(names(selectImagingFiles(files))).toEqual(names(files));
  });

  it('drops conversion sidecars that are not images', () => {
    // Shanoir's DICOM → NIfTI conversion can add JSON sidecars and diffusion gradient files.
    const files = [
      file('sub-01_dwi.nii.gz'),
      file('sub-01_dwi.json'),
      file('sub-01_dwi.bval'),
      file('sub-01_dwi.bvec'),
    ];
    expect(names(selectImagingFiles(files))).toEqual(['sub-01_dwi.nii.gz']);
  });

  it('is case-insensitive', () => {
    expect(names(selectImagingFiles([file('T1.NII.GZ')]))).toEqual(['T1.NII.GZ']);
  });
});

describe('selectExtraDataFileNames', () => {
  it('keeps electrode positions and inverse solutions, as base file names', () => {
    const paths = [
      '/var/datasets-data/examination-7/sub-01_ses-01_electrodes.tsv',
      'C:\\data\\exam-7\\positions.elc',
      'sub-01_inversefilters.mat',
      '/var/datasets-data/examination-7/report.pdf',
      '/var/datasets-data/examination-7/sub-01_ses-01_scans.tsv',
    ];
    expect(selectExtraDataFileNames(paths)).toEqual([
      'sub-01_ses-01_electrodes.tsv',
      'positions.elc',
      'sub-01_inversefilters.mat',
    ]);
  });

  it('handles a missing list', () => {
    expect(selectExtraDataFileNames(undefined)).toEqual([]);
  });
});
