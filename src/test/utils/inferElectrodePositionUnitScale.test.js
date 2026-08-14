import { describe, it, expect } from 'vitest';
import { inferMmScaleFromRange } from '@/utils/inferElectrodePositionUnitScale';

describe('inferMmScaleFromRange', () => {
  it('infers meters (×1000) for a real head range in meters', () => {
    expect(inferMmScaleFromRange([-0.086, 0.086, -0.02, 0.087])).toBe(1000);
  });

  it('infers centimeters (×10) for a real head range in cm', () => {
    expect(inferMmScaleFromRange([-8.6, 8.6, -2.0, 8.7])).toBe(10);
  });

  it('infers millimeters (×1) for a real head range in mm', () => {
    expect(inferMmScaleFromRange([-86.0, 86.0, -20.0, 87.0])).toBe(1);
  });
});
