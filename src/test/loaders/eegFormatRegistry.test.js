import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  checkEegFiles,
  detectAndLoadEEG,
  EEG_FORMAT_EXTENSIONS,
  ELEC_POS_EXTENSIONS,
  getEegFormatName,
  SUPPORTED_EEG_FORMATS,
  SUPPORTED_EEG_FORMATS_TEXT,
} from '@/loaders/eegFormatRegistry';

vi.mock('@/loaders/loadEegBrainVision', () => ({
  loadEegBrainVision: vi.fn(),
}));

vi.mock('@/loaders/loadEegEdf', () => ({
  loadEegEdf: vi.fn(),
}));

vi.mock('@/loaders/loadEegTrc', () => ({
  loadEegTrc: vi.fn(),
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
    expect(result.formatName).toMatch(/BrainVision/);
    expect(result.complete).toBe(false);
    expect(result.missing).toContain('.eeg');
    expect(result.warning).toBeNull();
  });

  it('detects a partial BrainVision match with only .eeg', () => {
    const result = checkEegFiles([makeFile('sub01.eeg')]);
    expect(result.formatName).toMatch(/BrainVision/);
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
    expect(result.formatName).toMatch(/BrainVision/);
    expect(result.complete).toBe(true);
  });

  it('warns when base names differ only by case — Sub01 and sub01 are distinct files on case-sensitive systems', () => {
    const result = checkEegFiles([makeFile('Sub01.vhdr'), makeFile('sub01.eeg')]);
    expect(result.complete).toBe(false);
    expect(result.warning).toBeTruthy();
  });

  it('returns complete=true for a single .edf file (EDF needs no companion files)', () => {
    const result = checkEegFiles([makeFile('sub01.EDF')]);
    expect(result.formatName).toMatch(/EDF/);
    expect(result.complete).toBe(true);
    expect(result.missing).toHaveLength(0);
    expect(result.warning).toBeNull();
  });

  it('returns complete=true for a single .trc file (Micromed TRC needs no companion files)', () => {
    const result = checkEegFiles([makeFile('sub01.TRC')]);
    expect(result.formatName).toMatch(/Micromed/);
    expect(result.complete).toBe(true);
    expect(result.missing).toHaveLength(0);
    expect(result.warning).toBeNull();
  });
});

describe('EEG_FORMAT_EXTENSIONS', () => {
  it('lists the extensions recognized by supported EEG formats, e.g. BrainVision, EDF and Micromed TRC', () => {
    expect(EEG_FORMAT_EXTENSIONS).toContain('.vhdr');
    expect(EEG_FORMAT_EXTENSIONS).toContain('.eeg');
    expect(EEG_FORMAT_EXTENSIONS).toContain('.edf');
    expect(EEG_FORMAT_EXTENSIONS).toContain('.trc');
  });

  it('does not include imaging or electrode-position/inverse-solution extensions', () => {
    expect(EEG_FORMAT_EXTENSIONS).not.toContain('.nii');
    expect(EEG_FORMAT_EXTENSIONS).not.toContain('.elc');
    expect(EEG_FORMAT_EXTENSIONS).not.toContain('.mat');
  });
});

describe('getEegFormatName', () => {
  it('names the format a file belongs to, by its extension (case-insensitive)', () => {
    expect(getEegFormatName('sub01.vhdr')).toMatch(/BrainVision/);
    expect(getEegFormatName('sub01.EEG')).toMatch(/BrainVision/);
    expect(getEegFormatName('sub01.edf')).toMatch(/EDF/);
    expect(getEegFormatName('sub01.TRC')).toMatch(/Micromed/);
  });

  it('returns null for a file that belongs to no EEG format', () => {
    expect(getEegFormatName('sub01_electrodes.tsv')).toBeNull();
  });
});

describe('SUPPORTED_EEG_FORMATS', () => {
  it('lists every supported EEG format with its name and extensions', () => {
    expect(SUPPORTED_EEG_FORMATS).toContainEqual({
      name: expect.stringMatching(/BrainVision/),
      extensions: ['.vhdr', '.eeg'],
    });
    expect(SUPPORTED_EEG_FORMATS).toContainEqual({
      name: expect.stringMatching(/EDF/),
      extensions: ['.edf'],
    });
    expect(SUPPORTED_EEG_FORMATS).toContainEqual({
      name: expect.stringMatching(/Micromed/),
      extensions: ['.trc'],
    });
  });
});

describe('SUPPORTED_EEG_FORMATS_TEXT', () => {
  it('names every supported EEG format with its extensions', () => {
    expect(SUPPORTED_EEG_FORMATS_TEXT).toMatch(/BrainVision.*\(\.vhdr \+ \.eeg\)/);
    expect(SUPPORTED_EEG_FORMATS_TEXT).toMatch(/EDF.*\(\.edf\)/);
    expect(SUPPORTED_EEG_FORMATS_TEXT).toMatch(/Micromed.*\(\.trc\)/);
  });
});

describe('ELEC_POS_EXTENSIONS', () => {
  it('does not include .edf — the intake routes these before format detection, so an EDF recording would never reach its loader', () => {
    expect(ELEC_POS_EXTENSIONS).not.toContain('.edf');
  });
});

describe('detectAndLoadEEG', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls loadEegBrainVision with the correct files for a complete BrainVision set', async () => {
    const { loadEegBrainVision } = await import('@/loaders/loadEegBrainVision');
    loadEegBrainVision.mockResolvedValue({
      channelNames: ['Ch1'],
      fs: 1,
      tMax: 1,
      getChunk: vi.fn(),
    });

    const vhdr = makeFile('sub01.vhdr');
    const eeg = makeFile('sub01.eeg');
    await detectAndLoadEEG([vhdr, eeg]);

    expect(loadEegBrainVision).toHaveBeenCalledOnce();
    expect(loadEegBrainVision).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'sub01.vhdr' }),
      expect.objectContaining({ name: 'sub01.eeg' })
    );
  });

  it('calls loadEegEdf with the .edf file', async () => {
    const { loadEegEdf } = await import('@/loaders/loadEegEdf');
    const { loadEegBrainVision } = await import('@/loaders/loadEegBrainVision');
    loadEegEdf.mockResolvedValue({ channelNames: ['Ch1'], fs: 1, tMax: 1, getChunk: vi.fn() });

    await detectAndLoadEEG([makeFile('sub01.edf')]);

    expect(loadEegEdf).toHaveBeenCalledOnce();
    expect(loadEegEdf).toHaveBeenCalledWith(expect.objectContaining({ name: 'sub01.edf' }));
    expect(loadEegBrainVision).not.toHaveBeenCalled();
  });

  it('calls loadEegTrc with the .trc file', async () => {
    const { loadEegTrc } = await import('@/loaders/loadEegTrc');
    const { loadEegEdf } = await import('@/loaders/loadEegEdf');
    loadEegTrc.mockResolvedValue({ channelNames: ['Ch1'], fs: 1, tMax: 1, getChunk: vi.fn() });

    await detectAndLoadEEG([makeFile('sub01.TRC')]);

    expect(loadEegTrc).toHaveBeenCalledOnce();
    expect(loadEegTrc).toHaveBeenCalledWith(expect.objectContaining({ name: 'sub01.TRC' }));
    expect(loadEegEdf).not.toHaveBeenCalled();
  });

  it('throws with a message listing supported formats for an unrecognized file set', () => {
    expect(() => detectAndLoadEEG([makeFile('data.txt')])).toThrow(/BrainVision.*EDF.*Micromed/i);
  });
});
