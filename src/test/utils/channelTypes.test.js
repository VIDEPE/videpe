import { describe, it, expect } from 'vitest';

import { TYPE_LIST, TYPE_ORDER, DEFAULT_GLOBAL_FILTERS } from '@/utils/channelTypes';

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
