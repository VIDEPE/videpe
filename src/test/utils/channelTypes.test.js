import { describe, it, expect } from 'vitest';

import { TYPE_LIST, DEFAULT_GLOBAL_FILTERS } from '@/utils/channelTypes';

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
