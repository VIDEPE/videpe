import { describe, it, expect } from 'vitest';
import { bidsFileNameFromDatasetName } from '@/shanoir/bidsDatasets';

describe('bidsFileNameFromDatasetName', () => {
  it("restores the file name from Shanoir's BIDS dataset name (dots replaced by underscores)", () => {
    expect(bidsFileNameFromDatasetName('sub-4_ses-7_T1w_nii_gz')).toBe('sub-4_ses-7_T1w.nii.gz');
    expect(bidsFileNameFromDatasetName('sub-4_ses-7_task-rest_eeg_eeg')).toBe(
      'sub-4_ses-7_task-rest_eeg.eeg'
    );
    expect(bidsFileNameFromDatasetName('sub-4_ses-7_task-rest_eeg_vmrk')).toBe(
      'sub-4_ses-7_task-rest_eeg.vmrk'
    );
  });

  it('returns null for a name without a known extension, e.g. a renamed dataset', () => {
    expect(bidsFileNameFromDatasetName('My T1')).toBeNull();
    expect(bidsFileNameFromDatasetName('')).toBeNull();
  });
});
