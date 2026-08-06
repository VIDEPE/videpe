import { describe, it, expect } from 'vitest';
import { toAnyWaveMontage } from '@/loaders/toAnyWaveMontage';
import { parseAnyWaveMontage } from '@/loaders/parseAnyWaveMontage';

describe('toAnyWaveMontage', () => {
  it('serializes rows + channel types into AnyWave XML', () => {
    const rows = [{ channel: 'FP2', reference: null, color: 'darkblue' }];
    const channelSettings = { FP2: { type: 'eeg', bad: false } };
    const xml = toAnyWaveMontage(rows, channelSettings);
    expect(xml).toContain('<Channel name="FP2">');
    expect(xml).toContain('<type>EEG</type>');
    expect(xml).toContain('<reference></reference>');
    expect(xml).toContain('<color>darkblue</color>');
  });

  it('maps seeg/other channel types to SEEG/Other', () => {
    const rows = [
      { channel: 'A1', reference: null, color: null },
      { channel: 'B1', reference: null, color: null },
    ];
    const channelSettings = {
      A1: { type: 'seeg', bad: false },
      B1: { type: 'other', bad: false },
    };
    const xml = toAnyWaveMontage(rows, channelSettings);
    expect(xml).toContain('<type>SEEG</type>');
    expect(xml).toContain('<type>Other</type>');
  });

  it('serializes a bipolar reference and empty color as their respective tags', () => {
    const rows = [{ channel: 'F3', reference: 'Fz', color: null }];
    const channelSettings = { F3: { type: 'eeg', bad: false } };
    const xml = toAnyWaveMontage(rows, channelSettings);
    expect(xml).toContain('<reference>Fz</reference>');
    expect(xml).toContain('<color></color>');
  });

  it('round-trips through parseAnyWaveMontage', () => {
    const rows = [
      { channel: 'FP2', reference: null, color: 'darkblue' },
      { channel: 'F3', reference: 'Fz', color: null },
    ];
    const channelSettings = {
      FP2: { type: 'eeg', bad: false },
      F3: { type: 'seeg', bad: false },
    };
    const xml = toAnyWaveMontage(rows, channelSettings);
    const parsed = parseAnyWaveMontage(xml);
    expect(parsed.rows).toEqual(rows);
    expect(parsed.channelTypes).toEqual({ FP2: 'eeg', F3: 'seeg' });
  });

  it('escapes XML-special characters in a channel name', () => {
    const rows = [{ channel: 'A&B', reference: null, color: null }];
    const channelSettings = { 'A&B': { type: 'eeg', bad: false } };
    const xml = toAnyWaveMontage(rows, channelSettings);
    expect(xml).toContain('name="A&amp;B"');
    expect(xml).not.toContain('name="A&B"');
  });
});
