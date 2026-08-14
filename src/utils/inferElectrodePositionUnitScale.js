// Coordinate-range bands used to infer units when a position file doesn't declare them.
// A head spans roughly: meters ≈ 0.1-0.3, cm ≈ 15-30, mm ≈ 150-300 — each band ~10x
// apart, so a cutoff in each gap reliably sorts a file into one of the three.
const METERS_MAX_RANGE = 1; // below this, assume meters
const CM_MAX_RANGE = 50; // between METERS_MAX_RANGE and this, assume cm; above, assume mm

// Infers the multiplier to convert coordinates (whose unit is unknown) to mm, from
// their overall range (max - min across all values).
export function inferMmScaleFromRange(coords) {
  const range = Math.max(...coords) - Math.min(...coords);
  if (range < METERS_MAX_RANGE) return 1000; // meters → mm
  if (range < CM_MAX_RANGE) return 10; // cm → mm
  return 1; // already mm
}
