import { describe, it, expect, vi } from 'vitest';
import { read as readmat } from 'mat-for-js';
import { parseInverseSolutionFieldtrip } from '@/loaders/parseInverseSolutionFieldtrip';

// mat-for-js does the actual MAT5 binary decoding — that's its job to get right, not ours
// to re-verify here. What we own is the adapter from its generic {header, data} shape to
// the fields ESI needs, so the binary decoder is mocked out entirely.
vi.mock('mat-for-js', () => ({ read: vi.fn() }));

// Shape confirmed against the real FieldTrip *_inversefilters.mat sample files: a struct
// with one filter entry per source position, empty for points outside the head model.
//
// findSourceGridBasis (called internally by the parser to precompute the volume-grid
// structure) needs at least 4 inside points that form a genuine, detectable 3D grid — so
// unlike a simple "one inside point" fixture, this one has 4 inside points at [0,0,0] plus
// its 3 axis-aligned 2mm neighbors (indices 1-4), and 2 unrelated outside points (0, 5).
const FIXTURE = {
  header: 'MATLAB 5.0 MAT-file, Platform: PCWIN64, Created on: ...',
  data: {
    inverse_filters: {
      inside: [0, 1, 1, 1, 1, 0],
      pos: [
        [-10, 20, 5], // 0 — outside
        [0, 0, 0], // 1 — inside, anchor
        [2, 0, 0], // 2 — inside, neighbor along x
        [0, 2, 0], // 3 — inside, neighbor along y
        [0, 0, 2], // 4 — inside, neighbor along z
        [50, 50, 50], // 5 — outside
      ],
      filter: [
        [],
        [
          [1, 2],
          [3, 4],
          [5, 6],
        ],
        [
          [7, 8],
          [9, 10],
          [11, 12],
        ],
        [
          [13, 14],
          [15, 16],
          [17, 18],
        ],
        [
          [19, 20],
          [21, 22],
          [23, 24],
        ],
        [],
      ],
      elec: { label: ['1', '2'] },
    },
  },
};

// Builds a fixture identical to FIXTURE except for the given inverse_filters field
// overrides — lets each missing/empty-field test start from a known-good struct and
// only break the one field it's testing.
const withInverseFilters = (overrides) => ({
  header: FIXTURE.header,
  data: { inverse_filters: { ...FIXTURE.data.inverse_filters, ...overrides } },
});

describe('parseInverseSolutionFieldtrip', () => {
  it('returns the full expected shape for a valid file', async () => {
    readmat.mockReturnValue(FIXTURE);
    const file = new File(['irrelevant — read() is mocked'], 'mocked_file_inversefilters.mat');

    const result = await parseInverseSolutionFieldtrip(file);

    // Raw fields passed through from the MAT struct
    expect(result.format).toBe('FieldTrip');
    expect(result.sourcePositions).toEqual(FIXTURE.data.inverse_filters.pos);
    expect(result.insideMask).toEqual(FIXTURE.data.inverse_filters.inside);
    expect(result.inverseSolutionChannelNames).toEqual(FIXTURE.data.inverse_filters.elec.label);

    // Pre-computed fields derived from the above (exact values tested in dedicated tests below)
    expect(result.nChannels).toBe(FIXTURE.data.inverse_filters.elec.label.length);
    expect(result.nInsideSources).toBe(4); // FIXTURE has inside=[0,1,1,1,1,0], 4 inside points
    expect(result.indicesInsideSources).toEqual([1, 2, 3, 4]);
    expect(result.insideSourcePositions).toHaveLength(4);
    expect(result.flatSourceFilters).toBeInstanceOf(Float64Array);

    // Volume-grid structure, precomputed once at parse time (exact values tested below)
    expect(result.sourceVolumeIndices).toBeDefined();
    expect(result.gridDimensions).toBeDefined();
    expect(result.gridSpacing).toBeDefined();
    expect(result.pixDims).toBeDefined();
    expect(result.affine).toBeDefined();

    // sourceFilters (raw nested cell array) should not be in the return —
    // flatSourceFilters replaces it to avoid a duplicate ~20MB allocation
    expect(result.sourceFilters).toBeUndefined();
  });

  it('does not include raw sourceFilters in the return — replaced by flatSourceFilters', async () => {
    readmat.mockReturnValue(FIXTURE);
    const file = new File(['irrelevant — read() is mocked'], 'mocked_file_inversefilters.mat');

    const result = await parseInverseSolutionFieldtrip(file);

    expect(result.sourceFilters).toBeUndefined();
  });

  it('identifies inside-brain source indices and positions from insideMask', async () => {
    // FIXTURE has inside=[0,1,1,1,1,0] so indices 1-4 are inside
    readmat.mockReturnValue(FIXTURE);
    const file = new File(['irrelevant — read() is mocked'], 'mocked_file_inversefilters.mat');

    const result = await parseInverseSolutionFieldtrip(file);

    expect(result.indicesInsideSources).toEqual([1, 2, 3, 4]);
    expect(result.nInsideSources).toBe(4);
    expect(result.insideSourcePositions).toEqual(FIXTURE.data.inverse_filters.pos.slice(1, 5));
  });

  it('packs inside-source filters into a flat Float64Array in row-major order', async () => {
    // FIXTURE has 4 inside sources (indices 1-4), 2 channels each. Row-major packing puts
    // each source's x-row, then y-row, then z-row, back to back, in inside-source order.
    readmat.mockReturnValue(FIXTURE);
    const file = new File(['irrelevant — read() is mocked'], 'mocked_file_inversefilters.mat');

    const result = await parseInverseSolutionFieldtrip(file);

    expect(result.flatSourceFilters).toBeInstanceOf(Float64Array);
    expect(result.nChannels).toBe(2);
    expect(Array.from(result.flatSourceFilters)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
    ]);
  });

  it('excludes outside-brain sources from flatSourceFilters', async () => {
    // FIXTURE has 6 total sources but only 4 inside — flat array must be length 4×3×2=24, not 6×3×2=36
    readmat.mockReturnValue(FIXTURE);
    const file = new File(['irrelevant — read() is mocked'], 'mocked_file_inversefilters.mat');

    const result = await parseInverseSolutionFieldtrip(file);

    expect(result.flatSourceFilters.length).toBe(4 * 3 * 2); // nInsideSources × 3 × nChannels
  });

  // ─── Volume-grid structure (precomputed once at parse time) ─────────────────────────
  //
  // FIXTURE's 4 inside points are [0,0,0] plus its 3 axis-aligned 2mm neighbors, chosen so
  // findSourceGridBasis lands on anchor=[0,0,0] with basis=[[2,0,0],[0,2,0],[0,0,2]] and
  // gridSpacing=2 deterministically — see the math worked out in FIXTURE's own comment.

  it('computes sourceVolumeIndices — one zero-based (i,j,k) index per inside source, in order', async () => {
    readmat.mockReturnValue(FIXTURE);
    const file = new File(['irrelevant — read() is mocked'], 'mocked_file_inversefilters.mat');

    const result = await parseInverseSolutionFieldtrip(file);

    // anchor [0,0,0] → [0,0,0]; each neighbor is exactly 1 step along its own basis vector
    expect(result.sourceVolumeIndices).toEqual([
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);
  });

  it('computes gridDimensions matching the span of sourceVolumeIndices', async () => {
    readmat.mockReturnValue(FIXTURE);
    const file = new File(['irrelevant — read() is mocked'], 'mocked_file_inversefilters.mat');

    const result = await parseInverseSolutionFieldtrip(file);

    expect(result.gridDimensions).toEqual([2, 2, 2]);
  });

  it('computes gridSpacing as the median nearest-neighbor distance (2mm for this fixture)', async () => {
    readmat.mockReturnValue(FIXTURE);
    const file = new File(['irrelevant — read() is mocked'], 'mocked_file_inversefilters.mat');

    const result = await parseInverseSolutionFieldtrip(file);

    expect(result.gridSpacing).toBeCloseTo(2, 5);
  });

  it('computes pixDims as the per-axis basis vector magnitudes (2mm on every axis for this fixture)', async () => {
    // basis=[[2,0,0],[0,2,0],[0,0,2]] — each basis vector has length 2, regardless of axis
    readmat.mockReturnValue(FIXTURE);
    const file = new File(['irrelevant — read() is mocked'], 'mocked_file_inversefilters.mat');

    const result = await parseInverseSolutionFieldtrip(file);

    expect(result.pixDims[0]).toBeCloseTo(2, 5);
    expect(result.pixDims[1]).toBeCloseTo(2, 5);
    expect(result.pixDims[2]).toBeCloseTo(2, 5);
  });

  it('computes the affine as [b1 b2 b3 | origin; 0 0 0 1] for the anchor-at-origin fixture', async () => {
    // anchor=[0,0,0] is itself voxel [0,0,0] here (minCorner=[0,0,0], no shift needed), so
    // origin is [0,0,0] and the affine is just the basis vectors as columns with no translation.
    readmat.mockReturnValue(FIXTURE);
    const file = new File(['irrelevant — read() is mocked'], 'mocked_file_inversefilters.mat');

    const result = await parseInverseSolutionFieldtrip(file);

    expect(result.affine).toEqual([
      [2, 0, 0, 0],
      [0, 2, 0, 0],
      [0, 0, 2, 0],
      [0, 0, 0, 1],
    ]);
  });

  it("passes the file's bytes to mat-for-js as an ArrayBuffer", async () => {
    // tell readmat to return a the fixture instead of actually reading a file
    readmat.mockReturnValue(FIXTURE);
    const file = new File(['irrelevant — read() is mocked'], 'mocked_file_inversefilters.mat');

    await parseInverseSolutionFieldtrip(file);

    expect(readmat).toHaveBeenCalledWith(expect.any(ArrayBuffer));
  });

  it('rejects with a descriptive error when the file has no inverse_filters struct', async () => {
    // tell readmat to return a the fixture instead of actually reading a file
    readmat.mockReturnValue({ header: '...', data: {} });
    const file = new File(['irrelevant — read() is mocked'], 'mocked_file_inversefilters.mat');

    await expect(parseInverseSolutionFieldtrip(file)).rejects.toThrow(/inverse_filters/);
  });

  it.each([
    ['pos missing', { pos: undefined }, /pos/],
    ['pos empty', { pos: [] }, /pos/],
    ['filter missing', { filter: undefined }, /filter/],
    ['filter empty', { filter: [] }, /filter/],
    ['inside missing', { inside: undefined }, /inside/],
    ['inside empty', { inside: [] }, /inside/],
    ['elec missing entirely', { elec: undefined }, /elec/],
    ['elec.label missing', { elec: {} }, /elec/],
    ['elec.label empty', { elec: { label: [] } }, /elec/],
    ['elec.label has a duplicate name', { elec: { label: ['1', '1', '2'] } }, /duplicate/i],
  ])('rejects with a descriptive error when %s', async (_caseName, overrides, messagePattern) => {
    // tell readmat to return a the fixture with the specified overrides instead of actually reading a file
    readmat.mockReturnValue(withInverseFilters(overrides));
    const file = new File(['irrelevant — read() is mocked'], 'mocked_file_inversefilters.mat');

    await expect(parseInverseSolutionFieldtrip(file)).rejects.toThrow(messagePattern);
  });

  it('names the specific duplicate channel in the rejection message', async () => {
    readmat.mockReturnValue(withInverseFilters({ elec: { label: ['1', '1', '2'] } }));
    const file = new File(['irrelevant — read() is mocked'], 'mocked_file_inversefilters.mat');

    await expect(parseInverseSolutionFieldtrip(file)).rejects.toThrow(/\b1\b/);
  });
});
