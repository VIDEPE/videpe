import { describe, it, expect } from 'vitest';
import { classifyDataset, selectExtraDataFileNames } from '@/shanoir/shanoirFiles';

// The file sorting shared with the host-app mode (selectEegIntakeFiles, selectImagingFiles,
// hasEegRecording, listFileExtensions) is tested in src/test/utils/launchFiles.test.js.

describe('classifyDataset', () => {
  it('classifies EEG datasets', () => {
    expect(classifyDataset({ type: 'Eeg' })).toBe('eeg');
    expect(classifyDataset({ type: 'EEG' })).toBe('eeg'); // check uppercase variant
    expect(classifyDataset({ type: 'eeg' })).toBe('eeg'); // check lowercase variant
  });

  it.each(['Mr', 'Pet', 'Spect', 'Ct', 'Segmentation', 'Mesh'])(
    'classifies %s datasets as imaging',
    (type) => {
      expect(classifyDataset({ type })).toBe('imaging');
      expect(classifyDataset({ type: type.toUpperCase() })).toBe('imaging'); // check uppercase variant
      expect(classifyDataset({ type: type.toLowerCase() })).toBe('imaging'); // check lowercase variant
    }
  );

  it.each(['Meg', 'Measurement', 'Sr', 'Generic', undefined])(
    'leaves %s datasets unsupported',
    (type) => {
      expect(classifyDataset({ type })).toBeNull();
      expect(classifyDataset({ type: type?.toUpperCase() })).toBeNull(); // check uppercase variant and ? to make sure undefined does not throw error
      expect(classifyDataset({ type: type?.toLowerCase() })).toBeNull(); // check lowercase variant and ? to make sure undefined does not throw error
    }
  );
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
