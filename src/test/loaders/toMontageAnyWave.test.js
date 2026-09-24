import { describe, it, expect } from 'vitest';
import { toAnyWaveMontage } from '@/loaders/toMontageAnyWave';
import { parseAnyWaveMontage } from '@/loaders/parseMontageAnywave';

describe('toAnyWaveMontage', () => {
  it('serializes rows + channel types into AnyWave XML', () => {
    const rows = [
      {
        channel: 'FP2',
        reference: null,
        color: 'darkblue',
        highPass: null,
        lowPass: null,
        notch: null,
      },
    ];
    const channelSettings = { FP2: { type: 'eeg', bad: false } };
    const xml = toAnyWaveMontage(rows, channelSettings);
    expect(xml).toContain('<Channel name="FP2">');
    expect(xml).toContain('<type>EEG</type>');
    expect(xml).toContain('<reference></reference>');
    expect(xml).toContain('<color>darkblue</color>');
  });

  it('maps seeg/other channel types to SEEG/Other', () => {
    const rows = [
      { channel: 'A1', reference: null, color: null, highPass: null, lowPass: null, notch: null },
      { channel: 'B1', reference: null, color: null, highPass: null, lowPass: null, notch: null },
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
      {
        channel: 'FP2',
        reference: null,
        color: 'darkblue',
        highPass: null,
        lowPass: null,
        notch: null,
      },
      { channel: 'F3', reference: 'Fz', color: null, highPass: null, lowPass: null, notch: null },
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

  it('always writes a <filters> element, using AnyWave off-sentinels when unset', () => {
    const rows = [
      { channel: 'FP2', reference: null, color: null, highPass: null, lowPass: null, notch: null },
    ];
    const channelSettings = { FP2: { type: 'eeg', bad: false } };
    const xml = toAnyWaveMontage(rows, channelSettings);
    expect(xml).toContain('<filters highPass="-1" lowPass="-1" notch="0"/>');
  });

  it('writes the real values in the <filters> element when set', () => {
    const rows = [
      { channel: 'FP2', reference: null, color: null, highPass: 1, lowPass: 40, notch: 50 },
    ];
    const channelSettings = { FP2: { type: 'eeg', bad: false } };
    const xml = toAnyWaveMontage(rows, channelSettings);
    expect(xml).toContain('<filters highPass="1" lowPass="40" notch="50"/>');
  });

  it('round-trips non-null highPass/lowPass/notch values through parseAnyWaveMontage', () => {
    const rows = [
      { channel: 'FP2', reference: null, color: null, highPass: 1, lowPass: 40, notch: 50 },
      { channel: 'F3', reference: 'Fz', color: null, highPass: null, lowPass: null, notch: null },
    ];
    const channelSettings = {
      FP2: { type: 'eeg', bad: false },
      F3: { type: 'seeg', bad: false },
    };
    const xml = toAnyWaveMontage(rows, channelSettings);
    const parsed = parseAnyWaveMontage(xml);
    expect(parsed.rows).toEqual(rows);
  });

  it('escapes XML-special characters in a channel name', () => {
    const rows = [{ channel: 'A&B', reference: null, color: null }];
    const channelSettings = { 'A&B': { type: 'eeg', bad: false } };
    const xml = toAnyWaveMontage(rows, channelSettings);
    expect(xml).toContain('name="A&amp;B"');
    expect(xml).not.toContain('name="A&B"');
  });
});
