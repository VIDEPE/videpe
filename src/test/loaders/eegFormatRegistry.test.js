import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  checkEegFiles,
  detectAndLoadEEG,
  EEG_FORMAT_EXTENSIONS,
} from '@/loaders/eegFormatRegistry';

vi.mock('@/loaders/loadEEGBrainVision', () => ({
  loadBrainVisionEEG: vi.fn(),
}));

const makeFile = (name) => new File([''], name);

describe('checkEegFiles', () => {
  it('returns null formatName for an empty file list', () => {
    expect(checkEegFiles([])).toEqual({
      formatName: null,
      complete: false,
      missing: null,
      warning: null,
    });
  });

  it('returns null formatName for unrecognized extensions', () => {
    const result = checkEegFiles([makeFile('recording.txt'), makeFile('data.csv')]);
    expect(result.formatName).toBeNull();
    expect(result.complete).toBe(false);
  });

  it('detects a partial BrainVision match with only .vhdr', () => {
    const result = checkEegFiles([makeFile('sub01.vhdr')]);
    expect(result.formatName).toBe('BrainVision');
    expect(result.complete).toBe(false);
    expect(result.missing).toContain('.eeg');
    expect(result.warning).toBeNull();
  });

  it('detects a partial BrainVision match with only .eeg', () => {
    const result = checkEegFiles([makeFile('sub01.eeg')]);
    expect(result.formatName).toBe('BrainVision');
    expect(result.complete).toBe(false);
    expect(result.missing).toContain('.vhdr');
    expect(result.warning).toBeNull();
  });

  it('returns complete=true when both files share the same base name', () => {
    const result = checkEegFiles([makeFile('sub01.vhdr'), makeFile('sub01.eeg')]);
    expect(result.complete).toBe(true);
    expect(result.missing).toHaveLength(0);
    expect(result.warning).toBeNull();
  });

  it('returns complete=false and a warning when base names differ', () => {
    const result = checkEegFiles([makeFile('sub01.vhdr'), makeFile('sub02.eeg')]);
    expect(result.complete).toBe(false);
    expect(result.warning).toBeTruthy();
    expect(result.warning).toMatch(/mismatch/i); // check that the warning mentions the word 'mismatch'
  });

  it('is case-insensitive for file extensions', () => {
    const result = checkEegFiles([makeFile('sub01.VHDR'), makeFile('sub01.EEG')]);
    expect(result.formatName).toBe('BrainVision');
    expect(result.complete).toBe(true);
  });

  it('warns when base names differ only by case — Sub01 and sub01 are distinct files on case-sensitive systems', () => {
    const result = checkEegFiles([makeFile('Sub01.vhdr'), makeFile('sub01.eeg')]);
    expect(result.complete).toBe(false);
    expect(result.warning).toBeTruthy();
  });
});

describe('EEG_FORMAT_EXTENSIONS', () => {
  it('lists the extensions recognized by supported EEG formats, e.g. BrainVision', () => {
    expect(EEG_FORMAT_EXTENSIONS).toContain('.vhdr');
    expect(EEG_FORMAT_EXTENSIONS).toContain('.eeg');
  });

  it('does not include imaging or electrode-position/inverse-solution extensions', () => {
    expect(EEG_FORMAT_EXTENSIONS).not.toContain('.nii');
    expect(EEG_FORMAT_EXTENSIONS).not.toContain('.elc');
    expect(EEG_FORMAT_EXTENSIONS).not.toContain('.mat');
  });
});

describe('detectAndLoadEEG', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls loadBrainVisionEEG with the correct files for a complete BrainVision set', async () => {
    const { loadBrainVisionEEG } = await import('@/loaders/loadEEGBrainVision');
    loadBrainVisionEEG.mockResolvedValue({
      channelNames: ['Ch1'],
      fs: 1,
      tMax: 1,
      getChunk: vi.fn(),
    });

    const vhdr = makeFile('sub01.vhdr');
    const eeg = makeFile('sub01.eeg');
    await detectAndLoadEEG([vhdr, eeg]);

    expect(loadBrainVisionEEG).toHaveBeenCalledOnce();
    expect(loadBrainVisionEEG).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'sub01.vhdr' }),
      expect.objectContaining({ name: 'sub01.eeg' })
    );
  });

  it('throws with a message listing supported formats for an unrecognized file set', () => {
    expect(() => detectAndLoadEEG([makeFile('data.txt')])).toThrow(/BrainVision/i);
  });
});
