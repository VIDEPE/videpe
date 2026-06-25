import { describe, it, expect } from 'vitest';
import { interpolateDivergingColor } from '@/utils/eegColormaps';

describe('interpolateDivergingColor', () => {
  it('returns white at value 0', () => {
    expect(interpolateDivergingColor(0, 10)).toBe('rgb(255, 255, 255)');
  });

  it('returns pure red at +calMax (default colormap)', () => {
    expect(interpolateDivergingColor(10, 10)).toBe('rgb(255, 0, 0)');
  });

  it('returns pure blue at -calMax (default colormap)', () => {
    expect(interpolateDivergingColor(-10, 10)).toBe('rgb(0, 0, 255)');
  });

  it('returns an interpolated color at half magnitude', () => {
    expect(interpolateDivergingColor(5, 10)).toBe('rgb(255, 128, 128)');
    expect(interpolateDivergingColor(-5, 10)).toBe('rgb(128, 128, 255)');
  });

  it('clamps values beyond calMax to the same color as calMax', () => {
    expect(interpolateDivergingColor(100, 10)).toBe(interpolateDivergingColor(10, 10));
    expect(interpolateDivergingColor(-100, 10)).toBe(interpolateDivergingColor(-10, 10));
  });

  it('returns white when calMax is zero or negative, regardless of value', () => {
    expect(interpolateDivergingColor(5, 0)).toBe('rgb(255, 255, 255)');
    expect(interpolateDivergingColor(5, -10)).toBe('rgb(255, 255, 255)');
  });

  it('uses the cividis end colors in colourblind mode', () => {
    expect(interpolateDivergingColor(10, 10, true)).toBe('rgb(255, 233, 69)');
    expect(interpolateDivergingColor(-10, 10, true)).toBe('rgb(0, 32, 76)');
  });

  it('still returns white at value 0 in colourblind mode', () => {
    expect(interpolateDivergingColor(0, 10, true)).toBe('rgb(255, 255, 255)');
  });
});
