import { describe, it, expect } from 'vitest';
import {
  selectEegIntakeFiles,
  selectImagingFiles,
  hasEegRecording,
  listFileExtensions,
  sortFilesByViewer,
} from '@/utils/launchFiles';

const file = (name) => new File(['x'], name);
const names = (files) => files.map((f) => f.name);

describe('hasEegRecording', () => {
  it('is true when the files include a recording VIDEPE can read', () => {
    expect(hasEegRecording([file('rec.vhdr'), file('rec.eeg')])).toBe(true);
    expect(hasEegRecording([file('rec.edf')])).toBe(true);
  });

  it('is false for electrode positions or an inverse solution without a recording', () => {
    expect(hasEegRecording([file('sub-01_electrodes.tsv'), file('inv.mat')])).toBe(false);
  });

  it('is false for a recording format VIDEPE cannot read', () => {
    expect(hasEegRecording([file('rec.set')])).toBe(false); // EEGLAB
  });
});

describe('listFileExtensions', () => {
  it('lists each extension once, lowercased, in the order the files come in', () => {
    const files = [file('rec.EDF'), file('rec.json'), file('other.edf')];
    expect(listFileExtensions(files)).toEqual(['.edf', '.json']);
  });

  it('leaves out files without an extension, including paths with a dot in a folder name', () => {
    expect(listFileExtensions([file('README'), file('v1.2/IM0001')])).toEqual([]);
  });
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

// For a mixed set of files, e.g. what a host app sends: each file goes to the viewer that can
// open it, and the rest is reported back so the user can be told what wasn't shown
describe('sortFilesByViewer', () => {
  it('sends EEG files to the EEG viewer and imaging files to the neuroimaging viewer', () => {
    const files = [
      file('rec.vhdr'),
      file('sub-01_T1w.nii.gz'),
      file('rec.eeg'),
      file('sub-01_electrodes.tsv'),
      file('lh.pial.gii'),
      file('inv.mat'),
    ];
    const { eegFiles, imagingFiles, skippedFiles } = sortFilesByViewer(files);
    expect(names(eegFiles)).toEqual(['rec.vhdr', 'rec.eeg', 'sub-01_electrodes.tsv', 'inv.mat']);
    expect(names(imagingFiles)).toEqual(['sub-01_T1w.nii.gz', 'lh.pial.gii']);
    expect(skippedFiles).toEqual([]);
  });

  it('reports the files neither viewer opens as skipped, instead of dropping them silently', () => {
    const files = [
      file('rec.edf'),
      file('rec.set'), // EEGLAB: a recording format VIDEPE can't read
      file('report.pdf'),
      file('sub-01_channels.tsv'), // a .tsv that isn't electrode positions
    ];
    const { eegFiles, imagingFiles, skippedFiles } = sortFilesByViewer(files);
    expect(names(eegFiles)).toEqual(['rec.edf']);
    expect(imagingFiles).toEqual([]);
    expect(names(skippedFiles)).toEqual(['rec.set', 'report.pdf', 'sub-01_channels.tsv']);
  });

  it('keeps every file in exactly one group', () => {
    const files = [file('rec.vhdr'), file('T1.nii'), file('notes.txt'), file('rec.vmrk')];
    const { eegFiles, imagingFiles, skippedFiles } = sortFilesByViewer(files);
    expect(eegFiles.length + imagingFiles.length + skippedFiles.length).toBe(files.length);
  });

  it('handles an empty list', () => {
    expect(sortFilesByViewer([])).toEqual({ eegFiles: [], imagingFiles: [], skippedFiles: [] });
  });
});
