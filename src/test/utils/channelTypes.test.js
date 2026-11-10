import { describe, it, expect } from 'vitest';

import {
  TYPE_LIST,
  TYPE_ORDER,
  DEFAULT_GLOBAL_FILTERS,
  countChannelsByType,
} from '@/utils/channelTypes';

describe('TYPE_ORDER', () => {
  it('has the exact same entries as TYPE_LIST', () => {
    // order-insensitive: TYPE_ORDER may be reordered on purpose, but must not miss or add a type
    expect([...TYPE_ORDER].sort()).toEqual(Object.keys(TYPE_LIST).sort());
  });
});

describe('DEFAULT_GLOBAL_FILTERS', () => {
  it('has exactly one entry per TYPE_LIST type', () => {
    expect(Object.keys(DEFAULT_GLOBAL_FILTERS)).toEqual(Object.keys(TYPE_LIST));
  });

  it('defaults every type to all filters off (null)', () => {
    Object.keys(TYPE_LIST).forEach((type) => {
      expect(DEFAULT_GLOBAL_FILTERS[type]).toEqual({ highPass: null, lowPass: null, notch: null });
    });
  });
});

describe('countChannelsByType', () => {
  it('returns 0 for every TYPE_LIST type when there are no channels', () => {
    expect(countChannelsByType([], {})).toEqual({ eeg: 0, seeg: 0, other: 0 });
  });

  it('counts the channels per type', () => {
    const channelNames = ['Fp1', 'Fp2', 'A1', 'ECG'];
    const channelSettings = {
      Fp1: { type: 'eeg' },
      Fp2: { type: 'eeg' },
      A1: { type: 'seeg' },
      ECG: { type: 'other' },
    };
    expect(countChannelsByType(channelNames, channelSettings)).toEqual({
      eeg: 2,
      seeg: 1,
      other: 1,
    });
  });

  it('counts a channel without settings as eeg', () => {
    expect(countChannelsByType(['Fp1'], {})).toEqual({ eeg: 1, seeg: 0, other: 0 });
  });

  it('ignores channels in channelSettings that are not in channelNames', () => {
    const channelSettings = { Fp1: { type: 'eeg' }, Old: { type: 'seeg' } };
    expect(countChannelsByType(['Fp1'], channelSettings)).toEqual({ eeg: 1, seeg: 0, other: 0 });
  });
});
