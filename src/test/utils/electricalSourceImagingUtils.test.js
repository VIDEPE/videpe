import { describe, it, expect } from 'vitest';
import {
  calculateSourcePower,
  convertSourcePowersToConnectome,
  electricalSourceImaging,
  findSourceGridBasis,
  mapPositionsToGridIndices,
  ijkIndexToFlatIndex,
  buildAffineMatrix,
  buildSourceVolumeGrid,
} from '@/utils/electricalSourceImagingUtils';
import { ESI_CONNECTOME_URL } from '@/components/NiiViewer.utils';
import { estimateGridSpacing } from '../../utils/electricalSourceImagingUtils';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const length = (v) => Math.hypot(v[0], v[1], v[2]);

// ─── Fixtures ────────────────────────────────────────────────────────────────
//
// SINGLE_SOURCE_FILTERS: 1 inside source, 2 channels.
// Filter rows: x=[1,2], y=[3,4], z=[5,6] — small integers so expected powers are
// easy to verify by hand. channelVoltages is intentionally excluded so each test
// can pass its own without repeating the rest.
const SINGLE_SOURCE_FILTERS = {
  flatSourceFilters: new Float64Array([1, 2, 3, 4, 5, 6]),
  nInsideSources: 1,
  nChannels: 2,
};

// TWO_SOURCE_FILTERS: 2 inside sources, 2 channels.
// source 0: x=[1,0], y=[0,1], z=[0,0]  — responds to ch0 in x, ch1 in y
// source 1: x=[0,0], y=[0,0], z=[1,1]  — responds to both channels in z only
// With channelVoltages=[2,3]: source 0 power=13, source 1 power=25 (verified below).
const TWO_SOURCE_FILTERS = {
  flatSourceFilters: new Float64Array([
    1,
    0,
    0,
    1,
    0,
    0, // source 0 (x-row, y-row, z-row)
    0,
    0,
    0,
    0,
    1,
    1, // source 1 (x-row, y-row, z-row)
  ]),
  nInsideSources: 2,
  nChannels: 2,
};

// ─── calculateSourcePower ────────────────────────────────────────────────────
//
// Power at each source = momentX² + momentY² + momentZ²
// where moment = filter_row · channelVoltages (dot product).

describe('calculateSourcePower', () => {
  it('returns a Float64Array of length nInsideSources', () => {
    const result = calculateSourcePower({ ...SINGLE_SOURCE_FILTERS, channelVoltages: [1, 0] });

    expect(result).toBeInstanceOf(Float64Array);
    expect(result).toHaveLength(SINGLE_SOURCE_FILTERS.nInsideSources);
  });

  it('computes the correct power for a single source with one active channel', () => {
    // channelVoltages = [1, 0] — only channel 0 contributes
    // momentX = 1×1 + 2×0 = 1,  momentY = 3×1 + 4×0 = 3,  momentZ = 5×1 + 6×0 = 5
    // power = 1² + 3² + 5² = 35
    const result = calculateSourcePower({ ...SINGLE_SOURCE_FILTERS, channelVoltages: [1, 0] });

    expect(result[0]).toBe(35);
  });

  it('computes the correct power when all channels contribute', () => {
    // channelVoltages = [1, 1] — both channels active
    // momentX = 1+2 = 3,  momentY = 3+4 = 7,  momentZ = 5+6 = 11
    // power = 9 + 49 + 121 = 179
    const result = calculateSourcePower({ ...SINGLE_SOURCE_FILTERS, channelVoltages: [1, 1] });

    expect(result[0]).toBe(179);
  });

  it('computes independent powers for multiple sources and verifies row-major indexing', () => {
    // channelVoltages = [2, 3]
    // source 0: momentX=2×1+3×0=2, momentY=2×0+3×1=3, momentZ=0  → power = 4+9+0 = 13
    // source 1: momentX=0,         momentY=0,           momentZ=2×1+3×1=5 → power = 25
    const result = calculateSourcePower({ ...TWO_SOURCE_FILTERS, channelVoltages: [2, 3] });

    expect(result[0]).toBe(13);
    expect(result[1]).toBe(25);
  });

  it('returns all zeros when channel voltages are all zero', () => {
    const result = calculateSourcePower({ ...SINGLE_SOURCE_FILTERS, channelVoltages: [0, 0] });

    expect(Array.from(result)).toEqual([0]);
  });
});

// ─── findSourceGridBasis ──────────────────────────────────────────────────────
//
// FieldTrip source grids are warped into subject space, which rotates the grid's own
// axes away from world x/y/z but preserves true 3D spacing exactly (verified against a
// real *_inversefilters.mat sample: nearest-neighbor distance was exact to the mm, but
// per-axis spacing was not — see conversation). findSourceGridBasis recovers that
// rotated basis from an anchor point's neighbor offsets so positions can later be
// mapped to exact integer voxel indices instead of lossy axis-aligned rounding.

describe('findSourceGridBasis', () => {
  it('returns an estimatedGridSpacing of 6 for a 6mm cube', () => {
    const positions = [];
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) positions.push([i * 6, j * 6, k * 6]);

    const result = estimateGridSpacing(positions);
    expect(result).not.toBeNull();
    expect(result).toBeCloseTo(6, 5);
  });

  it('recovers spacing and an orthogonal basis for a simple axis-aligned grid', () => {
    // 3×3×3 grid, 2mm spacing, no rotation — the simplest possible case.
    const positions = [];
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) positions.push([i * 2, j * 2, k * 2]);

    const result = findSourceGridBasis(positions);

    expect(result).not.toBeNull();
    expect(result.gridSpacing).toBeCloseTo(2, 5);
    for (const v of result.basis) expect(length(v)).toBeCloseTo(2, 5);
  });

  it('recovers the rotated basis for a grid rotated 30° about the z-axis', () => {
    const angle = Math.PI / 6;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const rotate = ([x, y, z]) => [x * cos - y * sin, x * sin + y * cos, z];

    const positions = [];
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++)
        for (let k = -1; k <= 1; k++) positions.push(rotate([i * 5, j * 5, k * 5]));

    const result = findSourceGridBasis(positions);

    expect(result).not.toBeNull();
    expect(result.gridSpacing).toBeCloseTo(5, 5);
    const [e1, e2, e3] = result.basis;
    for (const v of result.basis) expect(length(v)).toBeCloseTo(5, 5);
    // it's a rotation of a cube, so the basis vectors must stay mutually orthogonal
    expect(dot(e1, e2)).toBeCloseTo(0, 5);
    expect(dot(e1, e3)).toBeCloseTo(0, 5);
    expect(dot(e2, e3)).toBeCloseTo(0, 5);
  });

  it('returns null for a point cloud with no regular grid structure', () => {
    const positions = [
      [0, 0, 0],
      [1, 7, 3],
      [9, 2, 8],
      [4, 4, 4],
    ];

    expect(findSourceGridBasis(positions)).toBeNull();
  });

  it('returns null when there are too few points to form a grid', () => {
    expect(
      findSourceGridBasis([
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
      ])
    ).toBeNull();
  });
});

// ─── mapPositionsToGridIndices ────────────────────────────────────────────────
//
// Given the {anchor, basis} findSourceGridBasis already found, projects every source
// position onto the basis to get its integer (i,j,k) grid index — solving
// offset = i*b1 + j*b2 + k*b3 for (i,j,k), then shifting so the minimum index in
// each axis lands at 0 (indices are relative to an arbitrary anchor point, which
// could sit anywhere inside the grid, not necessarily at its corner).

describe('mapPositionsToGridIndices', () => {
  // 3×3×3 grid, 2mm spacing, axis-aligned — same shape as findSourceGridBasis's simplest
  // test case, but the basis is supplied directly here so this function is tested in isolation.
  const AXIS_ALIGNED_POSITIONS = [];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++) AXIS_ALIGNED_POSITIONS.push([i * 2, j * 2, k * 2]);
  const AXIS_ALIGNED_BASIS = [
    [2, 0, 0],
    [0, 2, 0],
    [0, 0, 2],
  ];
  // anchor is the grid's own centre point [2,2,2] (i=j=k=1), not a corner — indices found
  // relative to it are expected to include negatives before the zero-shift is applied.
  const AXIS_ALIGNED_ANCHOR = [2, 2, 2];

  it('returns one grid index per source position, in the same order', () => {
    const { sourceVolumeIndices } = mapPositionsToGridIndices(
      AXIS_ALIGNED_POSITIONS,
      AXIS_ALIGNED_ANCHOR,
      AXIS_ALIGNED_BASIS
    );

    expect(sourceVolumeIndices).toHaveLength(AXIS_ALIGNED_POSITIONS.length);
  });

  it('shifts indices so the minimum lands at [0,0,0] and the maximum at [2,2,2] for a 3×3×3 grid', () => {
    const { sourceVolumeIndices } = mapPositionsToGridIndices(
      AXIS_ALIGNED_POSITIONS,
      AXIS_ALIGNED_ANCHOR,
      AXIS_ALIGNED_BASIS
    );

    const min = [0, 1, 2].map((axis) =>
      Math.min(...sourceVolumeIndices.map((index) => index[axis]))
    );
    const max = [0, 1, 2].map((axis) =>
      Math.max(...sourceVolumeIndices.map((index) => index[axis]))
    );
    expect(min).toEqual([0, 0, 0]);
    expect(max).toEqual([2, 2, 2]);
  });

  it('returns exact, zero-based integer indices for known corner and centre positions', () => {
    const { sourceVolumeIndices } = mapPositionsToGridIndices(
      AXIS_ALIGNED_POSITIONS,
      AXIS_ALIGNED_ANCHOR,
      AXIS_ALIGNED_BASIS
    );

    // AXIS_ALIGNED_POSITIONS is built with i outermost, k innermost, each 0..2 — so
    // position [0,0,0] is index 0, the anchor [2,2,2] is index 13 (i=j=k=1), and the
    // far corner [4,4,4] is the last index, 26 (i=j=k=2).
    expect(sourceVolumeIndices[0]).toEqual([0, 0, 0]); // lowest corner
    expect(sourceVolumeIndices[13]).toEqual([1, 1, 1]); // the anchor itself → centre of the shifted grid
    expect(sourceVolumeIndices[26]).toEqual([2, 2, 2]); // far corner
  });

  it('rounds near-integer floating-point solutions to exact integers for a rotated basis', () => {
    // Same rotated-30°-about-z setup as findSourceGridBasis's rotation test — the linear
    // solve involves cos/sin, so raw results land close to but not exactly on integers
    // (e.g. 1.9999999998) until Math.round is applied.
    const angle = Math.PI / 6;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const rotate = ([x, y, z]) => [x * cos - y * sin, x * sin + y * cos, z];

    const positions = [];
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++)
        for (let k = -1; k <= 1; k++) positions.push(rotate([i * 5, j * 5, k * 5]));

    const anchor = rotate([0, 0, 0]); // = [0,0,0], the grid's own centre point
    const basis = [rotate([5, 0, 0]), rotate([0, 5, 0]), rotate([0, 0, 5])];

    const { sourceVolumeIndices } = mapPositionsToGridIndices(positions, anchor, basis);

    for (const [i, j, k] of sourceVolumeIndices) {
      expect(Number.isInteger(i)).toBe(true);
      expect(Number.isInteger(j)).toBe(true);
      expect(Number.isInteger(k)).toBe(true);
    }
    const min = [0, 1, 2].map((axis) =>
      Math.min(...sourceVolumeIndices.map((index) => index[axis]))
    );
    const max = [0, 1, 2].map((axis) =>
      Math.max(...sourceVolumeIndices.map((index) => index[axis]))
    );
    expect(min).toEqual([0, 0, 0]);
    expect(max).toEqual([2, 2, 2]);
  });

  it('returns gridDimensions of [3,3,3] for a 3×3×3 grid, regardless of anchor position', () => {
    // dimensions = (max index - min index + 1) per axis — since indices span 0..2 on
    // every axis after the zero-shift, each dimension should be 3, not 2 (max) or off by one.
    const { gridDimensions } = mapPositionsToGridIndices(
      AXIS_ALIGNED_POSITIONS,
      AXIS_ALIGNED_ANCHOR,
      AXIS_ALIGNED_BASIS
    );

    expect(gridDimensions).toEqual([3, 3, 3]);
  });

  it('returns gridDimensions matching a non-cubic grid', () => {
    // 2×3×4 grid (different point count per axis) — dimensions must track each axis
    // independently, not assume a cube.
    const positions = [];
    for (let i = 0; i < 2; i++)
      for (let j = 0; j < 3; j++) for (let k = 0; k < 4; k++) positions.push([i * 2, j * 2, k * 2]);
    const basis = [
      [2, 0, 0],
      [0, 2, 0],
      [0, 0, 2],
    ];
    const anchor = [0, 0, 0]; // corner anchor this time, not centre

    const { gridDimensions } = mapPositionsToGridIndices(positions, anchor, basis);

    expect(gridDimensions).toEqual([2, 3, 4]);
  });

  it('returns minCorner reflecting how far the zero-shift moved things relative to the anchor', () => {
    // AXIS_ALIGNED_ANCHOR is the grid's centre point (i=j=k=1 in the 3×3×3 grid), so raw
    // anchor-relative indices span -1..1 on every axis before the zero-shift — minCorner
    // should be exactly that pre-shift minimum, [-1,-1,-1].
    const { minCorner } = mapPositionsToGridIndices(
      AXIS_ALIGNED_POSITIONS,
      AXIS_ALIGNED_ANCHOR,
      AXIS_ALIGNED_BASIS
    );

    expect(minCorner).toEqual([-1, -1, -1]);
  });

  it('returns minCorner of [0,0,0] when the anchor itself is already the grid corner', () => {
    const positions = [];
    for (let i = 0; i < 2; i++)
      for (let j = 0; j < 3; j++) for (let k = 0; k < 4; k++) positions.push([i * 2, j * 2, k * 2]);
    const basis = [
      [2, 0, 0],
      [0, 2, 0],
      [0, 0, 2],
    ];
    const anchor = [0, 0, 0];

    const { minCorner } = mapPositionsToGridIndices(positions, anchor, basis);

    expect(minCorner).toEqual([0, 0, 0]);
  });
});

// ─── buildAffineMatrix ────────────────────────────────────────────────────────
//
// Builds the NIfTI-style vox2mm affine [b1 b2 b3 | origin; 0 0 0 1] that maps a voxel
// index (i,j,k) to its real-world mm position — origin is voxel [0,0,0]'s mm position,
// which is the anchor walked back by minCorner basis-steps (see the function's own comment).

describe('buildAffineMatrix', () => {
  it('sets basis vectors as the first 3 columns, for a simple axis-aligned grid', () => {
    const anchor = [10, 20, 30];
    const basis = [
      [2, 0, 0],
      [0, 2, 0],
      [0, 0, 2],
    ];
    const minCorner = [0, 0, 0]; // anchor is already voxel [0,0,0]

    const affine = buildAffineMatrix(anchor, basis, minCorner);

    expect(affine[0]).toEqual([2, 0, 0, 10]);
    expect(affine[1]).toEqual([0, 2, 0, 20]);
    expect(affine[2]).toEqual([0, 0, 2, 30]);
    expect(affine[3]).toEqual([0, 0, 0, 1]);
  });

  it('shifts the origin back from the anchor by minCorner basis-steps when the anchor is not voxel [0,0,0]', () => {
    // anchor = grid centre, minCorner = [-1,-1,-1] (same setup as mapPositionsToGridIndices's
    // centre-anchor test) — origin should be 1 basis-step in the negative direction from anchor
    // on every axis: origin = anchor + (-1)*b1 + (-1)*b2 + (-1)*b3.
    const anchor = [2, 2, 2];
    const basis = [
      [2, 0, 0],
      [0, 2, 0],
      [0, 0, 2],
    ];
    const minCorner = [-1, -1, -1];

    const affine = buildAffineMatrix(anchor, basis, minCorner);

    // origin = [2,2,2] + (-1)*[2,0,0] + (-1)*[0,2,0] + (-1)*[0,0,2] = [0,0,0]
    expect(affine[0][3]).toBe(0);
    expect(affine[1][3]).toBe(0);
    expect(affine[2][3]).toBe(0);
  });

  it('recovers the correct real-world position for a known voxel via the affine, for a rotated basis', () => {
    // Same rotated-30°-about-z grid as findSourceGridBasis/mapPositionsToGridIndices's rotation
    // tests. Applying the affine to voxel [1,1,1] should land back on the original mm position
    // of the source that mapped to that voxel — proving the affine correctly inverts the
    // index→mm relationship mapPositionsToGridIndices solves, including the zero-shift.
    const angle = Math.PI / 6;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const rotate = ([x, y, z]) => [x * cos - y * sin, x * sin + y * cos, z];

    const anchor = rotate([0, 0, 0]);
    const basis = [rotate([5, 0, 0]), rotate([0, 5, 0]), rotate([0, 0, 5])];
    const knownPosition = rotate([5, 5, 5]); // i=j=k=1 relative to the anchor, before shifting

    const { sourceVolumeIndices, minCorner } = mapPositionsToGridIndices(
      [knownPosition],
      anchor,
      basis
    );
    const affine = buildAffineMatrix(anchor, basis, minCorner);
    const [i, j, k] = sourceVolumeIndices[0];

    // affine * [i,j,k,1] should reproduce knownPosition
    const recoveredPosition = [0, 1, 2].map(
      (row) => affine[row][0] * i + affine[row][1] * j + affine[row][2] * k + affine[row][3]
    );

    expect(recoveredPosition[0]).toBeCloseTo(knownPosition[0], 5);
    expect(recoveredPosition[1]).toBeCloseTo(knownPosition[1], 5);
    expect(recoveredPosition[2]).toBeCloseTo(knownPosition[2], 5);
  });
});

// ─── ijkIndexToFlatIndex ──────────────────────────────────────────────────────
//
// Converts a (i,j,k) grid index into a single flat array index, one scalar per voxel,
// in i-fastest/k-slowest order — matching NIfTI's on-disk voxel data layout.

describe('ijkIndexToFlatIndex', () => {
  it('maps the origin to flat index 0', () => {
    expect(ijkIndexToFlatIndex(0, 0, 0, [2, 2, 2])).toBe(0);
  });

  it('steps through i fastest, before j or k advance', () => {
    expect(ijkIndexToFlatIndex(0, 0, 0, [2, 2, 2])).toBe(0);
    expect(ijkIndexToFlatIndex(1, 0, 0, [2, 2, 2])).toBe(1);
  });

  it('advances j only once i has wrapped around dimI', () => {
    expect(ijkIndexToFlatIndex(0, 1, 0, [2, 2, 2])).toBe(2);
    expect(ijkIndexToFlatIndex(1, 1, 0, [2, 2, 2])).toBe(3);
  });

  it('advances k only once both i and j have wrapped', () => {
    expect(ijkIndexToFlatIndex(0, 0, 1, [2, 2, 2])).toBe(4);
    expect(ijkIndexToFlatIndex(1, 1, 1, [2, 2, 2])).toBe(7);
  });

  it('maps the far corner to the last flat index (total voxel count - 1)', () => {
    const gridDimensions = [2, 3, 4];
    const totalVoxels = gridDimensions[0] * gridDimensions[1] * gridDimensions[2];

    expect(ijkIndexToFlatIndex(1, 2, 3, gridDimensions)).toBe(totalVoxels - 1);
  });

  it('produces a unique flat index for every (i,j,k) in a non-cubic grid, covering the full range', () => {
    const gridDimensions = [2, 3, 4];
    const seen = new Set();
    for (let k = 0; k < gridDimensions[2]; k++)
      for (let j = 0; j < gridDimensions[1]; j++)
        for (let i = 0; i < gridDimensions[0]; i++)
          seen.add(ijkIndexToFlatIndex(i, j, k, gridDimensions));

    const totalVoxels = gridDimensions[0] * gridDimensions[1] * gridDimensions[2];
    expect(seen.size).toBe(totalVoxels);
    expect(Math.min(...seen)).toBe(0);
    expect(Math.max(...seen)).toBe(totalVoxels - 1);
  });
});

// ─── buildSourceVolumeGrid ────────────────────────────────────────────────────
//
// End-to-end: finds the basis, maps positions to grid indices, then places each
// source's power into a flat Float32Array voxel grid (summing when sources share a voxel).

describe('buildSourceVolumeGrid', () => {
  // 3×3×3 grid, 2mm spacing, axis-aligned, built corner-first (i outer, k inner) — so
  // findSourceGridBasis picks positions[0]=[0,0,0] as anchor (its 3 nearest, mutually
  // orthogonal neighbors are found immediately) with basis=[[2,0,0],[0,2,0],[0,0,2]].
  // With a corner anchor there's no min-shift, so grid index == [i,j,k] loop index directly.
  const AXIS_ALIGNED_POSITIONS = [];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++) AXIS_ALIGNED_POSITIONS.push([i * 2, j * 2, k * 2]);
  // one power per position, matching its position in the array (index 0 → power 1, etc.)
  // so each expected value is easy to trace back to its source.
  const AXIS_ALIGNED_POWERS = AXIS_ALIGNED_POSITIONS.map((_, idx) => idx + 1);

  it('returns gridDimensions [3,3,3] and a Float32Array of length 27 for a 3×3×3 grid', () => {
    const { sourceVolumeGrid, gridDimensions } = buildSourceVolumeGrid(
      AXIS_ALIGNED_POSITIONS,
      AXIS_ALIGNED_POWERS
    );

    expect(gridDimensions).toEqual([3, 3, 3]);
    expect(sourceVolumeGrid).toBeInstanceOf(Float32Array);
    expect(sourceVolumeGrid).toHaveLength(27);
  });

  it('places each source power at its correct flat voxel index', () => {
    // Which real axis (x/y/z) ends up labeled i/j/k depends on the order findSourceGridBasis's
    // neighbor search happens to discover its 3 basis offsets in — not necessarily x,y,z order.
    // So the expected flat index is computed the same way buildSourceVolumeGrid computes it
    // internally (findSourceGridBasis → mapPositionsToGridIndices → ijkIndexToFlatIndex),
    // rather than hand-picking one assuming a specific axis order.
    const targetSourceIndex = 19; // arbitrary, non-symmetric source
    const { anchor, basis } = findSourceGridBasis(AXIS_ALIGNED_POSITIONS);
    const { sourceVolumeIndices, gridDimensions } = mapPositionsToGridIndices(
      AXIS_ALIGNED_POSITIONS,
      anchor,
      basis
    );
    const [i, j, k] = sourceVolumeIndices[targetSourceIndex];
    const expectedFlatIndex = ijkIndexToFlatIndex(i, j, k, gridDimensions);

    const { sourceVolumeGrid } = buildSourceVolumeGrid(AXIS_ALIGNED_POSITIONS, AXIS_ALIGNED_POWERS);

    expect(sourceVolumeGrid[expectedFlatIndex]).toBe(AXIS_ALIGNED_POWERS[targetSourceIndex]);
  });

  it('sums powers when two sources land in the same voxel instead of overwriting', () => {
    // duplicate the grid's centre point (array index 13, position [2,2,2] → grid index [1,1,1])
    // as an extra 28th source with a distinct power, so both should land in flat index 13.
    const positions = [...AXIS_ALIGNED_POSITIONS, AXIS_ALIGNED_POSITIONS[13]];
    const powers = [...AXIS_ALIGNED_POWERS, 100];

    const { sourceVolumeGrid, gridDimensions } = buildSourceVolumeGrid(positions, powers);

    expect(gridDimensions).toEqual([3, 3, 3]); // duplicate doesn't introduce a new min/max
    expect(sourceVolumeGrid[13]).toBe(AXIS_ALIGNED_POWERS[13] + 100); // 14 + 100 = 114
  });

  it('leaves voxels with no matching source at 0', () => {
    // Drop one point (array index 25, position [4,4,2]) that isn't a full corner on any real
    // axis — other remaining points still span the full range on every axis, so the grid stays
    // fully-sized but exactly one voxel (the removed point's) ends up with no source at all.
    const positions = AXIS_ALIGNED_POSITIONS.filter((_, idx) => idx !== 25);
    const powers = AXIS_ALIGNED_POWERS.filter((_, idx) => idx !== 25);

    // Find whichever flat index the remaining sources *don't* land on, the same way
    // buildSourceVolumeGrid computes flat indices internally (see previous test's comment
    // on why the expected index can't be hand-picked assuming a fixed i/j/k↔x/y/z order).
    const { anchor, basis } = findSourceGridBasis(positions);
    const { sourceVolumeIndices, gridDimensions } = mapPositionsToGridIndices(
      positions,
      anchor,
      basis
    );
    const totalVoxels = gridDimensions[0] * gridDimensions[1] * gridDimensions[2];
    const usedFlatIndices = new Set(
      sourceVolumeIndices.map(([i, j, k]) => ijkIndexToFlatIndex(i, j, k, gridDimensions))
    );
    expect(usedFlatIndices.size).toBe(totalVoxels - 1); // exactly one voxel left empty
    let emptyFlatIndex = -1;
    for (let f = 0; f < totalVoxels; f++) {
      if (!usedFlatIndices.has(f)) emptyFlatIndex = f;
    }

    const { sourceVolumeGrid } = buildSourceVolumeGrid(positions, powers);

    expect(sourceVolumeGrid[emptyFlatIndex]).toBe(0);
  });

  it('throws when insideSourcePositions and sourcePowers have different lengths', () => {
    expect(() => buildSourceVolumeGrid(AXIS_ALIGNED_POSITIONS, [1, 2, 3])).toThrow(
      /unequal number/
    );
  });
});

// ─── convertSourcePowersToConnectome ─────────────────────────────────────────

// Two inside-brain source positions and pre-verified power values
// (same as the TWO_SOURCE_FILTERS + channelVoltages=[2,3] case above).
const CONNECTOME_POSITIONS = [
  [-5, 15, 10],
  [0, 10, 15],
];
const CONNECTOME_POWERS = new Float64Array([13, 25]);

describe('convertSourcePowersToConnectome', () => {
  it('returns an object with the correct NiiVue connectome layer shape', () => {
    const result = convertSourcePowersToConnectome(CONNECTOME_POSITIONS, CONNECTOME_POWERS);

    expect(result.url).toBe(ESI_CONNECTOME_URL);
    expect(result.kind).toBe('connectome');
    expect(result.type).toBe('Electrical Source Imaging');
    expect(result.name).toBe('ESI Source Power');
    expect(result.edges).toEqual([]);
    expect(result.nodes).toBeDefined();
    expect(result.calMax).toBeDefined();
  });

  it('creates one node per inside-brain source', () => {
    const result = convertSourcePowersToConnectome(CONNECTOME_POSITIONS, CONNECTOME_POWERS);

    expect(result.nodes).toHaveLength(CONNECTOME_POSITIONS.length);
  });

  it('sets node x/y/z from insideSourcePositions', () => {
    const result = convertSourcePowersToConnectome(CONNECTOME_POSITIONS, CONNECTOME_POWERS);

    expect(result.nodes[0]).toMatchObject({ x: -5, y: 15, z: 10 });
    expect(result.nodes[1]).toMatchObject({ x: 0, y: 10, z: 15 });
  });

  it('sets node colorValue from sourcePowers and sizeValue proportional to power', () => {
    // CONNECTOME_POWERS = [13, 25], calMax = 25
    const result = convertSourcePowersToConnectome(CONNECTOME_POSITIONS, CONNECTOME_POWERS);

    expect(result.nodes[0].colorValue).toBe(13);
    expect(result.nodes[1].colorValue).toBe(25);
    expect(result.nodes[0].sizeValue).toBeCloseTo(13 / 25); // 0.52 — lower power, smaller sphere
    expect(result.nodes[1].sizeValue).toBe(1); // highest power → full nodeScale size
  });

  it('sets calMax to the maximum source power', () => {
    const result = convertSourcePowersToConnectome(CONNECTOME_POSITIONS, CONNECTOME_POWERS);

    expect(result.calMax).toBe(25);
  });

  it('floors calMax at 1e-9 when all powers are zero to prevent NiiVue color-scale division-by-zero', () => {
    const result = convertSourcePowersToConnectome(CONNECTOME_POSITIONS, new Float64Array([0, 0]));

    expect(result.calMax).toBe(1e-9);
  });
});

// ─── electricalSourceImaging ─────────────────────────────────────────────────
//
// Minimal model matching parseInverseSolutionFieldtrip's return shape.
// Uses the same 2-source, 2-channel setup as TWO_SOURCE_FILTERS above
// so expected powers are already verified: source 0 → 13, source 1 → 25.

const MINIMAL_MODEL = {
  format: 'FieldTrip',
  ...TWO_SOURCE_FILTERS,
  insideSourcePositions: [
    [-5, 15, 10],
    [0, 10, 15],
  ],
  channelLabels: ['1', '2'],
};

// channelSnapshot fixtures — the per-click EEG state lifted from EegViewer
const SCALP_SNAPSHOT = { isIntracranial: false, channelNames: ['1', '2'], voltages: [2, 3] };
const IEEG_SNAPSHOT = { isIntracranial: true, channelNames: ['B1', 'B2'], voltages: [2, 3] };

describe('electricalSourceImaging', () => {
  it('returns null when inverseSolution is null (not yet loaded)', () => {
    expect(electricalSourceImaging(null, SCALP_SNAPSHOT)).toBeNull();
  });

  it('returns null when channelSnapshot is null (no EEG click yet)', () => {
    expect(electricalSourceImaging(MINIMAL_MODEL, null)).toBeNull();
  });

  it('returns null when channelSnapshot voltages are empty (pre-click state)', () => {
    expect(electricalSourceImaging(MINIMAL_MODEL, { ...SCALP_SNAPSHOT, voltages: [] })).toBeNull();
  });

  it('returns null for iEEG recordings — ESI inverse filters require scalp EEG', () => {
    expect(electricalSourceImaging(MINIMAL_MODEL, IEEG_SNAPSHOT)).toBeNull();
  });

  it('returns [] when flatSourceFilters is empty', () => {
    const inverseSolution = { ...MINIMAL_MODEL, flatSourceFilters: new Float64Array(0) };

    expect(electricalSourceImaging(inverseSolution, SCALP_SNAPSHOT)).toEqual([]);
  });

  it('throws a descriptive error for an unknown format', () => {
    const inverseSolution = { ...MINIMAL_MODEL, format: 'Unknown' };

    expect(() => electricalSourceImaging(inverseSolution, SCALP_SNAPSHOT)).toThrow(/format/);
  });

  it('runs end-to-end and returns both a connectome layer and a volume layer for NiiViewer', () => {
    const result = electricalSourceImaging(MINIMAL_MODEL, SCALP_SNAPSHOT);

    // Powers from this model are already verified: source 0 → 13, source 1 → 25
    expect(result.sourcePowerConnectomes.kind).toBe('connectome');
    expect(result.sourcePowerConnectomes.url).toBe(ESI_CONNECTOME_URL);
    expect(result.sourcePowerConnectomes.nodes).toHaveLength(2);
    expect(result.sourcePowerConnectomes.calMax).toBe(25);
    // convertSourcePowersToVolume is still a stub — locks in today's actual behavior
    expect(result.sourcePowerVolumes).toBeNull();
  });
});
