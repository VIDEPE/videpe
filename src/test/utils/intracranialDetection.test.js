import { describe, it, expect } from 'vitest';
import { parseElectrodeContactName, detectIsIntracranial } from '@/utils/intracranialDetection';

// A small stand-in for the standard_1005 template — just enough labels to exercise
// match-ratio behavior without needing the full 346-entry asset.
const STANDARD_1005_FIXTURE = [
  { label: 'Fp1', x: 0, y: 0, z: 0 },
  { label: 'Fp2', x: 0, y: 0, z: 0 },
  { label: 'Fz', x: 0, y: 0, z: 0 },
  { label: 'Cz', x: 0, y: 0, z: 0 },
  { label: 'C3', x: 0, y: 0, z: 0 },
  { label: 'C4', x: 0, y: 0, z: 0 },
  { label: 'O1', x: 0, y: 0, z: 0 },
  { label: 'O2', x: 0, y: 0, z: 0 },
  { label: 'T7', x: 0, y: 0, z: 0 },
  { label: 'T8', x: 0, y: 0, z: 0 },
];

describe('parseElectrodeContactName', () => {
  it('parses a simple group+contact name', () => {
    expect(parseElectrodeContactName('B1')).toEqual({ group: 'b', contact: 1 });
  });

  it('parses a primed group+contact name', () => {
    expect(parseElectrodeContactName("B'12")).toEqual({ group: "b'", contact: 12 });
  });

  it('parses multi-letter groups', () => {
    expect(parseElectrodeContactName('LA3')).toEqual({ group: 'la', contact: 3 });
  });

  it('strips the same EEG/MEG prefix and -suffix normalizeChannelName handles', () => {
    expect(parseElectrodeContactName('EEG Fp1-Ref')).toEqual({ group: 'fp', contact: 1 });
  });

  it('returns null for names with no trailing digits', () => {
    expect(parseElectrodeContactName('ECG')).toBeNull();
    expect(parseElectrodeContactName('Status')).toBeNull();
  });

  it('returns null for purely numeric names (no leading letters)', () => {
    expect(parseElectrodeContactName('12')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(parseElectrodeContactName('')).toBeNull();
  });
});

describe('detectIsIntracranial', () => {
  it('returns false for an all-scalp channel set with a high template match ratio', () => {
    const channelNames = ['Fp1', 'Fp2', 'Cz', 'Fz'];
    expect(detectIsIntracranial(channelNames, STANDARD_1005_FIXTURE)).toBe(false);
  });

  it('returns true for a primed sEEG group even with zero template matches', () => {
    const channelNames = ["B'1", "B'2", "B'3"];
    expect(detectIsIntracranial(channelNames, STANDARD_1005_FIXTURE)).toBe(true);
  });

  it('returns true for a non-primed sEEG group with a low template match ratio', () => {
    const channelNames = ['LA1', 'LA2', 'LA3', 'LA4'];
    expect(detectIsIntracranial(channelNames, STANDARD_1005_FIXTURE)).toBe(true);
  });

  it('returns false for scalp names that coincidentally match the contact-name shape but match the template well', () => {
    const channelNames = ['C3', 'C4', 'Cz'];
    expect(detectIsIntracranial(channelNames, STANDARD_1005_FIXTURE)).toBe(false);
  });

  it('returns true for a realistic mixed sEEG set with a couple of non-electrode marker channels', () => {
    // Mirrors the plan's worked example: mostly B/T contacts, plus ECG/Status markers
    // that don't parse — shape ratio stays high enough, template match stays at zero.
    const channelNames = [
      'B1',
      'B2',
      'B3',
      'B4',
      'B5',
      'B6',
      'B7',
      'B8',
      'T1',
      'T2',
      'T3',
      'T4',
      'ECG',
      'Status',
    ];
    expect(detectIsIntracranial(channelNames, STANDARD_1005_FIXTURE)).toBe(true);
  });

  it('returns false for an empty channel list', () => {
    expect(detectIsIntracranial([], STANDARD_1005_FIXTURE)).toBe(false);
  });

  it('handles a single scalp channel without crashing', () => {
    expect(detectIsIntracranial(['Cz'], STANDARD_1005_FIXTURE)).toBe(false);
  });

  it('handles a single non-primed sEEG-shaped channel without crashing', () => {
    expect(detectIsIntracranial(['T1'], STANDARD_1005_FIXTURE)).toBe(true);
  });
});
